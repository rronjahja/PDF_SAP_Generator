'use strict';
/**
 * Custom CAP server
 *
 * - mounts the runtime REST API (foundation for Step 22):
 *     POST /api/v1/templates/{templateId}/generate
 *     POST /api/v1/templates/{templateId}/validate
 *     POST /api/v1/template-versions/{versionId}/preview
 *     POST /api/v1/template-versions/{versionId}/preview.html   (debug helper)
 *   These accept plain JSON bodies, which is more convenient for external
 *   clients (CPI, S/4 side-by-side apps) than the OData actions.
 * - seeds the sample invoice template on first start (Step 3)
 *
 * Authentication: mocked in development; XSUAA enforcement follows in Step 25.
 */

const cds = require('@sap/cds');

const generation = require('./lib/generation');
const { sendError, AppError } = require('./lib/errors');
const { INSERT, SELECT } = require('@sap/cds').ql;

cds.on('bootstrap', (app) => {
  const express = require('express');
  app.use(express.json({ limit: '10mb' }));

  // Designer UI (Steps 13–21) — serves the built Vite app if present.
  // Build it with: cd app/designer && npm install && npm run build
  const path = require('path');
  const fs = require('fs');
  const designerCandidates = [
    path.join(__dirname, '..', 'app', 'designer', 'dist'),
    path.join(__dirname, 'app', 'designer', 'dist'),
    path.join(process.cwd(), 'app', 'designer', 'dist'),
    path.join(process.cwd(), 'srv', 'app', 'designer', 'dist')
  ];
  const designerDist = designerCandidates.find((p) => fs.existsSync(p));
  if (designerDist) {
    app.use('/designer', express.static(designerDist));
    app.get('/designer/*splat', (_req, res) => res.sendFile(path.join(designerDist, 'index.html')));
  }

  // Runtime generation API (Step 22 foundation) — uses the published version by default
  /** Optional API key for the runtime API: set PDF_API_KEY and callers must send x-api-key. */
  const requireApiKey = (req, res, next) => {
    const key = process.env.PDF_API_KEY;
    if (!key) return next();
    if (req.get('x-api-key') === key) return next();
    return sendError(res, new AppError('UNAUTHORIZED', 'Missing or invalid x-api-key header.'));
  };
  app.use(['/api/v1/templates', '/api/v1/render-html', '/api/v1/documents'], requireApiKey);


  app.post('/api/v1/templates/:templateId/generate', async (req, res) => {
    try {
      const { version = 'latest', returnMode = 'base64', fileName, data } = req.body || {};
      const result = await generation.generate({
        templateKey: req.params.templateId,
        version,
        returnMode,
        fileName,
        data,
        user: (req.user && req.user.id) || 'api-user',
        tenantId: 'default'
      });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Data validation API (Step 10)
  app.post('/api/v1/templates/:templateId/validate', async (req, res) => {
    try {
      const result = await generation.validate({
        templateKey: req.params.templateId,
        data: (req.body && req.body.data) || {},
        tenantId: 'default'
      });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Preview API (Step 11) — works for DRAFT versions, falls back to sampleDataJson
  app.post('/api/v1/template-versions/:versionId/preview', async (req, res) => {
    try {
      const result = await generation.generate({
        templateVersionId: req.params.versionId,
        data: req.body && req.body.data,
        preview: true,
        locale: req.body && req.body.locale,
        destinations: req.body && req.body.destinations,
        user: (req.user && req.user.id) || 'designer',
        tenantId: 'default'
      });
      res.json(result);
    } catch (err) {
      sendError(res, err);
    }
  });

  // Debug helper: returns the rendered HTML without invoking Chromium.
  // GET is supported so the preview can be opened directly in a browser.
  const previewHtml = async (req, res) => {
    try {
      const { html } = await generation.renderHtml({
        templateVersionId: req.params.versionId,
        data: req.body && req.body.data,
        tenantId: 'default'
      });
      res.type('html').send(html);
    } catch (err) {
      sendError(res, err);
    }
  };
  /** Health: db, chromium, uptime. */
  app.get('/api/v1/health', async (req, res) => {
    const health = { status: 'UP', uptimeSeconds: Math.round(process.uptime()), checks: {} };
    try {
      await SELECT.one.from(cds.entities('pdfforms').Templates).columns('ID');
      health.checks.database = 'UP';
    } catch (e) {
      health.checks.database = 'DOWN: ' + e.message;
      health.status = 'DEGRADED';
    }
    try {
      const { chromiumAvailable } = require('./lib/pdf-generator');
      health.checks.pdfRendering = (await chromiumAvailable()) ? 'UP' : 'UNAVAILABLE (HTML preview still works)';
      if (health.checks.pdfRendering !== 'UP' && health.status === 'UP') health.status = 'DEGRADED';
    } catch {
      health.checks.pdfRendering = 'UNKNOWN';
    }
    res.status(health.status === 'UP' ? 200 : 503).json(health);
  });

  /** Metrics: generation counts and latency from GenerationLogs. */
  app.get('/api/v1/metrics', async (req, res) => {
    try {
      const { GenerationLogs, GeneratedDocuments, Deliveries } = cds.entities('pdfforms');
      const logs = await SELECT.from(GenerationLogs).columns('status', 'durationMs');
      const ok = logs.filter((l) => l.status === 'SUCCESS');
      const failed = logs.length - ok.length;
      const avg = ok.length ? Math.round(ok.reduce((a, l) => a + (l.durationMs || 0), 0) / ok.length) : 0;
      const docs = await SELECT.one.from(GeneratedDocuments).columns('count(*) as n');
      const dels = await SELECT.from(Deliveries).columns('status');
      res.json({
        generations: { total: logs.length, success: ok.length, failed, avgDurationMs: avg },
        documentsStored: (docs && docs.n) || 0,
        deliveries: {
          total: dels.length,
          success: dels.filter((d) => d.status === 'SUCCESS').length,
          failed: dels.filter((d) => d.status === 'FAILED').length
        }
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  /** Download a stored generated document. */
  app.get('/api/v1/documents/:id/download', async (req, res) => {
    try {
      const { GeneratedDocuments } = cds.entities('pdfforms');
      // Read the BLOB inside a tx so the HANA LOB locator stays valid while we consume it.
      const doc = await cds.tx(async (tx) => {
        const row = await tx.run(SELECT.one.from(GeneratedDocuments)
          .columns('ID', 'fileName', 'mimeType', 'content')
          .where({ ID: req.params.id }));
        if (!row || row.content == null) return null;
        let b = row.content;
        if (typeof b === 'string') b = Buffer.from(b, 'base64');
        else if (!Buffer.isBuffer(b) && (typeof b.pipe === 'function' || typeof b[Symbol.asyncIterator] === 'function')) {
          const chunks = [];
          for await (const c of b) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
          b = Buffer.concat(chunks);
        }
        return { fileName: row.fileName, mimeType: row.mimeType, content: b };
      });
      if (!doc || doc.content == null) return res.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'Document not found or its content was not stored.' } });
      const buf = doc.content;
      res.set('Content-Type', doc.mimeType || 'application/pdf');
      const disposition = req.query.inline ? 'inline' : 'attachment';
      res.set('Content-Disposition', `${disposition}; filename="${(doc.fileName || 'document.pdf').replace(/"/g, '')}"`);
      res.send(buf);
    } catch (err) {
      sendError(res, err);
    }
  });

  /**
   * Store a ready-made PDF and make it show up in the Documents tab.
   * No rendering of any kind — the PDF comes in the request body.
   * Two ways to send it:
   *   (a) raw file:   Content-Type: application/pdf   body = the PDF bytes
   *                   optional ?fileName=...&documentNumber=...
   *   (b) JSON:       { "fileName": "...", "contentBase64": "<base64 pdf>", "documentNumber": "..." }
   */
  app.post('/api/v1/documents',
    express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: '25mb' }),
    async (req, res) => {
      try {
        let buf, fileName, documentNumber, mimeType;
        if (Buffer.isBuffer(req.body) && req.body.length) {
          buf = req.body;
          fileName = req.query.fileName;
          documentNumber = req.query.documentNumber;
          mimeType = req.get('content-type') || 'application/pdf';
        } else {
          const b = req.body || {};
          if (!b.contentBase64) {
            return res.status(400).json({ error: { code: 'INVALID_INPUT_DATA', message: "Send a PDF as the body (Content-Type: application/pdf), or JSON with 'contentBase64'." } });
          }
          buf = Buffer.from(b.contentBase64, 'base64');
          fileName = b.fileName;
          documentNumber = b.documentNumber;
          mimeType = b.mimeType || 'application/pdf';
        }
        if (!buf || !buf.length) {
          return res.status(400).json({ error: { code: 'INVALID_INPUT_DATA', message: 'The request body did not contain any PDF bytes.' } });
        }
        const { GeneratedDocuments } = cds.entities('pdfforms');
        const documentId = cds.utils.uuid();
        const finalName = fileName || `document-${documentId}.pdf`;
        await INSERT.into(GeneratedDocuments).entries({
          ID: documentId,
          tenantId: 'default',
          documentNumber: documentNumber || null,
          fileName: finalName,
          mimeType: mimeType || 'application/pdf',
          content: buf,
          size: buf.length,
          returnMode: 'base64',
          status: 'SUCCESS',
          generatedAt: new Date().toISOString(),
          generatedBy: (req.user && req.user.id) || 'api-user'
        });
        res.status(201).json({ documentId, fileName: finalName, size: buf.length, status: 'SUCCESS' });
      } catch (err) {
        sendError(res, err);
      }
    });

  /** Connectivity test for a delivery destination. */
  app.post('/api/v1/destinations/:id/test', async (req, res) => {
    try {
      const { DeliveryDestinations } = cds.entities('pdfforms');
      const dest = await SELECT.one.from(DeliveryDestinations).where({ ID: req.params.id });
      if (!dest) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Destination not found.' } });
      const { testDestination } = require('./lib/delivery');
      const detail = await testDestination(dest);
      res.json({ status: 'SUCCESS', detail });
    } catch (err) {
      res.status(200).json({ status: 'FAILED', detail: err.message });
    }
  });

  /**
   * Live designer preview: renders arbitrary (unsaved) layout + data to HTML.
   * No persistence, no Chromium — used by the split-screen preview pane.
   */
  app.post('/api/v1/render-html', async (req, res) => {
    try {
      const { layout, data, locale } = req.body || {};
      if (!layout || typeof layout !== 'object') {
        return sendError(res, new AppError('INVALID_LAYOUT_JSON', "Body must contain a 'layout' object."));
      }
      const { renderDocument } = require('./lib/html-renderer');
      const out = await renderDocument(layout, data || {}, {
        locale,
        resolveAssetUrl: (id) => `/api/v1/assets/${id}`
      });
      res.json({ html: out.html, pages: out.pages });
    } catch (err) {
      sendError(res, err);
    }
  });

  /** Asset upload (JSON body with base64 content) and binary download. */
  app.post('/api/v1/assets', async (req, res) => {
    try {
      const { fileName, mimeType, contentBase64 } = req.body || {};
      if (!fileName || !contentBase64) {
        return sendError(res, new AppError('INVALID_INPUT_DATA', "Body must contain 'fileName' and 'contentBase64'."));
      }
      const buf = Buffer.from(contentBase64, 'base64');
      if (buf.length > 5 * 1024 * 1024) {
        return sendError(res, new AppError('INVALID_INPUT_DATA', 'Assets are limited to 5 MB.'));
      }
      const { Assets } = cds.entities('pdfforms');
      const ID = cds.utils.uuid();
      await INSERT.into(Assets).entries({
        ID, tenantId: 'default', fileName,
        mimeType: mimeType || 'application/octet-stream',
        content: buf, size: buf.length
      });
      res.status(201).json({ ID, fileName, mimeType, size: buf.length, url: `/api/v1/assets/${ID}` });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/v1/assets/:id', async (req, res) => {
    try {
      const { Assets } = cds.entities('pdfforms');
      // LargeBinary columns are excluded from SELECT * — request explicitly
      const asset = await SELECT.one.from(Assets).columns('ID', 'mimeType', 'content').where({ ID: req.params.id });
      if (!asset || asset.content == null) return res.status(404).end();
      let buf = asset.content;
      if (typeof buf === 'string') buf = Buffer.from(buf, 'base64');
      else if (!Buffer.isBuffer(buf) && typeof buf.pipe === 'function') {
        const chunks = [];
        for await (const c of buf) chunks.push(c);
        buf = Buffer.concat(chunks);
      }
      res.set('Content-Type', asset.mimeType || 'application/octet-stream');
      res.set('Cache-Control', 'public, max-age=3600');
      res.send(buf);
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get('/api/v1/template-versions/:versionId/preview.html', previewHtml);
  app.post('/api/v1/template-versions/:versionId/preview.html', previewHtml);
});

cds.once('served', async () => {
  try {
    await require('./lib/seed')();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[pdf-form-builder] seeding failed:', err.message);
  }
});

module.exports = cds.server;