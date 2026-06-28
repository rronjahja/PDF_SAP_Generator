namespace pdfforms;

using { cuid, managed } from '@sap/cds/common';

/**
 * Step 2 — Database model
 *
 * Entities: Templates, TemplateVersions, GeneratedDocuments, Assets, GenerationLogs
 */

type DocumentType : String(30) enum {
  INVOICE; PURCHASE_ORDER; DELIVERY_NOTE; QUOTATION; REPORT; CERTIFICATE;
};

type TemplateStatus : String(20) enum {
  DRAFT; ACTIVE; ARCHIVED;
};

type VersionStatus : String(20) enum {
  DRAFT; REVIEW; PUBLISHED; ARCHIVED;
};

type GenerationStatus : String(20) enum {
  SUCCESS; ERROR; PROCESSING;
};

/** Main form template metadata */
entity Templates : cuid, managed {
  tenantId      : String(36) default 'default';
  name          : String(100) @mandatory;
  description   : String(500);
  documentType  : DocumentType default #INVOICE;
  status        : TemplateStatus default #DRAFT;
  activeVersion : Association to TemplateVersions;
  /** e.g. "invoice-{invoice.number}-{date}.pdf" — placeholders resolve from request data */
  fileNamePattern     : String(255);
  /** JSON array of destination names applied when a request specifies none */
  defaultDestinations : String(1000);
  defaultLocale       : String(10);
  versions      : Composition of many TemplateVersions on versions.template = $self;
  assets        : Composition of many Assets on assets.template = $self;
}

/**
 * Versioned layouts.
 * Rule: PUBLISHED versions must not be changed directly — changing a published
 * template requires creating a new DRAFT version (enforced in TemplateService).
 */
entity TemplateVersions : cuid, managed {
  template       : Association to Templates @mandatory;
  version        : Integer default 1;
  status         : VersionStatus default #DRAFT;
  layoutJson     : LargeString;
  sampleDataJson : LargeString;
  /** named test datasets: { "name": "<json string>", ... } */
  sampleDatasets : LargeString;
}

/** Metadata of generated PDFs */
entity GeneratedDocuments : cuid {
  tenantId        : String(36) default 'default';
  template        : Association to Templates;
  templateVersion : Association to TemplateVersions;
  documentNumber  : String(60);
  fileName        : String(255);
  mimeType        : String(100) default 'application/pdf';
  storageUrl      : String(500);
  content         : LargeBinary;
  size            : Integer;
  returnMode      : String(20) default 'base64';
  status          : GenerationStatus;
  errorMessage    : String(2000);
  generatedAt     : Timestamp;
  generatedBy     : String(255);
}

/** Reusable template assets (logos, images, ...) */
entity Assets : cuid {
  tenantId   : String(36) default 'default';
  template   : Association to Templates;
  fileName   : String(255);
  mimeType   : String(100);
  storageUrl : String(500);
  content    : LargeBinary;
  size       : Integer;
  createdAt  : Timestamp @cds.on.insert : $now;
  createdBy  : String(255) @cds.on.insert : $user;
}

/** Technical generation logs */
entity GenerationLogs : cuid {
  tenantId        : String(36) default 'default';
  template        : Association to Templates;
  templateVersion : Association to TemplateVersions;
  requestId       : String(36);
  status          : GenerationStatus;
  durationMs      : Integer;
  errorCode       : String(50);
  errorMessage    : String(2000);
  createdAt       : Timestamp @cds.on.insert : $now;
  createdBy       : String(255) @cds.on.insert : $user;
}

/** Reusable layout blocks (windows saved for reuse across templates) */
entity Blocks : cuid, managed {
  tenantId   : String(36) default 'default';
  name       : String(120);
  windowJson : LargeString;
}

/** Audit trail for the version lifecycle (submit/approve/reject/publish) */
entity VersionEvents : cuid {
  tenantId        : String(36) default 'default';
  templateVersion : Association to TemplateVersions;
  action          : String(30);   // SUBMITTED | APPROVED | REJECTED | PUBLISHED | ARCHIVED | CREATED
  comment         : String(1000);
  createdAt       : Timestamp @cds.on.insert : $now;
  createdBy       : String(255) @cds.on.insert : $user;
}

/** Where generated PDFs are sent: local folder, FTP/SFTP, printer, or webhook */
entity DeliveryDestinations : cuid, managed {
  tenantId : String(36) default 'default';
  name     : String(60) @mandatory;
  type     : String(20) @mandatory; // LOCAL_DIR | FTP | SFTP | PRINTER | WEBHOOK
  /** type-specific settings as JSON, see README ("Delivery destinations") */
  configJson : LargeString;
  active   : Boolean default true;
}

/** One row per delivery attempt of a generated document */
entity Deliveries : cuid {
  tenantId    : String(36) default 'default';
  document    : Association to GeneratedDocuments;
  destination : String(60);
  type        : String(20);
  status      : String(20); // SUCCESS | FAILED
  detail      : String(2000);
  createdAt   : Timestamp @cds.on.insert : $now;
}
