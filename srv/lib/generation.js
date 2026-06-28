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
      const active = await SELECT.one.from(TemplateVersions).where({ ID: template.activeVersion_ID });
      if (active && (allowDraft || active.status === 'PUBLISHED')) return active;
    }
    const where = { template_ID: template.ID };
    if (!allowDraft) where.status = 'PUBLISHED';
    return SELECT.one.from(TemplateVersions).where(where).orderBy('version desc');
  }
  const versionNumber = Number(version);
  if (!Number.isInteger(versionNumber)) {
    throw new AppError('INVALID_INPUT_DATA', `Invalid version '${version}'. Use 'latest' or a version number.`);
  }
  const found = await SELECT.one.from(TemplateVersions).where({ template_ID: template.ID, version: versionNumber });
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
      templateVersion = await SELECT.one.from(TemplateVersions).where({ ID: templateVersionId });
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

    // 2. Validate layout
    const layout = parseJson(templateVersion.layoutJson, 'INVALID_LAYOUT_JSON', 'layoutJson');
    if (!layout) throw new AppError('INVALID_LAYOUT_JSON', 'The template version has no layoutJson.');
    const layoutResult = validateLayout(layout);
    if (!layoutResult.valid) {
      throw new AppError('INVALID_LAYOUT_JSON', 'The template layout is invalid.', layoutResult.errors);
    }

    // 3. Resolve payload (preview falls back to stored sample data)
    let payload = parseJson(args.data, 'INVALID_INPUT_DATA', 'Input data');
    if (payload === undefined && preview) {
      payload = parseJson(templateVersion.sampleDataJson, 'INVALID_INPUT_DATA', 'sampleDataJson') || {};
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

    // 5. Render HTML and generate the PDF
    const { html } = await renderDocument(layout, payload, renderOptions(locale));
    const pdfBuffer = await htmlToPdf(html, { format: layout.page && layout.page.format });

    // 6. Persist results
    const durationMs = Date.now() - startedAt;
    const documentId = uuidv4();
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

    // 7. Deliver to configured destinations (request overrides template defaults)
    let deliveries = [];
    if (!preview) {
      let destNames = Array.isArray(destinations) ? destinations : null;
      if (!destNames && template.defaultDestinations) {
        try { destNames = JSON.parse(template.defaultDestinations); } catch { destNames = null; }
      }
      if (Array.isArray(destNames) && destNames.length) {
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
      ...(deliveries.length ? { deliveries } : {})
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
    templateVersion = await SELECT.one.from(TemplateVersions).where({ ID: templateVersionId });
  } else {
    const template = await findTemplate(templateKey, tenantId);
    if (!template) throw new AppError('TEMPLATE_NOT_FOUND', `Template '${templateKey}' was not found.`);
    templateVersion = await resolveVersion(template, 'latest', { allowDraft: true });
  }
  if (!templateVersion) throw new AppError('TEMPLATE_VERSION_NOT_FOUND', 'Template version was not found.');
  const layout = parseJson(templateVersion.layoutJson, 'INVALID_LAYOUT_JSON', 'layoutJson');
  const payload = parseJson(data, 'INVALID_INPUT_DATA', 'Input data')
    || parseJson(templateVersion.sampleDataJson, 'INVALID_INPUT_DATA', 'sampleDataJson')
    || {};
  return renderDocument(layout, payload, renderOptions(locale));
}

module.exports = { generate, validate, renderHtml, findTemplate, resolveVersion };
