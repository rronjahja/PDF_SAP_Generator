'use strict';

/**
 * seed-demo-templates.js
 *
 * Seeds two demo templates the SAME WAY a designer save+publish does:
 * each becomes a Templates row + a PUBLISHED TemplateVersions row whose
 * layoutJson is the saved layout (and sampleDataJson the sample data).
 * They then appear in the designer like any user-created template, and you
 * generate from them with the normal flow:
 *     POST /api/v1/templates/{name}/generate
 *
 * No Chromium is needed to SEED these (templates are just JSON rows).
 * Producing the actual PDF is the normal generate path (renderDocument ->
 * htmlToPdf), which needs Chromium — so it runs locally / on Cloud Foundry,
 * not inside a BAS dev space.
 *
 * Idempotent: fixed IDs, only inserts a template if it is missing.
 * Self-wiring: requiring this file registers a 'served' handler. Add
 *     require('./lib/seed-demo-templates');
 * near the top of srv/server.js.
 */

const cds = require('@sap/cds');
const fs = require('fs');
const path = require('path');

const SAMPLES = path.join(__dirname, '..', 'samples', 'demo');

// Stable IDs so restarts never duplicate.
const DEMO = [
  {
    layoutFile: 'layoutA.json',
    dataFile: 'dataA.json',
    templateId: 'b2d0c0de-0001-4a1a-9aaa-000000000011',
    versionId: 'b2d0c0de-0001-4a1a-9aaa-000000000012',
    name: 'aurora-invoice',
    description: 'Demo invoice — Aurora Components (teal header, QR + barcode)'
  },
  {
    layoutFile: 'layoutB.json',
    dataFile: 'dataB.json',
    templateId: 'b2d0c0de-0002-4b2b-9bbb-000000000021',
    versionId: 'b2d0c0de-0002-4b2b-9bbb-000000000022',
    name: 'meridian-commercial-invoice',
    description: 'Demo commercial invoice — Meridian Logistics (metadata cards, tracking panel)'
  }
];

async function seedDemoTemplates() {
  const { Templates, TemplateVersions } = cds.entities('pdfforms');
  const now = new Date().toISOString();

  for (const t of DEMO) {
    const exists = await SELECT.one.from(Templates).columns('ID').where({ ID: t.templateId });
    if (exists) continue;

    const layoutJson = fs.readFileSync(path.join(SAMPLES, t.layoutFile), 'utf8');
    const sampleDataJson = fs.readFileSync(path.join(SAMPLES, t.dataFile), 'utf8');

    await INSERT.into(Templates).entries({
      ID: t.templateId,
      tenantId: 'default',
      name: t.name,
      description: t.description,
      documentType: 'INVOICE',
      status: 'ACTIVE',
      activeVersion_ID: t.versionId,
      createdAt: now,
      createdBy: 'system',
      modifiedAt: now,
      modifiedBy: 'system'
    });

    await INSERT.into(TemplateVersions).entries({
      ID: t.versionId,
      template_ID: t.templateId,
      version: 1,
      status: 'PUBLISHED',
      layoutJson,
      sampleDataJson,
      createdAt: now,
      createdBy: 'system',
      modifiedAt: now,
      modifiedBy: 'system'
    });

    // eslint-disable-next-line no-console
    console.log(`[pdf-form-builder] seeded demo template '${t.name}' (${t.templateId}), version 1 PUBLISHED`);
  }
}

cds.on('served', async () => {
  try {
    await seedDemoTemplates();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[pdf-form-builder] demo-template seeding failed:', err.message);
  }
});

module.exports = { seedDemoTemplates };