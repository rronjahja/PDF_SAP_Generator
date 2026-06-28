'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { deliverOne, testDestination } = require('../srv/lib/delivery');

const PDF = Buffer.from('%PDF-1.4 test');

test('LOCAL_DIR delivery writes the file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliv-'));
  const r = await deliverOne(
    { name: 'disk', type: 'LOCAL_DIR', configJson: JSON.stringify({ directory: dir }) },
    'doc.pdf', PDF
  );
  assert.strictEqual(r.status, 'SUCCESS');
  assert.ok(fs.existsSync(path.join(dir, 'doc.pdf')));
});

test('LOCAL_DIR with overwrite:false numbers duplicates', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliv-'));
  const dest = { name: 'disk', type: 'LOCAL_DIR', configJson: JSON.stringify({ directory: dir, overwrite: false }) };
  await deliverOne(dest, 'a.pdf', PDF);
  const r2 = await deliverOne(dest, 'a.pdf', PDF);
  assert.strictEqual(r2.status, 'SUCCESS');
  assert.ok(fs.existsSync(path.join(dir, 'a (1).pdf')));
});

test('LOCAL_DIR test verifies writability', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliv-'));
  const detail = await testDestination({ name: 'd', type: 'LOCAL_DIR', configJson: JSON.stringify({ directory: dir }) });
  assert.match(detail, /writable/);
});

test('FTP delivery uploads to a live server', async (t) => {
  const { FtpSrv } = require('ftp-srv');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ftproot-'));
  const noopLog = { info() {}, debug() {}, error() {}, warn() {}, trace() {}, fatal() {} };
  noopLog.child = () => noopLog;
  const srv = new FtpSrv({ url: 'ftp://127.0.0.1:2121', pasv_url: '127.0.0.1', anonymous: false, log: noopLog });
  srv.on('login', ({ username, password }, resolve, reject) => {
    if (username === 'tester' && password === 'secret') resolve({ root });
    else reject(new Error('bad credentials'));
  });
  fs.mkdirSync(path.join(root, 'out'), { recursive: true });
  await srv.listen();
  t.after(() => srv.close());

  const dest = {
    name: 'ftp', type: 'FTP',
    configJson: JSON.stringify({ host: '127.0.0.1', port: 2121, user: 'tester', password: 'secret', directory: 'out' })
  };
  const probe = await testDestination(dest);
  assert.match(probe, /connected/);
  const r = await deliverOne(dest, 'inv.pdf', PDF);
  assert.strictEqual(r.status, 'SUCCESS', r.detail);
  assert.deepStrictEqual(fs.readFileSync(path.join(root, 'out', 'inv.pdf')), PDF);
});

test('SFTP failure is reported, not thrown', async () => {
  const r = await deliverOne(
    { name: 'sftp', type: 'SFTP', configJson: JSON.stringify({ host: '127.0.0.1', port: 1, user: 'x', password: 'y' }) },
    'a.pdf', PDF
  );
  assert.strictEqual(r.status, 'FAILED');
  assert.ok(r.detail.length > 0);
});

test('PRINTER without CUPS reports a clear error', async () => {
  const r = await deliverOne(
    { name: 'prn', type: 'PRINTER', configJson: JSON.stringify({ printer: 'Office' }) },
    'a.pdf', PDF
  );
  assert.strictEqual(r.status, 'FAILED');
  assert.match(r.detail, /lp|CUPS|exited/i);
});

test('WEBHOOK posts the document as base64 JSON', async () => {
  const http = require('http');
  let received = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => { received = JSON.parse(body); res.writeHead(200); res.end('ok'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const r = await deliverOne(
    { name: 'hook', type: 'WEBHOOK', configJson: JSON.stringify({ url: `http://127.0.0.1:${port}/in` }) },
    'a.pdf', PDF, { templateName: 'x' }
  );
  server.close();
  assert.strictEqual(r.status, 'SUCCESS');
  assert.strictEqual(received.fileName, 'a.pdf');
  assert.strictEqual(Buffer.from(received.contentBase64, 'base64').toString(), PDF.toString());
});

test('unknown destination names fail gracefully via configJson parse', async () => {
  const r = await deliverOne({ name: 'bad', type: 'FTP', configJson: '{not json' }, 'a.pdf', PDF);
  assert.strictEqual(r.status, 'FAILED');
  assert.match(r.detail, /invalid configJson/);
});
