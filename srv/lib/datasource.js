'use strict';

/**
 * datasource.js — the SAP data binding wizard's server half.
 *
 * Lets the designer connect an SAP OData service (v2 or v4), a CDS view
 * exposed as OData, or any JSON API, without CORS pain: the browser talks to
 * these endpoints, the server fetches the source.
 *
 *   entities({ url, username?, password? })        → list entity types
 *   sample({ url, entity, username?, password? })  → generated sample payload
 *   fetchJson({ url, username?, password? })       → live JSON as sample
 *
 * $metadata is parsed with a small built-in XML scanner (no dependencies),
 * covering EntityType properties for v2 + v4 and v4 Collection navigations.
 */

const MAX_PROPS = 40;
const MAX_NAVS = 3;

function guardUrl(raw) {
    let u;
    try { u = new URL(String(raw)); } catch { throw new Error('Invalid URL.'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs are supported.');
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '169.254.169.254' || host.endsWith('.internal')) {
        throw new Error('This host is not allowed.');
    }
    return u;
}

function authHeaders({ username, password }) {
    const h = { Accept: 'application/json' };
    if (username) h.Authorization = `Basic ${Buffer.from(`${username}:${password || ''}`).toString('base64')}`;
    return h;
}

async function get(url, opts, accept) {
    const res = await fetch(url, {
        headers: { ...authHeaders(opts), ...(accept ? { Accept: accept } : {}) },
        signal: AbortSignal.timeout(12_000),
        redirect: 'follow'
    });
    if (!res.ok) throw new Error(`The service answered HTTP ${res.status} for ${url}`);
    return res.text();
}

/* ── tiny $metadata scanner ───────────────────────────────────────────── */
function parseMetadata(xml) {
    const types = new Map(); // name -> { properties:[{name,type}], navs:[{name,target,collection}] }
    const entityTypeRe = /<EntityType\s+[^>]*Name="([^"]+)"[^>]*>([\s\S]*?)<\/EntityType>/g;
    let m;
    while ((m = entityTypeRe.exec(xml))) {
        const name = m[1];
        const body = m[2];
        const properties = [];
        const propRe = /<Property\s+[^>]*\/?>(?:<\/Property>)?/g;
        let p;
        while ((p = propRe.exec(body))) {
            const tag = p[0];
            const pn = /Name="([^"]+)"/.exec(tag);
            const pt = /Type="([^"]+)"/.exec(tag);
            if (pn && pt) properties.push({ name: pn[1], type: pt[1] });
        }
        const navs = [];
        const navRe = /<NavigationProperty\s+[^>]*\/?>(?:[\s\S]*?<\/NavigationProperty>)?/g;
        let n;
        while ((n = navRe.exec(body))) {
            const tag = n[0];
            const nn = /Name="([^"]+)"/.exec(tag);
            const nt = /Type="([^"]+)"/.exec(tag); // v4; v2 uses Relationship (skipped)
            if (nn && nt) {
                const coll = /^Collection\(/.test(nt[1]);
                const target = nt[1].replace(/^Collection\(/, '').replace(/\)$/, '').split('.').pop();
                navs.push({ name: nn[1], target, collection: coll });
            }
        }
        types.set(name, { properties, navs });
    }
    return types;
}

function sampleForEdm(type, name) {
    const t = String(type).replace(/^Edm\./, '');
    const n = String(name).toLowerCase();
    if (/^(int|byte|sbyte)/i.test(t)) return /count|qty|quantity/.test(n) ? 3 : 100;
    if (/decimal|double|single/i.test(t)) return /price|amount|net|gross|total|value/.test(n) ? 199.99 : 1.5;
    if (/boolean/i.test(t)) return true;
    if (/^date$/i.test(t)) return '2026-07-01';
    if (/datetime/i.test(t)) return '2026-07-01T09:30:00Z';
    if (/time/i.test(t)) return '09:30:00';
    if (/guid/i.test(t)) return '11111111-2222-3333-4444-555555555555';
    if (/currency|curr/.test(n)) return 'EUR';
    if (/name/.test(n)) return 'ACME Industries GmbH';
    if (/city/.test(n)) return 'Hamburg';
    if (/country/.test(n)) return 'DE';
    if (/street|address/.test(n)) return 'Speicherstadt 4';
    if (/mail/.test(n)) return 'contact@acme.example';
    if (/status/.test(n)) return 'OPEN';
    return `${name} sample`;
}

function buildSample(types, entityName) {
    const t = types.get(entityName);
    if (!t) throw new Error(`Entity type '${entityName}' was not found in the service metadata.`);
    const obj = {};
    for (const p of t.properties.slice(0, MAX_PROPS)) obj[p.name] = sampleForEdm(p.type, p.name);
    let navsUsed = 0;
    for (const nav of t.navs) {
        if (navsUsed >= MAX_NAVS) break;
        const target = types.get(nav.target);
        if (!target) continue;
        const child = {};
        for (const p of target.properties.slice(0, MAX_PROPS)) child[p.name] = sampleForEdm(p.type, p.name);
        obj[nav.name] = nav.collection ? [child, { ...child }] : child;
        navsUsed++;
    }
    return obj;
}

/* ── public API used by server.js ─────────────────────────────────────── */
async function entities(opts) {
    const u = guardUrl(opts.url);
    const metaUrl = u.href.replace(/\/$/, '').replace(/\/\$metadata$/, '') + '/$metadata';
    const xml = await get(metaUrl, opts, 'application/xml');
    const types = parseMetadata(xml);
    if (!types.size) throw new Error('No entity types found — is this an OData service root or CDS service URL?');
    return [...types.entries()].map(([name, t]) => ({
        name,
        fields: t.properties.length,
        collections: t.navs.filter((n) => n.collection).map((n) => n.name)
    }));
}

async function sample(opts) {
    const u = guardUrl(opts.url);
    const metaUrl = u.href.replace(/\/$/, '').replace(/\/\$metadata$/, '') + '/$metadata';
    const xml = await get(metaUrl, opts, 'application/xml');
    return buildSample(parseMetadata(xml), opts.entity);
}

async function fetchJson(opts) {
    guardUrl(opts.url);
    const text = await get(opts.url, opts, 'application/json');
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('The endpoint did not return valid JSON.'); }
    // unwrap common OData envelopes: {d:{results:[…]}} (v2) / {value:[…]} (v4)
    if (data && data.d && Array.isArray(data.d.results)) data = data.d.results[0] ?? data.d;
    else if (data && Array.isArray(data.value)) data = data.value[0] ?? data;
    else if (Array.isArray(data)) data = data[0] ?? {};
    return data;
}

module.exports = { entities, sample, fetchJson, parseMetadata, buildSample };