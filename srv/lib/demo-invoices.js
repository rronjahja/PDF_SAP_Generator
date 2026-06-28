'use strict';

/**
 * seed-demo-documents.js
 *
 * Seeds two ready-made, fully-rendered invoice PDFs into GeneratedDocuments so
 * they appear in the generated-documents list on every startup and are
 * downloadable via GET /api/v1/documents/:id/download — no Chromium needed.
 *
 * Idempotent: fixed IDs, only inserts if missing.
 * Self-wiring: requiring this file registers a 'served' handler. Just add
 *   require('./lib/seed-demo-documents');
 * near the top of srv/server.js.
 */

const cds = require('@sap/cds');
const { buildInvoiceA, buildInvoiceB } = require('./demo-invoices');

// Stable IDs so restarts don't create duplicates.
const DEMO_A_ID = 'a1d0c0de-0001-4a1a-9aaa-000000000001';
const DEMO_B_ID = 'a1d0c0de-0002-4b2b-9bbb-000000000002';

async function seedDemoDocuments() {
  const { GeneratedDocuments, Templates } = cds.entities('pdfforms');

  // Already seeded? (check one of the two)
  const existing = await SELECT.one.from(GeneratedDocuments).columns('ID').where({ ID: DEMO_A_ID });
  if (existing) return;

  // Best-effort link to the sample template (so the UI can group them).
  let tplId = null;
  let versionId = null;
  try {
    const tpl = await SELECT.one.from(Templates)
      .columns('ID', 'activeVersion_ID')
      .where({ name: 'invoice-standard' });
    if (tpl) {
      tplId = tpl.ID;
      versionId = tpl.activeVersion_ID;
    }
  } catch {
    /* template not seeded yet — fine, links stay null */
  }

  const now = new Date().toISOString();
  const a = await buildInvoiceA();
  const b = await buildInvoiceB();

  const row = (id, doc) => ({
    ID: id,
    tenantId: 'default',
    template_ID: tplId,
    templateVersion_ID: versionId,
    documentNumber: doc.documentNumber,
    fileName: doc.fileName,
    mimeType: 'application/pdf',
    storageUrl: null,
    content: doc.buffer,            // Buffer -> LargeBinary (same as generation.js)
    size: doc.buffer.length,
    returnMode: 'base64',
    status: 'SUCCESS',
    errorMessage: null,
    generatedAt: now,
    generatedBy: 'demo-seed'
  });

  await INSERT.into(GeneratedDocuments).entries([row(DEMO_A_ID, a), row(DEMO_B_ID, b)]);

  // eslint-disable-next-line no-console
  console.log(`[pdf-form-builder] seeded 2 demo documents: ${a.fileName}, ${b.fileName}`);
}

// Run after the service is served and the DB is ready.
cds.on('served', async () => {
  try {
    await seedDemoDocuments();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[pdf-form-builder] demo-document seeding failed:', err.message);
  }
});

module.exports = { seedDemoDocuments, DEMO_A_ID, DEMO_B_ID };