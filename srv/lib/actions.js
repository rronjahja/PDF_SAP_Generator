'use strict';

/**
 * actions.js — interactive PDF actions behind signed, hosted URLs.
 *
 * A layout can contain ACTION_BUTTON / ACTION_QR / ACTION_LINK elements.
 * At generation time each becomes a DocumentActions row plus a signed token;
 * the PDF carries a link annotation (and/or QR) to  {ACTION_BASE_URL}/action/{token}.
 * That URL serves a small hosted page where the recipient can approve, reject,
 * submit data, or trigger a webhook. Every step is logged to ActionLogs.
 *
 * Security: HMAC-SHA256 signed tokens (secret: ACTION_SECRET env, else a
 * per-boot random — set the env in production or tokens die on restart),
 * expiry, one-time use, per-token rate limiting, and a tenant allow-list
 * via ACTION_ALLOWED (comma-separated; default: all built-ins).
 */

const crypto = require('crypto');
const cds = require('@sap/cds');
const { INSERT, SELECT, UPDATE } = require('@sap/cds').ql;

const SECRET = process.env.ACTION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.ACTION_SECRET) console.warn('[actions] ACTION_SECRET not set — using a per-boot secret; existing tokens invalidate on restart.');

const ACTION_TYPES = ['approve', 'reject', 'submit', 'webhook'];
function allowedTypes() {
    const conf = (process.env.ACTION_ALLOWED || '').trim();
    return conf ? conf.split(',').map((s) => s.trim()).filter((t) => ACTION_TYPES.includes(t)) : ACTION_TYPES;
}
function baseUrl() {
    let b = process.env.ACTION_BASE_URL;
    if (!b) {
        try {
            const v = JSON.parse(process.env.VCAP_APPLICATION || '{}');
            if (Array.isArray(v.application_uris) && v.application_uris[0]) b = `https://${v.application_uris[0]}`;
        } catch { /* not on CF */ }
    }
    if (!b) b = `http://localhost:${process.env.PORT || 4004}`;
    return b.replace(/\/$/, '');
}

/* ── signed tokens ────────────────────────────────────────────────────── */
const b64u = (b) => Buffer.from(b).toString('base64url');
function sign(payload) {
    const body = b64u(JSON.stringify(payload));
    const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    return `${body}.${mac}`;
}
function verify(token) {
    const [body, mac] = String(token || '').split('.');
    if (!body || !mac) return null;
    const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
    try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}

/* ── anti-abuse: 20 requests / token / minute ─────────────────────────── */
const hits = new Map();
function rateLimited(id) {
    const now = Date.now();
    const h = hits.get(id);
    if (!h || now - h.ts > 60_000) { hits.set(id, { ts: now, n: 1 }); return false; }
    h.n += 1;
    if (hits.size > 5000) hits.clear();
    return h.n > 20;
}

async function log(actionId, event, detail, ip) {
    try {
        const { ActionLogs } = cds.entities('pdfforms');
        await INSERT.into(ActionLogs).entries({
            ID: cds.utils.uuid(), action: actionId, event,
            detail: detail ? String(detail).slice(0, 2000) : null,
            ip: ip ? String(ip).slice(0, 64) : null,
            createdAt: new Date().toISOString()
        });
    } catch { /* logging must never break the action */ }
}

/* ── creation (called by generation.js pre-pass) ──────────────────────── */
async function createAction({ type, label, scope, config, description, successMessage, confirmLabel, tenantId, templateId, documentId, expiresInDays, oneTime }) {
    config = { ...(config || {}) };
    if (description) config.description = String(description).slice(0, 500);
    if (successMessage) config.successMessage = String(successMessage).slice(0, 300);
    if (confirmLabel) config.confirmLabel = String(confirmLabel).slice(0, 60);
    if (!allowedTypes().includes(type)) throw new Error(`Action type '${type}' is not allowed for this tenant.`);
    const { DocumentActions } = cds.entities('pdfforms');
    const ID = cds.utils.uuid();
    const days = Number.isFinite(Number(expiresInDays)) && Number(expiresInDays) > 0 ? Number(expiresInDays) : 30;
    const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
    await INSERT.into(DocumentActions).entries({
        ID, tenantId: tenantId || 'default', type, label: (label || type).slice(0, 100),
        scope: (scope || type).slice(0, 50),
        configJson: Object.keys(config).length ? JSON.stringify(config).slice(0, 2000) : null,
        templateId: templateId || null, documentId: documentId || null,
        expiresAt, oneTime: oneTime !== false, status: 'PENDING'
    });
    const token = sign({ a: ID, s: scope || type, exp: Math.floor(new Date(expiresAt).getTime() / 1000) });
    return { ID, token, url: `${baseUrl()}/action/${token}` };
}

/**
 * Scans a layout for ACTION_* elements and mints one action per element.
 * Returns { [elementId]: url } for the renderer.
 */
async function prepareActions(layout, ctx) {
    const urls = {};
    for (const win of layout.windows || []) {
        for (const el of win.elements || []) {
            if (!['ACTION_BUTTON', 'ACTION_QR', 'ACTION_LINK'].includes(el.type)) continue;
            if (el.actionType === 'open-url') { // plain external link — no token, no hosted page
                if (el.href) urls[el.id] = el.href;
                continue;
            }
            const { url } = await createAction({
                type: el.actionType || 'approve',
                label: el.label || el.text || el.actionType || 'Action',
                scope: el.scope,
                config: el.webhookUrl ? { webhookUrl: el.webhookUrl } : undefined,
                description: el.description, successMessage: el.successMessage, confirmLabel: el.confirmLabel,
                tenantId: ctx.tenantId, templateId: ctx.templateId, documentId: ctx.documentId,
                expiresInDays: el.expiresInDays, oneTime: el.oneTime
            });
            urls[el.id] = url;
        }
    }
    return urls;
}

/* ── validation for incoming requests ─────────────────────────────────── */
async function loadValidAction(token, ip) {
    const payload = verify(token);
    if (!payload || !payload.a) return { error: 'This link is invalid.' };
    if (rateLimited(payload.a)) return { error: 'Too many requests — try again in a minute.' };
    const { DocumentActions } = cds.entities('pdfforms');
    const row = await SELECT.one.from(DocumentActions)
        .columns('ID', 'tenantId', 'type', 'label', 'scope', 'configJson', 'documentId', 'expiresAt', 'oneTime', 'usedAt', 'status')
        .where({ ID: payload.a });
    if (!row) return { error: 'This action no longer exists.' };
    if (payload.s && row.scope && payload.s !== row.scope) { await log(row.ID, 'DENIED', 'scope mismatch', ip); return { error: 'This link is not valid for that action.' }; }
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) { await log(row.ID, 'EXPIRED', null, ip); return { error: 'This link has expired.' }; }
    if (row.oneTime && row.usedAt) { await log(row.ID, 'REUSED', null, ip); return { error: 'This link was already used.' }; }
    return { action: row };
}

/* ── execution ────────────────────────────────────────────────────────── */
async function callWebhook(url, payload) {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(8000)
            });
            if (res.ok) return `HTTP ${res.status}`;
            lastErr = `HTTP ${res.status}`;
        } catch (e) { lastErr = e.message; }
        if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
    throw new Error(`webhook failed after 3 attempts: ${lastErr}`);
}

async function executeAction(action, body, ip) {
    const { DocumentActions } = cds.entities('pdfforms');
    await log(action.ID, 'EXECUTE', body && body.data ? JSON.stringify(body.data).slice(0, 1500) : null, ip);
    let result = '';
    try {
        if (action.type === 'approve') result = 'Approved';
        else if (action.type === 'reject') result = `Rejected${body && body.reason ? `: ${String(body.reason).slice(0, 500)}` : ''}`;
        else if (action.type === 'submit') result = 'Data received';
        const cfgMsg = (() => { try { return action.configJson ? JSON.parse(action.configJson).successMessage : null; } catch { return null; } })();
        if (cfgMsg && action.type !== 'webhook') result = cfgMsg;
        else if (action.type === 'webhook') {
            const cfg = action.configJson ? JSON.parse(action.configJson) : {};
            if (!cfg.webhookUrl) throw new Error('No webhook URL configured.');
            result = await callWebhook(cfg.webhookUrl, {
                actionId: action.ID, type: 'webhook', label: action.label,
                documentId: action.documentId, data: (body && body.data) || null, at: new Date().toISOString()
            });
        } else throw new Error(`Unsupported action type '${action.type}'.`);
        await UPDATE(DocumentActions).set({
            status: action.type === 'reject' ? 'REJECTED' : 'COMPLETED',
            usedAt: new Date().toISOString(), result: result.slice(0, 2000)
        }).where({ ID: action.ID });
        await log(action.ID, 'SUCCESS', result, ip);
        return { ok: true, result };
    } catch (e) {
        await UPDATE(DocumentActions).set({ status: 'FAILED', result: String(e.message).slice(0, 2000) }).where({ ID: action.ID });
        await log(action.ID, 'FAILED', e.message, ip);
        return { ok: false, result: e.message };
    }
}

/* ── hosted page ──────────────────────────────────────────────────────── */
function esc(s) { return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function actionPage({ error, action, token }) {
    const inner = error
        ? `<h2>⚠ ${esc(error)}</h2><p class="m">If you believe this is a mistake, ask the sender for a fresh link.</p>`
        : `
      <h2>${esc(action.label)}</h2>
      <p class="m">Document action · ${esc(action.type)}${action.expiresAt ? ` · valid until ${esc(String(action.expiresAt).slice(0, 10))}` : ''}</p>
      ${(() => { try { const c = action.configJson ? JSON.parse(action.configJson) : {}; return c.description ? `<p>${esc(c.description)}</p>` : ''; } catch { return ''; } })()}
      ${action.type === 'reject' || action.type === 'approve' ? `
        <textarea id="reason" placeholder="${action.type === 'approve' ? 'Optional comment…' : 'Reason (optional)…'}"></textarea>
        <button class="go ${action.type}" onclick="run()">${(() => { try { const c = action.configJson ? JSON.parse(action.configJson) : {}; if (c.confirmLabel) return esc(c.confirmLabel); } catch { /* default */ } return action.type === 'approve' ? '✓ Approve' : '✕ Reject'; })()}</button>` : ''}
      ${action.type === 'submit' ? `
        <textarea id="data" placeholder="Enter the requested information…"></textarea>
        <button class="go approve" onclick="run()">Submit</button>` : ''}
      ${action.type === 'webhook' ? `<button class="go approve" onclick="run()">▶ Run</button>` : ''}
      <p id="out" class="m"></p>
      <script>
        async function run() {
          const out = document.getElementById('out');
          out.textContent = 'Working…';
          const reason = document.getElementById('reason');
          const data = document.getElementById('data');
          const res = await fetch(location.pathname + '/execute', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason ? reason.value : undefined, data: data ? data.value : undefined })
          });
          const j = await res.json().catch(() => ({}));
          document.querySelectorAll('button.go').forEach((b) => (b.disabled = true));
          out.textContent = j.ok ? '✓ ' + (j.result || 'Done') + ' — you can close this page.' : '⚠ ' + (j.result || 'Failed');
        }
      </script>`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Document action</title><style>
body{font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;background:#eef3fa;margin:0;display:flex;justify-content:center;padding:40px 16px}
.card{background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(16,24,40,.12);padding:28px;max-width:420px;width:100%}
h2{margin:0 0 6px;font-size:20px}.m{color:#5b6470;font-size:13px}
textarea{width:100%;box-sizing:border-box;min-height:70px;margin:12px 0;border:1px solid #cfd6de;border-radius:8px;padding:8px;font:inherit}
button.go{width:100%;padding:11px;border:none;border-radius:8px;font-size:15px;font-weight:600;color:#fff;cursor:pointer}
button.approve{background:#0a7a3d}button.reject{background:#c0392b}button:disabled{opacity:.5}
</style></head><body><div class="card">${inner}</div></body></html>`;
}

module.exports = { prepareActions, createAction, loadValidAction, executeAction, actionPage, verify, sign, ACTION_TYPES, allowedTypes };