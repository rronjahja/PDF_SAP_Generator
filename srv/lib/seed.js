'use strict';

/**
 * Step 3 — Sample template data
 *
 * Seeds one invoice template ("invoice-standard") with a published version 1
 * containing the layout JSON (windows A, B, C, D, F, Z) and the sample invoice data.
 * Runs on server start and only inserts if no template exists yet.
 */

const cds = require('@sap/cds');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

module.exports = async function seed() {
  const { Templates, TemplateVersions } = cds.entities('pdfforms');

  const existing = await SELECT.one.from(Templates);
  if (existing) return;

  const layoutJson = fs.readFileSync(path.join(__dirname, '..', 'samples', 'invoice-layout.json'), 'utf8');
  const sampleDataJson = fs.readFileSync(path.join(__dirname, '..', 'samples', 'invoice-data.json'), 'utf8');

  const templateId = uuidv4();
  const versionId = uuidv4();
  const now = new Date().toISOString();

  await INSERT.into(Templates).entries({
    ID: templateId,
    tenantId: 'default',
    name: 'invoice-standard',
    description: 'Standard invoice template (sample data, windows A/B/C/D/F/Z)',
    documentType: 'INVOICE',
    status: 'ACTIVE',
    activeVersion_ID: versionId,
    createdAt: now,
    createdBy: 'system',
    modifiedAt: now,
    modifiedBy: 'system'
  });

  await INSERT.into(TemplateVersions).entries({
    ID: versionId,
    template_ID: templateId,
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
  console.log(`[pdf-form-builder] seeded sample template 'invoice-standard' (${templateId}), version 1 PUBLISHED`);
};
