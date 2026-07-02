'use strict';

/**
 * Generation orchestrator (Steps 9–12)
 *
 * Shared by the OData actions (RenderingService) and the runtime REST API
 * (POST /api/v1/templates/{templateId}/generate).
 *
 * - resolves the template (by UUID or by name) and the requested version
 * - validates layout JSON (Step 7) and input data bindings (Steps 6/10)
 * - renders HTML (Step 8) and generates the PDF with Playwright (Step 9)
 * - writes GenerationLogs for every request and GeneratedDocuments on success (Step 12)
 */

const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');
const { AppError } = require('./errors');
const { validateLayout } = require('./layout-validator');
const { validateData } = require('./binding-resolver');
const { renderDocument } = require('./html-renderer');
const { renderPdf } = require('./pdfkit-renderer');
const { resolvePath } = require('./binding-resolver');
const { deliverOne } = require('./delivery');
const { htmlToPdf } = require('./pdf-generator');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function entities() {
  return cds.entities('pdfforms');
}

function parseJson(value, errorCode, what) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new AppError(errorCode, `${what} is not valid JSON: ${err.message}`);
  }
}

/** Coerces a HANA LOB value (string | Buffer | stream) into a UTF-8 string. */
async function lobToString(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return v;
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  if (typeof v.pipe === 'function' || typeof v[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const c of v) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks).toString('utf8');
  }
  return v;
}

/**
 * Reads a template version's LargeString columns inside one transaction.
 * On @cap-js/hana a LOB locator is only valid while its transaction is open;
 * selecting it on an autocommit connection throws
 * "invalid lob locator id (piecewise lob reading)".
 */
async function readVersionLobs(versionId) {
  const { TemplateVersions } = entities();
  return cds.tx(async (tx) => {
    const row = await tx.run(
      SELECT.one.from(TemplateVersions).columns('layoutJson', 'sampleDataJson').where({ ID: versionId })
    );
    if (!row) return {};
    return {
      layoutJson: await lobToString(row.layoutJson),
      sampleDataJson: await lobToString(row.sampleDataJson)
    };
  });
}

/** Loads layout.fonts ([{ name, assetId }]) as Buffers — LargeBinary read inside a tx. */
async function loadCustomFonts(layout) {
  if (!Array.isArray(layout.fonts) || !layout.fonts.length) return undefined;
  const { Assets } = entities();
  const wanted = layout.fonts.filter((f) => f && f.name && f.assetId).slice(0, 10);
  if (!wanted.length) return undefined;
  return cds.tx(async (tx) => {
    const out = {};
    for (const f of wanted) {
      const row = await tx.run(SELECT.one.from(Assets).columns('ID', 'content').where({ ID: f.assetId }));
      if (!row || row.content == null) continue;
      let b = row.content;
      if (typeof b === 'string') b = Buffer.from(b, 'base64');
      else if (!Buffer.isBuffer(b) && (typeof b.pipe === 'function' || typeof b[Symbol.asyncIterator] === 'function')) {
        const chunks = [];
        for await (const c of b) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        b = Buffer.concat(chunks);
      }
      if (Buffer.isBuffer(b)) out[f.name] = b;
    }
    return Object.keys(out).length ? out : undefined;
  });
}

/** Loads every IMAGE element's assetId as a Buffer — LargeBinary read inside a tx. */
async function loadAssetImages(layout) {
  const ids = new Set();
  for (const win of layout.windows || []) for (const el of win.elements || []) {
    if (el.type === 'IMAGE' && el.assetId) ids.add(el.assetId);
  }
  if (!ids.size) return undefined;
  const { Assets } = entities();
  return cds.tx(async (tx) => {
    const out = {};
    for (const id of [...ids].slice(0, 30)) {
      const row = await tx.run(SELECT.one.from(Assets).columns('ID', 'content').where({ ID: id }));
      if (!row || row.content == null) continue;
      let b = row.content;
      if (typeof b === 'string') b = Buffer.from(b, 'base64');
      else if (!Buffer.isBuffer(b) && (typeof b.pipe === 'function' || typeof b[Symbol.asyncIterator] === 'function')) {
        const chunks = [];
        for await (const c of b) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        b = Buffer.concat(chunks);
      }
      if (Buffer.isBuffer(b)) out[id] = b;
    }
    return Object.keys(out).length ? out : undefined;
  });
}

/** Finds a template by UUID or by name within a tenant. */
async function findTemplate(templateKey, tenantId) {
  const { Templates } = entities();
  let template = null;
  if (UUID_RE.test(String(templateKey))) {
    template = await SELECT.one.from(Templates).where({ ID: templateKey, tenantId });
  }
  if (!template) {
    template = await SELECT.one.from(Templates).where({ name: templateKey, tenantId });
  }
  return template;
}

/**
 * Resolves which template version to use.
 * - 'latest' (default): the active/published version
 * - a number: that specific version (must be PUBLISHED unless allowDraft)
 */
async function resolveVersion(template, version, { allowDraft = false } = {}) {
  const { TemplateVersions } = entities();
  if (!version || version === 'latest') {
    if (template.activeVersion_ID) {
      const active = await SELECT.one.from(TemplateVersions).columns('ID', 'template_ID', 'version', 'status').where({ ID: template.activeVersion_ID });
      if (active && (allowDraft || active.status === 'PUBLISHED')) return active;
    }
    const where = { template_ID: template.ID };
    if (!allowDraft) where.status = 'PUBLISHED';
    return SELECT.one.from(TemplateVersions).columns('ID', 'template_ID', 'version', 'status').where(where).orderBy('version desc');
  }
  const versionNumber = Number(version);
  if (!Number.isInteger(versionNumber)) {
    throw new AppError('INVALID_INPUT_DATA', `Invalid version '${version}'. Use 'latest' or a version number.`);
  }
  const found = await SELECT.one.from(TemplateVersions).columns('ID', 'template_ID', 'version', 'status').where({ template_ID: template.ID, version: versionNumber });
  if (found && !allowDraft && found.status !== 'PUBLISHED') return null;
  return found;
}

async function writeLog({ tenantId, templateId, templateVersionId, requestId, status, durationMs, errorCode, errorMessage, user }) {
  try {
    const { GenerationLogs } = entities();
    await INSERT.into(GenerationLogs).entries({
      ID: uuidv4(),
      tenantId,
      template_ID: templateId || null,
      templateVersion_ID: templateVersionId || null,
      requestId,
      status,
      durationMs,
      errorCode: errorCode || null,
      errorMessage: errorMessage ? String(errorMessage).slice(0, 2000) : null,
      createdAt: new Date().toISOString(),
      createdBy: user || 'anonymous'
    });
  } catch (err) {
    // Logging must never break generation
    // eslint-disable-next-line no-console
    console.error('[pdf-form-builder] failed to write generation log:', err.message);
  }
}

/**
 * Resolves a fileNamePattern like "invoice-{invoice.number}-{date}.pdf".
 * Placeholders: any data path, plus {date}, {time}, {template}, {version}.
 */
function resolveFileNamePattern(pattern, template, version, payload) {
  const now = new Date();
  const specials = {
    date: now.toISOString().slice(0, 10),
    time: now.toISOString().slice(11, 19).replace(/:/g, '-'),
    template: template.name,
    version: String(version.version)
  };
  let name = String(pattern).replace(/\{([^}]+)\}/g, (_, key) => {
    const k = key.trim();
    if (specials[k] !== undefined) return specials[k];
    const { found, value } = resolvePath(payload || {}, k);
    return found && value !== null ? String(value) : '';
  });
  name = name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '-').replace(/\s+/g, ' ').trim();
  if (!name.toLowerCase().endsWith('.pdf')) name += '.pdf';
  return name || 'document.pdf';
}

/** Simple per-tenant rate limit (requests per minute). 0/unset = unlimited. */
const rateBuckets = new Map();
function checkRateLimit(tenantId) {
  const limit = Number(process.env.PDF_RATE_LIMIT || 0);
  if (!limit) return;
  const now = Date.now();
  const bucket = rateBuckets.get(tenantId) || [];
  const fresh = bucket.filter((t) => now - t < 60000);
  if (fresh.length >= limit) {
    throw new AppError('GENERATION_LIMIT_EXCEEDED', `Rate limit of ${limit} generations per minute exceeded for tenant '${tenantId}'.`);
  }
  fresh.push(now);
  rateBuckets.set(tenantId, fresh);
}

/** Looks up destinations by name and delivers; records one Deliveries row each. */
async function deliverAll(names, tenantId, documentId, fileName, buffer, meta) {
  const cds = require('@sap/cds');
  const { DeliveryDestinations, Deliveries } = cds.entities('pdfforms');
  const results = [];
  for (const name of names) {
    const dest = await SELECT.one.from(DeliveryDestinations).where({ name, tenantId });
    let result;
    if (!dest) result = { destination: name, type: 'UNKNOWN', status: 'FAILED', detail: `No destination named '${name}'.` };
    else if (dest.active === false) result = { destination: name, type: dest.type, status: 'FAILED', detail: 'Destination is deactivated.' };
    else result = await deliverOne(dest, fileName, buffer, meta);
    results.push(result);
    try {
      await INSERT.into(Deliveries).entries({
        ID: uuidv4(),
        tenantId,
        document_ID: documentId,
        destination: result.destination,
        type: result.type,
        status: result.status,
        detail: result.detail
      });
    } catch { /* audit row is best-effort */ }
  }
  return results;
}

function defaultFileName(template, payload) {
  const docNumber =
    (payload && payload.invoice && payload.invoice.number) ||
    (payload && payload.documentNumber) ||
    new Date().toISOString().slice(0, 10);
  const base = String(template.documentType || template.name || 'document').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return `${base}-${docNumber}.pdf`;
}

/**
 * Validates input data against the active template version (Step 10).
 * @returns {{valid, missingFields, warnings}}
 */
async function validate({ templateKey, data, tenantId = 'default' }) {
  const template = await findTemplate(templateKey, tenantId);
  if (!template) throw new AppError('TEMPLATE_NOT_FOUND', `Template '${templateKey}' was not found.`);

  const version = await resolveVersion(template, 'latest', { allowDraft: true });
  if (!version) throw new AppError('NO_PUBLISHED_VERSION', `Template '${template.name}' has no version to validate against.`);

  const layout = parseJson(version.layoutJson, 'INVALID_LAYOUT_JSON', 'layoutJson');
  const layoutResult = validateLayout(layout);
  if (!layoutResult.valid) {
    throw new AppError('INVALID_LAYOUT_JSON', 'The template layout is invalid.', layoutResult.errors);
  }
  const payload = parseJson(data, 'INVALID_INPUT_DATA', 'Input data') || {};
  return validateData(layout, payload);
}

/**
 * Generates (or previews) a PDF.
 *
 * @param {object} args
 * @param {string} [args.templateKey]        template UUID or name (runtime generation)
 * @param {string} [args.templateVersionId]  explicit version UUID (preview)
 * @param {string} [args.version]            'latest' or version number
 * @param {object|string} [args.data]        business payload (object or JSON string)
 * @param {string} [args.returnMode]         'base64' (MVP)
 * @param {string} [args.fileName]
 * @param {boolean} [args.preview]           preview mode: drafts allowed, sample data fallback,
 *                                           no GeneratedDocuments entry
 * @param {string} [args.user]
 * @param {string} [args.tenantId]
 */
function renderOptions(locale) {
  const port = process.env.PORT || 4004;
  return {
    locale: locale || undefined,
    resolveAssetUrl: (id) => `http://localhost:${port}/api/v1/assets/${id}`
  };
}

async function generate(args) {
  const {
    templateKey,
    templateVersionId,
    version = 'latest',
    returnMode = 'base64',
    fileName,
    preview = false,
    user = 'anonymous',
    tenantId = 'default',
    locale,
    destinations
  } = args;

  const startedAt = Date.now();
  if (!args.preview) checkRateLimit(tenantId);
  const requestId = uuidv4();
  const { Templates, TemplateVersions, GeneratedDocuments } = entities();

  let template = null;
  let templateVersion = null;

  try {
    if (returnMode && returnMode !== 'base64') {
      throw new AppError('INVALID_INPUT_DATA', `Return mode '${returnMode}' is not supported yet. MVP supports: base64.`);
    }

    // 1. Resolve template + version
    if (templateVersionId) {
      templateVersion = await SELECT.one.from(TemplateVersions).columns('ID', 'template_ID', 'version', 'status').where({ ID: templateVersionId });
      if (!templateVersion) {
        throw new AppError('TEMPLATE_VERSION_NOT_FOUND', `Template version '${templateVersionId}' was not found.`);
      }
      template = await SELECT.one.from(Templates).where({ ID: templateVersion.template_ID });
      if (!template || template.tenantId !== tenantId) {
        throw new AppError('TEMPLATE_NOT_FOUND', 'Template was not found.');
      }
    } else {
      template = await findTemplate(templateKey, tenantId);
      if (!template) throw new AppError('TEMPLATE_NOT_FOUND', `Template '${templateKey}' was not found.`);
      templateVersion = await resolveVersion(template, version, { allowDraft: preview });
      if (!templateVersion) {
        throw new AppError(
          'NO_PUBLISHED_VERSION',
          `Template '${template.name}' has no published version${version !== 'latest' ? ` matching '${version}'` : ''}. Publish a version first.`
        );
      }
    }

    // 2. Validate layout (LOBs read in a tx so HANA locators stay valid)
    const versionLobs = await readVersionLobs(templateVersion.ID);
    const layout = parseJson(versionLobs.layoutJson, 'INVALID_LAYOUT_JSON', 'layoutJson');
    if (!layout) throw new AppError('INVALID_LAYOUT_JSON', 'The template version has no layoutJson.');
    const layoutResult = validateLayout(layout);
    if (!layoutResult.valid) {
      throw new AppError('INVALID_LAYOUT_JSON', 'The template layout is invalid.', layoutResult.errors);
    }

    // 3. Resolve payload (preview falls back to stored sample data)
    let payload = parseJson(args.data, 'INVALID_INPUT_DATA', 'Input data');
    if (payload === undefined && preview) {
      payload = parseJson(versionLobs.sampleDataJson, 'INVALID_INPUT_DATA', 'sampleDataJson') || {};
    }
    if (payload === undefined) {
      throw new AppError('INVALID_INPUT_DATA', "Request body must contain a 'data' object with the business payload.");
    }

    // 4. Validate data bindings
    const dataResult = validateData(layout, payload);
    if (!dataResult.valid) {
      const first = dataResult.missingFields[0];
      throw new AppError(
        'MISSING_REQUIRED_FIELD',
        `The field ${first.binding} is required but was not provided.`,
        dataResult.missingFields
      );
    }

    // 4b. Business rules (render stage): template switch, logo/footer overrides, variable injection
    let renderRulesApplied = [];
    if (!args._ruleSwitched) {
      try {
        const rulesLib = require('./rules');
        const allRules = await rulesLib.loadRules(tenantId);
        if (allRules.length) {
          const meta = { documentType: template.documentType, templateName: template.name, language: (locale || '').slice(0, 2).toLowerCase() };
          const matched = rulesLib.matchRules(allRules, 'render', payload, meta);
          const rr = rulesLib.applyRenderRules(matched, layout, payload);
          renderRulesApplied = rr.applied;
          if (rr.templateSwitch && rr.templateSwitch !== template.name) {
            return generate({ ...args, templateKey: rr.templateSwitch, templateVersionId: undefined, _ruleSwitched: true });
          }
        }
      } catch (e) {
        if (e && e.code) throw e; // real app errors propagate
        // rule evaluation must never break generation
      }
    }

    // 5. Render the PDF — Chromium-free pdfkit backend, or the HTML + Chromium pipeline
    const documentId = uuidv4();
    let actionUrls;
    try {
      const { prepareActions } = require('./actions');
      actionUrls = await prepareActions(layout, { tenantId, templateId: template.ID, documentId });
    } catch (e) {
      throw new AppError('INVALID_LAYOUT_JSON', `Action element error: ${e.message}`);
    }
    let pdfBuffer;
    if ((process.env.PDF_ENGINE || 'chromium').toLowerCase() === 'pdfkit') {
      pdfBuffer = await renderPdf(layout, payload, {
        ...renderOptions(locale),
        customFonts: await loadCustomFonts(layout),
        assetImages: await loadAssetImages(layout),
        metadata: { title: (layout.metadata && layout.metadata.title) || template.name },
        actionUrls
      });
    } else {
      const { html } = await renderDocument(layout, payload, renderOptions(locale));
      pdfBuffer = await htmlToPdf(html, { format: layout.page && layout.page.format });
    }

    // 6. Persist results
    const durationMs = Date.now() - startedAt;
    const finalFileName =
      fileName ||
      (template.fileNamePattern
        ? resolveFileNamePattern(template.fileNamePattern, template, templateVersion, payload)
        : defaultFileName(template, payload));

    if (!preview) {
      await INSERT.into(GeneratedDocuments).entries({
        ID: documentId,
        tenantId,
        template_ID: template.ID,
        templateVersion_ID: templateVersion.ID,
        documentNumber: (payload.invoice && payload.invoice.number) || null,
        fileName: finalFileName,
        mimeType: 'application/pdf',
        storageUrl: null,
        content: process.env.PDF_STORE_DOCUMENTS === 'false' ? null : pdfBuffer,
        size: pdfBuffer.length,
        returnMode,
        status: 'SUCCESS',
        errorMessage: null,
        generatedAt: new Date().toISOString(),
        generatedBy: user
      });
    }

    // 7. Deliver to configured destinations (request overrides template defaults),
    //    extended by delivery-stage business rules (routing + approval gate)
    let deliveries = [];
    let approval = null;
    if (!preview) {
      let destNames = Array.isArray(destinations) ? destinations : null;
      if (!destNames && template.defaultDestinations) {
        try { destNames = JSON.parse(template.defaultDestinations); } catch { destNames = null; }
      }
      destNames = Array.isArray(destNames) ? destNames.slice() : [];

      let approvalRule = null;
      try {
        const rulesLib = require('./rules');
        const allRules = await rulesLib.loadRules(tenantId);
        if (allRules.length) {
          const meta = { documentType: template.documentType, templateName: template.name, language: (locale || '').slice(0, 2).toLowerCase() };
          for (const r of rulesLib.matchRules(allRules, 'delivery', payload, meta)) {
            if (r.actionType === 'deliver' && Array.isArray(r.config.destinations)) {
              for (const d of r.config.destinations) if (!destNames.includes(d)) destNames.push(d);
            } else if (r.actionType === 'require-approval' && !approvalRule) approvalRule = r;
          }
        }
      } catch { /* rules must never break generation */ }

      if (approvalRule) {
        // hold all deliveries behind a signed hosted approval
        try {
          const { createAction } = require('./actions');
          const a = await createAction({
            type: 'approve',
            label: approvalRule.config.label || `Approve dispatch of ${finalFileName}`,
            description: destNames.length ? `Approving releases delivery to: ${destNames.join(', ')}` : undefined,
            tenantId, templateId: template.ID, documentId,
            expiresInDays: approvalRule.config.expiresInDays, oneTime: true
          });
          approval = { required: true, rule: approvalRule.name, url: a.url, heldDestinations: destNames };
        } catch (e) {
          approval = { required: true, rule: approvalRule.name, error: e.message, heldDestinations: destNames };
        }
      } else if (destNames.length) {
        deliveries = await deliverAll(destNames, tenantId, documentId, finalFileName, pdfBuffer, {
          templateName: template.name,
          documentId
        });
      }
    }

    await writeLog({
      tenantId,
      templateId: template.ID,
      templateVersionId: templateVersion.ID,
      requestId,
      status: 'SUCCESS',
      durationMs,
      user
    });

    return {
      documentId,
      fileName: finalFileName,
      mimeType: 'application/pdf',
      contentBase64: pdfBuffer.toString('base64'),
      status: 'SUCCESS',
      ...(deliveries.length ? { deliveries } : {}),
      ...(approval ? { approval } : {}),
      ...(renderRulesApplied.length ? { rulesApplied: renderRulesApplied } : {})
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const appError = err instanceof AppError ? err : new AppError('INTERNAL_ERROR', err.message);
    await writeLog({
      tenantId,
      templateId: template && template.ID,
      templateVersionId: templateVersion && templateVersion.ID,
      requestId,
      status: 'ERROR',
      durationMs,
      errorCode: appError.code,
      errorMessage: appError.message,
      user
    });
    throw appError;
  }
}

/** Renders only the HTML (useful for debugging and tests without Chromium). */
async function renderHtml({ templateKey, templateVersionId, data, tenantId = 'default', locale }) {
  const { Templates, TemplateVersions } = entities();
  let templateVersion;
  if (templateVersionId) {
    templateVersion = await SELECT.one.from(TemplateVersions).columns('ID', 'template_ID', 'version', 'status').where({ ID: templateVersionId });
  } else {
    const template = await findTemplate(templateKey, tenantId);
    if (!template) throw new AppError('TEMPLATE_NOT_FOUND', `Template '${templateKey}' was not found.`);
    templateVersion = await resolveVersion(template, 'latest', { allowDraft: true });
  }
  if (!templateVersion) throw new AppError('TEMPLATE_VERSION_NOT_FOUND', 'Template version was not found.');
  const versionLobs = await readVersionLobs(templateVersion.ID);
  const layout = parseJson(versionLobs.layoutJson, 'INVALID_LAYOUT_JSON', 'layoutJson');
  const payload = parseJson(data, 'INVALID_INPUT_DATA', 'Input data')
    || parseJson(versionLobs.sampleDataJson, 'INVALID_INPUT_DATA', 'sampleDataJson')
    || {};
  return renderDocument(layout, payload, renderOptions(locale));
}

module.exports = { generate, validate, renderHtml, findTemplate, resolveVersion };