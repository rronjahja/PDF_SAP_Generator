'use strict';

/**
 * Delivery engine — sends a generated PDF to configured destinations.
 *
 * Destination types and their configJson:
 *  LOCAL_DIR : { "directory": "/data/out", "overwrite": true }
 *  FTP       : { "host", "port"?, "user", "password", "directory"?, "secure"? }
 *  SFTP      : { "host", "port"?, "user", "password" | "privateKey", "directory"? }
 *  PRINTER   : { "printer": "OfficeLaser", "options"?: "-o sides=two-sided-long-edge", "server"?: "cups-host:631" }
 *  WEBHOOK   : { "url", "headers"?: {..}, "method"?: "POST" }
 *
 * Each attempt returns { destination, type, status: 'SUCCESS'|'FAILED', detail }.
 * Credentials live in the database for the self-hosted case; on BTP prefer
 * the Destination service / Credential Store (see README).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function parseConfig(dest) {
  try {
    return JSON.parse(dest.configJson || '{}');
  } catch {
    throw new Error(`Destination '${dest.name}' has invalid configJson.`);
  }
}

async function deliverLocalDir(cfg, fileName, buffer) {
  if (!cfg.directory) throw new Error("configJson needs a 'directory'.");
  const dir = path.resolve(cfg.directory);
  await fs.promises.mkdir(dir, { recursive: true });
  let target = path.join(dir, fileName);
  if (cfg.overwrite === false) {
    let i = 1;
    const ext = path.extname(fileName);
    const stem = fileName.slice(0, -ext.length || undefined);
    while (fs.existsSync(target)) target = path.join(dir, `${stem} (${i++})${ext}`);
  }
  await fs.promises.writeFile(target, buffer);
  return `written to ${target}`;
}

async function deliverFtp(cfg, fileName, buffer) {
  if (!cfg.host || !cfg.user) throw new Error("configJson needs 'host' and 'user'.");
  const ftp = require('basic-ftp');
  const client = new ftp.Client(15000);
  try {
    await client.access({
      host: cfg.host,
      port: cfg.port || 21,
      user: cfg.user,
      password: cfg.password || '',
      secure: cfg.secure === true
    });
    if (cfg.directory) {
      try {
        await client.ensureDir(cfg.directory);
      } catch {
        await client.cd(cfg.directory); // some servers reply non-550 on probe; try a plain cd
      }
    }
    const { Readable } = require('stream');
    await client.uploadFrom(Readable.from(buffer), fileName);
    return `uploaded to ftp://${cfg.host}${cfg.directory ? '/' + cfg.directory.replace(/^\//, '') : ''}/${fileName}`;
  } finally {
    client.close();
  }
}

async function deliverSftp(cfg, fileName, buffer) {
  if (!cfg.host || !cfg.user) throw new Error("configJson needs 'host' and 'user'.");
  const SftpClient = require('ssh2-sftp-client');
  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: cfg.host,
      port: cfg.port || 22,
      username: cfg.user,
      password: cfg.password,
      privateKey: cfg.privateKey,
      readyTimeout: 15000
    });
    const dir = cfg.directory || '.';
    if (cfg.directory) await sftp.mkdir(dir, true).catch(() => undefined);
    const remote = `${dir.replace(/\/$/, '')}/${fileName}`;
    await sftp.put(Buffer.from(buffer), remote);
    return `uploaded to sftp://${cfg.host}/${remote}`;
  } finally {
    await sftp.end().catch(() => undefined);
  }
}

function deliverPrinter(cfg, fileName, buffer) {
  if (!cfg.printer) throw new Error("configJson needs a 'printer' (CUPS queue name).");
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `print-${Date.now()}-${fileName}`);
    fs.writeFileSync(tmp, buffer);
    const args = ['-d', cfg.printer, '-t', fileName];
    if (cfg.server) args.push('-h', cfg.server);
    if (cfg.options) args.push(...String(cfg.options).split(/\s+/).filter(Boolean));
    args.push(tmp);
    const lp = spawn('lp', args);
    let err = '';
    lp.stderr.on('data', (d) => (err += d));
    lp.on('error', (e) => {
      fs.unlink(tmp, () => undefined);
      reject(new Error(e.code === 'ENOENT' ? "The 'lp' command (CUPS client) is not installed on this host." : e.message));
    });
    lp.on('close', (code) => {
      fs.unlink(tmp, () => undefined);
      if (code === 0) resolve(`sent to printer '${cfg.printer}'${cfg.server ? ` via ${cfg.server}` : ''}`);
      else reject(new Error(`lp exited with ${code}: ${err.trim() || 'unknown error'}`));
    });
  });
}

async function deliverWebhook(cfg, fileName, buffer, meta) {
  if (!cfg.url) throw new Error("configJson needs a 'url'.");
  const res = await fetch(cfg.url, {
    method: cfg.method || 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.headers || {}) },
    body: JSON.stringify({ fileName, mimeType: 'application/pdf', contentBase64: buffer.toString('base64'), ...meta }),
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  return `posted to ${cfg.url} (${res.status})`;
}

/** Delivers `buffer` to one destination row. Never throws — returns a result record. */
async function deliverOne(dest, fileName, buffer, meta = {}) {
  const base = { destination: dest.name, type: dest.type };
  try {
    const cfg = parseConfig(dest);
    let detail;
    switch (dest.type) {
      case 'LOCAL_DIR': detail = await deliverLocalDir(cfg, fileName, buffer); break;
      case 'FTP': detail = await deliverFtp(cfg, fileName, buffer); break;
      case 'SFTP': detail = await deliverSftp(cfg, fileName, buffer); break;
      case 'PRINTER': detail = await deliverPrinter(cfg, fileName, buffer); break;
      case 'WEBHOOK': detail = await deliverWebhook(cfg, fileName, buffer, meta); break;
      default: throw new Error(`Unknown destination type '${dest.type}'.`);
    }
    return { ...base, status: 'SUCCESS', detail };
  } catch (e) {
    return { ...base, status: 'FAILED', detail: e.message };
  }
}

/** Connectivity test without generating a document. */
async function testDestination(dest) {
  const cfg = parseConfig(dest);
  switch (dest.type) {
    case 'LOCAL_DIR': {
      if (!cfg.directory) throw new Error("configJson needs a 'directory'.");
      const dir = path.resolve(cfg.directory);
      await fs.promises.mkdir(dir, { recursive: true });
      const probe = path.join(dir, `.write-test-${Date.now()}`);
      await fs.promises.writeFile(probe, 'ok');
      await fs.promises.unlink(probe);
      return `directory ${dir} is writable`;
    }
    case 'FTP': {
      const ftp = require('basic-ftp');
      const client = new ftp.Client(10000);
      try {
        await client.access({ host: cfg.host, port: cfg.port || 21, user: cfg.user, password: cfg.password || '', secure: cfg.secure === true });
        await client.list(cfg.directory || '/');
        return `connected to ftp://${cfg.host}`;
      } finally { client.close(); }
    }
    case 'SFTP': {
      const SftpClient = require('ssh2-sftp-client');
      const sftp = new SftpClient();
      try {
        await sftp.connect({ host: cfg.host, port: cfg.port || 22, username: cfg.user, password: cfg.password, privateKey: cfg.privateKey, readyTimeout: 10000 });
        await sftp.list(cfg.directory || '.');
        return `connected to sftp://${cfg.host}`;
      } finally { await sftp.end().catch(() => undefined); }
    }
    case 'PRINTER':
      return new Promise((resolve, reject) => {
        const args = ['-p', cfg.printer];
        if (cfg.server) args.unshift('-h', cfg.server);
        const ls = spawn('lpstat', args);
        let out = '', err = '';
        ls.stdout.on('data', (d) => (out += d));
        ls.stderr.on('data', (d) => (err += d));
        ls.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? "The 'lpstat' command (CUPS client) is not installed on this host." : e.message)));
        ls.on('close', (code) => (code === 0 ? resolve(out.trim() || `printer '${cfg.printer}' found`) : reject(new Error(err.trim() || `printer '${cfg.printer}' not found`))));
      });
    case 'WEBHOOK': {
      const res = await fetch(cfg.url, { method: 'OPTIONS', signal: AbortSignal.timeout(8000) }).catch(() => fetch(cfg.url, { method: 'HEAD', signal: AbortSignal.timeout(8000) }));
      return `endpoint reachable (${res.status})`;
    }
    default:
      throw new Error(`Unknown destination type '${dest.type}'.`);
  }
}

module.exports = { deliverOne, testDestination };
