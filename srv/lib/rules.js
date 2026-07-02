'use strict';

/**
 * rules.js — tenant-defined business rules: IF <condition> THEN <action>.
 *
 * Conditions use the same safe expression language as visibleIf (srv/lib/expr.js),
 * evaluated against the business payload plus a `_meta` object:
 *   _meta.documentType, _meta.templateName, _meta.language
 *
 * Examples (exactly the intended usage):
 *   documentType INVOICE + Germany  → condition: _meta.documentType == 'INVOICE' && customer.country == 'DE'
 *   public sector                   → customer.group == 'PUBLIC_SECTOR'
 *   large amounts                   → totals.gross > 10000
 *   language                        → _meta.language == 'de'
 *   company code / sales org        → company.code == '1000'   /  sales.org == '2000'
 *   customer channel preference     → customer.channel == 'PRINT'
 *
 * Actions by stage:
 *   render   : use-template  { template }                — switch to another template
 *              set-variable  { path, value }             — inject/override a payload field (e.g. footer text)
 *              set-asset     { elementId, assetId }      — swap an image (logo A / logo B)
 *   delivery : deliver       { destinations: ['name'] }  — send via configured DeliveryDestinations (email/print/archive/…)
 *              require-approval { label?, expiresInDays? } — hold deliveries behind a signed hosted approval
 *
 * Rules are rows in the RoutingRules entity, evaluated in ascending priority.
 * `stopProcessing` on a matched rule ends evaluation for its stage.
 */

const cds = require('@sap/cds');
const { SELECT } = require('@sap/cds').ql;
const { truthy, evaluate } = require('./expr');

const RENDER_ACTIONS = ['use-template', 'set-variable', 'set-asset'];
const DELIVERY_ACTIONS = ['deliver', 'require-approval'];
const ALL_ACTIONS = [...RENDER_ACTIONS, ...DELIVERY_ACTIONS];

async function loadRules(tenantId) {
    const { RoutingRules } = cds.entities('pdfforms');
    const rows = await SELECT.from(RoutingRules)
        .columns('ID', 'name', 'priority', 'condition', 'actionType', 'configJson', 'active', 'stopProcessing')
        .where({ tenantId, active: true })
        .orderBy('priority asc');
    return rows || [];
}

function parseCfg(rule) {
    try { return rule.configJson ? JSON.parse(rule.configJson) : {}; } catch { return {}; }
}

/**
 * Pure evaluation: returns the matched rules (with parsed config) for a stage.
 * ctx = business payload; meta merged in as `_meta`.
 */
function matchRules(rules, stage, data, meta) {
    const scope = { ...(data || {}), _meta: meta || {} };
    const wanted = stage === 'render' ? RENDER_ACTIONS : DELIVERY_ACTIONS;
    const matched = [];
    for (const r of rules) {
        if (!wanted.includes(r.actionType)) continue;
        let hit = false;
        try { hit = truthy(evaluate(String(r.condition || ''), scope)); } catch { hit = false; }
        if (!hit) continue;
        matched.push({ ...r, config: parseCfg(r) });
        if (r.stopProcessing) break;
    }
    return matched;
}

/** Sets a dotted path on an object (creating intermediate objects). */
function setPath(obj, path, value) {
    const parts = String(path).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
}

/** Applies render-stage rules in place. Returns { templateSwitch, applied: [names] }. */
function applyRenderRules(matched, layout, payload) {
    let templateSwitch = null;
    const applied = [];
    for (const r of matched) {
        if (r.actionType === 'use-template' && r.config.template) {
            templateSwitch = String(r.config.template);
            applied.push(`${r.name}: use template '${templateSwitch}'`);
        } else if (r.actionType === 'set-variable' && r.config.path) {
            setPath(payload, r.config.path, r.config.value);
            applied.push(`${r.name}: set ${r.config.path}`);
        } else if (r.actionType === 'set-asset' && r.config.elementId && r.config.assetId) {
            for (const win of layout.windows || []) {
                for (const el of win.elements || []) {
                    if (el.id === r.config.elementId && el.type === 'IMAGE') {
                        el.assetId = r.config.assetId;
                        applied.push(`${r.name}: element ${el.id} → asset ${r.config.assetId}`);
                    }
                }
            }
        }
    }
    return { templateSwitch, applied };
}

module.exports = { loadRules, matchRules, applyRenderRules, ALL_ACTIONS, RENDER_ACTIONS, DELIVERY_ACTIONS };