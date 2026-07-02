import type { Template, TemplateVersion, ValidationResult } from './types';

/** Thin client over the CAP OData services and the runtime REST API. */

const ODATA = '/odata/v4/template';

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    },
    ...init
  });

  if (res.status === 401) {
    window.location.assign('/designer/');
    throw new Error('Session expired or missing; redirecting to login');
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = body?.error || {};
    const e = new Error(err.message || `${res.status} ${res.statusText}`) as Error & {
      code?: string;
      details?: unknown;
    };
    e.code = err.code;
    e.details = err.details;
    throw e;
  }

  return body as T;
}

export async function listTemplates(): Promise<Template[]> {
  const r = await http<{ value: Template[] }>(
    `${ODATA}/Templates?$expand=versions($orderby=version desc)&$orderby=name`
  );
  return r.value;
}

/** Headline: upload a PDF, get back an auto-extracted editable template. */
export async function importTemplatePdf(
  file: File,
  name: string
): Promise<{ templateId: string; versionId: string; name: string; stats: Record<string, number> }> {
  const res = await fetch(`/api/v1/templates/import?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf' },
    body: file
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error?.message ?? msg; } catch { /* keep status */ }
    throw new Error(msg);
  }
  return res.json();
}

export async function getTemplate(id: string): Promise<Template> {
  return http<Template>(`${ODATA}/Templates(${id})?$expand=versions($orderby=version desc)`);
}

export async function createTemplate(name: string, documentType: string): Promise<Template> {
  const t = await http<Template>(`${ODATA}/Templates`, {
    method: 'POST',
    body: JSON.stringify({ name, documentType })
  });
  await http<TemplateVersion>(`${ODATA}/TemplateVersions`, {
    method: 'POST',
    body: JSON.stringify({
      template_ID: t.ID,
      layoutJson: JSON.stringify({
        page: { format: 'A4', orientation: 'portrait', margin: { top: 30, right: 30, bottom: 30, left: 30 } },
        windows: []
      }),
      sampleDataJson: '{}'
    })
  });
  return t;
}

export async function saveVersion(
  id: string,
  layoutJson: string,
  sampleDataJson: string,
  sampleDatasets?: string
): Promise<void> {
  const body: Record<string, string> = { layoutJson, sampleDataJson };
  if (sampleDatasets !== undefined) body.sampleDatasets = sampleDatasets;
  await http(`${ODATA}/TemplateVersions(${id})`, {
    method: 'PATCH',
    body: JSON.stringify(body)
  });
}

export async function publishVersion(templateVersionId: string): Promise<TemplateVersion> {
  return http<TemplateVersion>(`${ODATA}/publishTemplateVersion`, {
    method: 'POST',
    body: JSON.stringify({ templateVersionId })
  });
}

export async function createDraft(templateId: string): Promise<TemplateVersion> {
  return http<TemplateVersion>(`${ODATA}/createNewDraftVersion`, {
    method: 'POST',
    body: JSON.stringify({ templateId })
  });
}

export async function duplicateTemplate(templateId: string): Promise<Template> {
  return http<Template>(`${ODATA}/duplicateTemplate`, {
    method: 'POST',
    body: JSON.stringify({ templateId })
  });
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await http(`${ODATA}/Templates(${templateId})`, { method: 'DELETE' });
}

export async function validateData(
  templateId: string,
  data: unknown
): Promise<ValidationResult> {
  return http<ValidationResult>(`/api/v1/templates/${templateId}/validate`, {
    method: 'POST',
    body: JSON.stringify({ data })
  });
}

/** Renders a preview PDF for any version (drafts included) and opens it in a new tab. */
export async function previewPdf(versionId: string, data?: unknown, locale?: string): Promise<void> {
  const r = await http<{ contentBase64: string; fileName: string }>(
    `/api/v1/template-versions/${versionId}/preview`,
    { method: 'POST', body: JSON.stringify({ ...(data ? { data } : {}), ...(locale ? { locale } : {}) }) }
  );
  const bytes = Uint8Array.from(atob(r.contentBase64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  window.open(url, '_blank');
}

export function previewHtmlUrl(versionId: string): string {
  return `/api/v1/template-versions/${versionId}/preview.html`;
}


/* ── v4 additions ──────────────────────────────────────────────────── */
import type { AssetMeta, Block, VersionEvent } from './types';

export async function renderHtml(layout: unknown, data: unknown, locale?: string): Promise<{ html: string; pages: number }> {
  return http('/api/v1/render-html', { method: 'POST', body: JSON.stringify({ layout, data, locale }) });
}

export async function listBlocks(): Promise<Block[]> {
  const r = await http<{ value: Block[] }>(`${ODATA}/Blocks?$orderby=name`);
  return r.value;
}
export async function saveBlock(name: string, windowJson: string): Promise<Block> {
  return http<Block>(`${ODATA}/Blocks`, { method: 'POST', body: JSON.stringify({ name, windowJson, tenantId: 'default' }) });
}
export async function deleteBlock(id: string): Promise<void> {
  await http(`${ODATA}/Blocks(${id})`, { method: 'DELETE' });
}

export async function listAssets(): Promise<AssetMeta[]> {
  const r = await http<{ value: AssetMeta[] }>(`/odata/v4/asset/Assets?$select=ID,fileName,mimeType,size&$orderby=fileName`);
  return r.value;
}
export async function uploadAsset(fileName: string, mimeType: string, contentBase64: string): Promise<AssetMeta> {
  return http('/api/v1/assets', { method: 'POST', body: JSON.stringify({ fileName, mimeType, contentBase64 }) });
}
export const assetUrl = (id: string) => `/api/v1/assets/${id}`;

export async function submitForReview(templateVersionId: string): Promise<void> {
  await http(`${ODATA}/submitForReview`, { method: 'POST', body: JSON.stringify({ templateVersionId }) });
}
export async function approveVersion(templateVersionId: string, comment?: string): Promise<void> {
  await http(`${ODATA}/approveVersion`, { method: 'POST', body: JSON.stringify({ templateVersionId, comment }) });
}
export async function rejectVersion(templateVersionId: string, comment?: string): Promise<void> {
  await http(`${ODATA}/rejectVersion`, { method: 'POST', body: JSON.stringify({ templateVersionId, comment }) });
}
export async function listEvents(versionId: string): Promise<VersionEvent[]> {
  const r = await http<{ value: VersionEvent[] }>(
    `${ODATA}/VersionEvents?$filter=templateVersion_ID eq ${versionId}&$orderby=createdAt desc`
  );
  return r.value;
}

/* ── v6: destinations, documents, template settings ─────────────────── */
import type { Delivery, DeliveryDestination, GeneratedDocument } from './types';

export async function listDestinations(): Promise<DeliveryDestination[]> {
  const r = await http<{ value: DeliveryDestination[] }>(`${ODATA}/DeliveryDestinations?$orderby=name`);
  return r.value;
}
export async function createDestination(d: Partial<DeliveryDestination>): Promise<DeliveryDestination> {
  return http(`${ODATA}/DeliveryDestinations`, { method: 'POST', body: JSON.stringify({ tenantId: 'default', ...d }) });
}
export async function updateDestination(id: string, patch: Partial<DeliveryDestination>): Promise<void> {
  await http(`${ODATA}/DeliveryDestinations(${id})`, { method: 'PATCH', body: JSON.stringify(patch) });
}
export async function deleteDestination(id: string): Promise<void> {
  await http(`${ODATA}/DeliveryDestinations(${id})`, { method: 'DELETE' });
}
export async function testDestinationById(id: string): Promise<{ status: string; detail: string }> {
  return http(`/api/v1/destinations/${id}/test`, { method: 'POST', body: '{}' });
}

export async function listDocuments(): Promise<GeneratedDocument[]> {
  const r = await http<{ value: GeneratedDocument[] }>(
    `/odata/v4/log/GeneratedDocuments?$select=ID,fileName,documentNumber,status,size,generatedAt,generatedBy&$orderby=generatedAt desc&$top=100`
  );
  return r.value;
}
export async function listDeliveries(): Promise<Delivery[]> {
  const r = await http<{ value: Delivery[] }>(
    `${ODATA}/Deliveries?$orderby=createdAt desc&$top=300`
  );
  return r.value;
}
export const documentDownloadUrl = (id: string) => `/api/v1/documents/${id}/download`;

export async function updateTemplateSettings(
  id: string,
  patch: { fileNamePattern?: string | null; defaultDestinations?: string | null; defaultLocale?: string | null }
): Promise<void> {
  await http(`${ODATA}/Templates(${id})`, { method: 'PATCH', body: JSON.stringify(patch) });
}