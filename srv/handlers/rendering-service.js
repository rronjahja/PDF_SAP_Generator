'use strict';

/**
 * RenderingService — Steps 9 (generatePdf), 10 (validateData), 11 (previewPdf)
 *
 * The `data` action parameter is the business payload as a JSON string
 * (OData actions cannot take arbitrary JSON objects). The runtime REST API
 * in srv/server.js accepts plain JSON bodies instead.
 */

const cds = require('@sap/cds');
const generation = require('../lib/generation');
const { rejectWith } = require('../lib/errors');

module.exports = cds.service.impl(function () {
  this.on('generatePdf', async (req) => {
    try {
      const { templateId, version, returnMode, fileName, data } = req.data;
      return await generation.generate({
        templateKey: templateId,
        version: version || 'latest',
        returnMode: returnMode || 'base64',
        fileName,
        data,
        user: req.user && req.user.id,
        tenantId: 'default' // tenant derivation from JWT follows in Step 26
      });
    } catch (err) {
      return rejectWith(req, err);
    }
  });

  this.on('previewPdf', async (req) => {
    try {
      const { templateVersionId, data } = req.data;
      return await generation.generate({
        templateVersionId,
        data,
        preview: true,
        user: req.user && req.user.id,
        tenantId: 'default'
      });
    } catch (err) {
      return rejectWith(req, err);
    }
  });

  this.on('validateData', async (req) => {
    try {
      const { templateId, data } = req.data;
      return await generation.validate({ templateKey: templateId, data, tenantId: 'default' });
    } catch (err) {
      return rejectWith(req, err);
    }
  });
});
