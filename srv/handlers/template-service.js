'use strict';

/**
 * Step 5 — Template lifecycle logic
 *
 * Rules implemented here:
 *  - DRAFT versions can be edited; PUBLISHED versions are locked
 *  - publishTemplateVersion validates the layout, publishes the version,
 *    archives previously published versions and sets the active version
 *  - createNewDraftVersion copies the active/latest layout into version n+1 (DRAFT)
 *  - duplicateTemplate copies a template with a fresh DRAFT version 1
 */

const cds = require('@sap/cds');
const { v4: uuidv4 } = require('uuid');
const { validateLayout } = require('../lib/layout-validator');
const { AppError, rejectWith } = require('../lib/errors');

module.exports = cds.service.impl(function () {
  const { Templates, TemplateVersions } = this.entities;
  // db-level entities to bypass the service-level "published lock" inside actions
  const db = () => cds.entities('pdfforms');

  const keyOf = (req) => {
    if (req.data && req.data.ID) return req.data.ID;
    if (req.params && req.params.length) {
      const last = req.params[req.params.length - 1];
      return typeof last === 'object' ? last.ID : last;
    }
    return undefined;
  };

  /* ----- defaults on create ----- */
  this.before('CREATE', Templates, (req) => {
    req.data.tenantId = req.data.tenantId || 'default';
    req.data.status = req.data.status || 'DRAFT';
  });

  this.before('CREATE', TemplateVersions, async (req) => {
    req.data.status = 'DRAFT'; // new versions always start as drafts
    if (!req.data.version && req.data.template_ID) {
      const { TemplateVersions: DbVersions } = db();
      const latest = await SELECT.one.from(DbVersions)
        .where({ template_ID: req.data.template_ID })
        .orderBy('version desc');
      req.data.version = latest ? latest.version + 1 : 1;
    }
  });

  /* ----- Rule: published versions must not be changed directly ----- */
  this.before(['UPDATE', 'DELETE'], TemplateVersions, async (req) => {
    const id = keyOf(req);
    if (!id) return;
    const { TemplateVersions: DbVersions } = db();
    const existing = await SELECT.one.from(DbVersions).where({ ID: id });
    if (existing && (existing.status === 'PUBLISHED' || existing.status === 'REVIEW')) {
      return req.reject({
        code: 'FORBIDDEN',
        status: 403,
        message:
          'Published template versions must not be changed. Use action createNewDraftVersion to create an editable draft.'
      });
    }
    if (req.event === 'UPDATE' && req.data.status && req.data.status !== (existing && existing.status)) {
      return req.reject({
        code: 'FORBIDDEN',
        status: 403,
        message: 'The version status can only be changed through publishTemplateVersion.'
      });
    }
  });

  /* ----- action publishTemplateVersion ----- */
  const logEvent = async (versionId, action, comment, user) => {
    const { VersionEvents: DbEvents } = cds.entities('pdfforms');
    try {
      await INSERT.into(DbEvents).entries({
        ID: cds.utils.uuid(),
        tenantId: 'default',
        templateVersion_ID: versionId,
        action,
        comment: comment || null,
        createdBy: (user && user.id) || 'anonymous'
      });
    } catch (e) {
      console.error('[pdf-form-builder] audit event failed:', e.message); // eslint-disable-line no-console
    }
  };

  /** DRAFT -> REVIEW */
  this.on('submitForReview', async (req) => {
    const { TemplateVersions: DbVersions } = cds.entities('pdfforms');
    const version = await SELECT.one.from(DbVersions).where({ ID: req.data.templateVersionId });
    if (!version) return rejectWith(req, 'TEMPLATE_VERSION_NOT_FOUND', 'Template version not found.');
    if (version.status === 'REVIEW') return version;
    if (version.status !== 'DRAFT') {
      return rejectWith(req, 'FORBIDDEN', `Only DRAFT versions can be submitted for review (status: ${version.status}).`);
    }
    let parsed;
    try {
      parsed = JSON.parse(version.layoutJson || '{}');
    } catch {
      return rejectWith(req, 'INVALID_LAYOUT_JSON', 'layoutJson is not valid JSON.');
    }
    const layoutCheck = validateLayout(parsed);
    if (!layoutCheck.valid) {
      return rejectWith(req, 'INVALID_LAYOUT_JSON', layoutCheck.errors[0].message, layoutCheck.errors);
    }
    await UPDATE(DbVersions).set({ status: 'REVIEW' }).where({ ID: version.ID });
    await logEvent(version.ID, 'SUBMITTED', req.data.comment, req.user);
    return { ...version, status: 'REVIEW' };
  });

  /** REVIEW -> PUBLISHED (delegates to the publish action) */
  this.on('approveVersion', async (req) => {
    const { TemplateVersions: DbVersions } = cds.entities('pdfforms');
    const version = await SELECT.one.from(DbVersions).where({ ID: req.data.templateVersionId });
    if (!version) return rejectWith(req, 'TEMPLATE_VERSION_NOT_FOUND', 'Template version not found.');
    if (version.status !== 'REVIEW') {
      return rejectWith(req, 'FORBIDDEN', `Only versions in REVIEW can be approved (status: ${version.status}).`);
    }
    await logEvent(version.ID, 'APPROVED', req.data.comment, req.user);
    return this.send({ event: 'publishTemplateVersion', data: { templateVersionId: version.ID } });
  });

  /** REVIEW -> DRAFT */
  this.on('rejectVersion', async (req) => {
    const { TemplateVersions: DbVersions } = cds.entities('pdfforms');
    const version = await SELECT.one.from(DbVersions).where({ ID: req.data.templateVersionId });
    if (!version) return rejectWith(req, 'TEMPLATE_VERSION_NOT_FOUND', 'Template version not found.');
    if (version.status !== 'REVIEW') {
      return rejectWith(req, 'FORBIDDEN', `Only versions in REVIEW can be rejected (status: ${version.status}).`);
    }
    await UPDATE(DbVersions).set({ status: 'DRAFT' }).where({ ID: version.ID });
    await logEvent(version.ID, 'REJECTED', req.data.comment, req.user);
    return { ...version, status: 'DRAFT' };
  });

  this.on('publishTemplateVersion', async (req) => {
    try {
      const { templateVersionId } = req.data;
      const { Templates: DbTemplates, TemplateVersions: DbVersions } = db();

      const version = await SELECT.one.from(DbVersions).where({ ID: templateVersionId });
      if (!version) {
        throw new AppError('TEMPLATE_VERSION_NOT_FOUND', `Template version '${templateVersionId}' was not found.`);
      }
      if (version.status === 'PUBLISHED') return version; // idempotent

      let layout;
      try {
        layout = JSON.parse(version.layoutJson);
      } catch (err) {
        throw new AppError('INVALID_LAYOUT_JSON', `layoutJson is not valid JSON: ${err.message}`);
      }
      const result = validateLayout(layout);
      if (!result.valid) {
        throw new AppError('INVALID_LAYOUT_JSON', 'The layout is invalid and cannot be published.', result.errors);
      }

      // Archive previously published versions of this template
      await UPDATE(DbVersions)
        .set({ status: 'ARCHIVED', modifiedAt: new Date().toISOString() })
        .where({ template_ID: version.template_ID, status: 'PUBLISHED' });

      await UPDATE(DbVersions)
        .set({ status: 'PUBLISHED', modifiedAt: new Date().toISOString(), modifiedBy: req.user && req.user.id })
        .where({ ID: version.ID });

      await UPDATE(DbTemplates)
        .set({ activeVersion_ID: version.ID, status: 'ACTIVE', modifiedAt: new Date().toISOString() })
        .where({ ID: version.template_ID });

      return SELECT.one.from(DbVersions).where({ ID: version.ID });
    } catch (err) {
      return rejectWith(req, err);
    }
  });

  /* ----- action createNewDraftVersion ----- */
  this.after('publishTemplateVersion', async (result, req) => {
    if (result && result.ID) await logEvent(result.ID, 'PUBLISHED', null, req.user);
  });

  this.on('createNewDraftVersion', async (req) => {
    try {
      const { templateId } = req.data;
      const { Templates: DbTemplates, TemplateVersions: DbVersions } = db();

      const template = await SELECT.one.from(DbTemplates).where({ ID: templateId });
      if (!template) throw new AppError('TEMPLATE_NOT_FOUND', `Template '${templateId}' was not found.`);

      const latest = await SELECT.one.from(DbVersions).where({ template_ID: templateId }).orderBy('version desc');
      const source = template.activeVersion_ID
        ? await SELECT.one.from(DbVersions).where({ ID: template.activeVersion_ID })
        : latest;
      if (!source) {
        throw new AppError('TEMPLATE_VERSION_NOT_FOUND', `Template '${template.name}' has no version to copy from.`);
      }

      const now = new Date().toISOString();
      const newVersion = {
        ID: uuidv4(),
        template_ID: templateId,
        version: (latest ? latest.version : 0) + 1,
        status: 'DRAFT',
        layoutJson: source.layoutJson,
        sampleDataJson: source.sampleDataJson,
        createdAt: now,
        createdBy: req.user && req.user.id,
        modifiedAt: now,
        modifiedBy: req.user && req.user.id
      };
      await INSERT.into(DbVersions).entries(newVersion);
      return SELECT.one.from(DbVersions).where({ ID: newVersion.ID });
    } catch (err) {
      return rejectWith(req, err);
    }
  });

  /* ----- action duplicateTemplate ----- */
  this.on('duplicateTemplate', async (req) => {
    try {
      const { templateId } = req.data;
      const { Templates: DbTemplates, TemplateVersions: DbVersions } = db();

      const template = await SELECT.one.from(DbTemplates).where({ ID: templateId });
      if (!template) throw new AppError('TEMPLATE_NOT_FOUND', `Template '${templateId}' was not found.`);

      const latest = await SELECT.one.from(DbVersions).where({ template_ID: templateId }).orderBy('version desc');
      const source = template.activeVersion_ID
        ? await SELECT.one.from(DbVersions).where({ ID: template.activeVersion_ID })
        : latest;

      const now = new Date().toISOString();
      const newTemplateId = uuidv4();
      const newVersionId = uuidv4();

      await INSERT.into(DbTemplates).entries({
        ID: newTemplateId,
        tenantId: template.tenantId,
        name: `${template.name}-copy`,
        description: template.description,
        documentType: template.documentType,
        status: 'DRAFT',
        activeVersion_ID: null,
        createdAt: now,
        createdBy: req.user && req.user.id,
        modifiedAt: now,
        modifiedBy: req.user && req.user.id
      });

      if (source) {
        await INSERT.into(DbVersions).entries({
          ID: newVersionId,
          template_ID: newTemplateId,
          version: 1,
          status: 'DRAFT',
          layoutJson: source.layoutJson,
          sampleDataJson: source.sampleDataJson,
          createdAt: now,
          createdBy: req.user && req.user.id,
          modifiedAt: now,
          modifiedBy: req.user && req.user.id
        });
      }

      return SELECT.one.from(DbTemplates).where({ ID: newTemplateId });
    } catch (err) {
      return rejectWith(req, err);
    }
  });
});
