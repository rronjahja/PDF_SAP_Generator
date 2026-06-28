using { pdfforms as db } from '../db/schema';

/**
 * Step 4 — CAP services
 */

type MissingField {
  binding   : String;
  elementId : String;
  windowId  : String;
}

type ValidationResult {
  valid         : Boolean;
  missingFields : array of MissingField;
  warnings      : array of String;
}

type GenerationResult {
  documentId    : String;
  fileName      : String;
  mimeType      : String;
  contentBase64 : LargeString;
  status        : String;
  errorCode     : String;
  errorMessage  : String;
}

/** Manage templates and template versions */
@path : '/odata/v4/template'
@impl : 'srv/handlers/template-service.js'
service TemplateService {

  entity Templates        as projection on db.Templates;
  entity TemplateVersions as projection on db.TemplateVersions;

  /** Validates layout JSON, sets the version to PUBLISHED, makes it the active version, archives previously published versions */
  @(requires: 'Publisher')
  action publishTemplateVersion(templateVersionId : UUID) returns TemplateVersions;

  /** Copies the active (or latest) version into a new DRAFT version with an increased version number */
  action createNewDraftVersion(templateId : UUID)         returns TemplateVersions;

  /** Copies a template including its latest layout into a new template with a fresh DRAFT version */
  action duplicateTemplate(templateId : UUID)             returns Templates;

  /** Approval workflow: DRAFT -> REVIEW -> PUBLISHED (or back to DRAFT on reject) */
  action submitForReview(templateVersionId : UUID)        returns TemplateVersions;
  @(requires: 'Publisher')
  action approveVersion(templateVersionId : UUID, comment : String) returns TemplateVersions;
  @(requires: 'Publisher')
  action rejectVersion(templateVersionId : UUID, comment : String)  returns TemplateVersions;

  /** Reusable layout blocks */
  entity Blocks        as projection on db.Blocks;
  /** Delivery destinations (local dir, FTP, SFTP, printer, webhook) */
  @(restrict: [{ grant: 'READ', to: 'Viewer' }, { grant: '*', to: 'Admin' }])
  entity DeliveryDestinations as projection on db.DeliveryDestinations;
  /** Delivery attempts per generated document */
  @readonly entity Deliveries as projection on db.Deliveries;
  /** Lifecycle audit trail */
  @readonly entity VersionEvents as projection on db.VersionEvents;
}

/** Generate and preview PDFs. `data` is the business payload as a JSON string. */
@path : '/odata/v4/rendering'
@impl : 'srv/handlers/rendering-service.js'
service RenderingService {

  /** Generates a PDF from a published template version (templateId accepts the UUID or the template name) */
  action generatePdf(templateId : String, version : String, returnMode : String, fileName : String, data : LargeString) returns GenerationResult;

  /** Renders any template version (incl. DRAFT) using provided data or the stored sampleDataJson */
  action previewPdf(templateVersionId : UUID, data : LargeString)  returns GenerationResult;

  /** Validates input data against the bindings of the active template version */
  action validateData(templateId : String, data : LargeString)     returns ValidationResult;
}

/** Manage uploaded logos and images (metadata; binary upload follows in Step 24) */
@path : '/odata/v4/asset'
@impl : 'srv/handlers/asset-service.js'
service AssetService {
  entity Assets as projection on db.Assets;
}

/** Read generated document logs */
@path : '/odata/v4/log'
@readonly
service LogService {
  entity GeneratedDocuments as projection on db.GeneratedDocuments;
  entity GenerationLogs     as projection on db.GenerationLogs;
}
