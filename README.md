# PDF Form Builder — SAP BTP CAP Backend

Backend foundation (Steps 1–12 of the requirement document) for the drag-and-drop
PDF form builder and generation API. Built with SAP CAP (Node.js), SQLite for
local development (HANA Cloud profile prepared for production), and
HTML-to-PDF rendering via Playwright Chromium.

## Quick start

```bash
npm install
npx playwright install chromium   # one-time browser download
npm start                          # serves on http://localhost:4004
```

If Playwright's browser CDN is unreachable in your environment, either set
`PDF_CHROMIUM_PATH` to an existing Chrome/Chromium binary, or rely on the
optional `@sparticuz/chromium` package (installed automatically as an
optional dependency), which bundles a headless Chromium served from the npm
registry. The resolution order at runtime is:

1. `PDF_CHROMIUM_PATH` environment variable
2. Playwright's managed Chromium (`npx playwright install chromium`)
3. `@sparticuz/chromium` fallback, if installed

On startup the server seeds a sample template `invoice-standard` with one
PUBLISHED version (layout and sample data from `srv/samples/`).

## Tests

```bash
npm test                  # 31 unit tests (binding resolver, layout validator, HTML renderer)
bash test/e2e-verify.sh   # 16 end-to-end checks against a running local server
```

## Runtime REST API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/templates/{templateIdOrName}/generate` | Generate a PDF from a published template version |
| POST | `/api/v1/templates/{templateIdOrName}/validate` | Validate input data against the template's bindings |
| POST | `/api/v1/template-versions/{versionId}/preview` | Preview any version (drafts allowed); falls back to the version's sample data |
| GET/POST | `/api/v1/template-versions/{versionId}/preview.html` | Debug helper: rendered HTML without invoking Chromium |

### Generate example

```bash
curl -X POST http://localhost:4004/api/v1/templates/invoice-standard/generate \
  -H "Content-Type: application/json" \
  -d '{
    "version": "latest",
    "returnMode": "base64",
    "data": { ...see srv/samples/invoice-data.json... }
  }'
```

Response:

```json
{
  "documentId": "…",
  "fileName": "invoice-9000001234.pdf",
  "mimeType": "application/pdf",
  "status": "SUCCESS",
  "contentBase64": "JVBERi0…"
}
```

`version` accepts `"latest"` (the template's active published version, default),
or a specific version number. `returnMode` currently supports `base64` (MVP).

### Error format

All errors are structured as `{ "error": { "code", "message", "details?" } }`
using the spec's error codes: `TEMPLATE_NOT_FOUND`, `NO_PUBLISHED_VERSION`,
`INVALID_LAYOUT_JSON`, `INVALID_INPUT_DATA`, `MISSING_REQUIRED_FIELD` (details
list each missing binding with `elementId` and `windowId`),
`TABLE_BINDING_NOT_ARRAY`, `PDF_RENDERING_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`,
`GENERATION_LIMIT_EXCEEDED`.

## OData services (design time)

- `/odata/v4/template` — Templates and TemplateVersions CRUD plus actions
  `publishTemplateVersion`, `createNewDraftVersion`, `duplicateTemplate`.
  Published versions are locked: updates and deletes are rejected with
  `FORBIDDEN`; changes require a new draft version. Publishing archives the
  previously published version and switches the template's active version.
- `/odata/v4/rendering` — `generatePdf`, `previewPdf`, `validateData` actions
  (data passed as a JSON string; the REST API above is the preferred runtime
  entry point).
- `/odata/v4/asset` — asset metadata stub (binary upload arrives with Step 24).
- `/odata/v4/log` — read-only access to `GenerationLogs` and
  `GeneratedDocuments`. Every generation attempt is logged with `requestId`,
  status, and `durationMs`.

## Project layout

```
db/schema.cds              Entities: Templates, TemplateVersions, GeneratedDocuments,
                           Assets, GenerationLogs (all tenant-aware)
srv/form-service.cds       Service definitions
srv/server.js              Custom CAP server + REST routes + seeding hook
srv/handlers/              CAP service handlers (template lifecycle, rendering, assets)
srv/lib/binding-resolver.js  Path resolution (customer.name, items[].material),
                             de-DE formatting (date/currency/number/percentage),
                             missing-field detection
srv/lib/layout-validator.js  Layout JSON validation (window/element types, table
                             rules, footer fit, A4/Letter page geometry in pt)
srv/lib/html-renderer.js     Layout + data -> print-ready HTML (absolute positioning)
srv/lib/pdf-generator.js     HTML -> PDF via Playwright Chromium (singleton browser)
srv/lib/generation.js        Orchestration: template/version resolution, validation,
                             rendering, persistence, logging
srv/lib/seed.js              Sample template seeding
srv/samples/                 Sample invoice layout + data from the spec
test/                        Unit tests + e2e smoke script
```

## Implemented (Steps 1–12)

1. CAP project setup with dev (SQLite in-memory, mocked auth) and prod
   (HANA, XSUAA) profiles
2. Data model with version lifecycle (DRAFT → PUBLISHED → ARCHIVED)
3. Sample invoice template and data
4. Services: Template, Rendering, Asset (stub), Log
5. Template lifecycle actions with publish locking
6. Binding resolver with formats and missing-field detection
7. Layout validator covering all spec rules
8. HTML renderer (absolute positioning, tables, escaping)
9. PDF generation via Playwright
10. Generation orchestration with persistence
11. Generation/document logging
12. Runtime REST API with structured error codes

## Known limitations (documented MVP scope)

- Single-page rendering: `PAGE_NUMBER` always renders "Page 1 of 1";
  multi-page flow with repeating headers is a later step.
- `QR_CODE`/`BARCODE` elements fall back to text rendering for now.
- `tenantId` is fixed to `default` until tenant isolation (Step 26).
- `returnMode` supports `base64` only (per MVP definition).
- Asset binary upload, auth/roles, usage limits, monitoring, and BTP
  deployment artifacts (mta.yaml, xs-security.json) arrive in Steps 24+.

## Next steps

Steps 13–21: React + TypeScript + Vite + dnd-kit drag-and-drop designer
frontend, followed by asset upload (24), XSUAA auth and roles (25),
tenant isolation (26), and BTP deployment (32).
