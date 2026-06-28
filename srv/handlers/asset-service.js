'use strict';

/**
 * AssetService — metadata management for logos and images.
 * Binary upload and usage inside templates follow in Step 24.
 */

const cds = require('@sap/cds');

module.exports = cds.service.impl(function () {
  const { Assets } = this.entities;

  this.before('CREATE', Assets, (req) => {
    req.data.tenantId = req.data.tenantId || 'default';
    req.data.createdAt = req.data.createdAt || new Date().toISOString();
    req.data.createdBy = req.data.createdBy || (req.user && req.user.id) || 'anonymous';
  });
});
