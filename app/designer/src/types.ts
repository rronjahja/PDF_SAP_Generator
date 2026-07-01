/** Types mirroring the backend layout schema (srv/lib/layout-validator.js + samples). */

export const PAGE_FORMATS: Record<string, { width: number; height: number }> = {
  A4: { width: 595, height: 842 },
  LETTER: { width: 612, height: 792 }
};

export const WINDOW_TYPES = [
  'HEADER',
  'ADDRESS',
  'METADATA',
  'TABLE',
  'TOTALS',
  'FOOTER',
  'FREE_SECTION'
] as const;
export type WindowType = (typeof WINDOW_TYPES)[number];

export const ELEMENT_TYPES = [
  'TEXT',
  'IMAGE',
  'LINE',
  'RECTANGLE',
  'ELLIPSE',
  'TRIANGLE',
  'POLYGON',
  'ARROW',
  'DIVIDER',
  'CALLOUT',
  'WATERMARK',
  'SIGNATURE',
  'BACKGROUND',
  'PAGE_BORDER',
  'CHECKBOX',
  'CURRENT_DATE',
  'QR_CODE',
  'BARCODE',
  'PAGE_NUMBER'
] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const FORMATS = ['text', 'date', 'currency', 'number', 'percentage'] as const;

export interface GradientStop { at: number; color: string }
/** Linear gradient fill. angle in degrees: 0 = left→right, 90 = top→bottom. */
export interface GradientFill { type: 'linear'; angle?: number; stops: GradientStop[] }

export interface LayoutElement {
  id: string;
  type: ElementType;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  binding?: string;
  label?: string;
  format?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  alignment?: 'left' | 'right' | 'center';
  fontFamily?: string;
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'double';
  // shapes (RECTANGLE, ELLIPSE, TRIANGLE, POLYGON, CALLOUT, BACKGROUND, ...)
  fill?: string | GradientFill;
  opacity?: number; // 0..1
  // LINE / DIVIDER
  lineStyle?: 'solid' | 'dashed' | 'dotted' | 'double';
  orientation?: 'horizontal' | 'vertical';
  thickness?: number; // also ARROW shaft
  // TRIANGLE / ARROW
  direction?: 'up' | 'down' | 'left' | 'right';
  // POLYGON
  sides?: number;
  rotation?: number;
  // ARROW
  headSize?: number;
  // DIVIDER
  labelBackground?: string;
  // CALLOUT
  accentColor?: string;
  accentWidth?: number;
  padding?: number;
  // WATERMARK
  angle?: number;
  fullPage?: boolean;
  // SIGNATURE
  showDate?: boolean;
  dateLabel?: string;
  labelColor?: string;
  // PAGE_BORDER
  inset?: number;
  borderColor?: string;
  borderWidth?: number;
  cornerRadius?: number;
  // CHECKBOX
  checked?: boolean;
  // IMAGE
  assetId?: string;
  fit?: 'contain' | 'cover';
  url?: string;
  // BARCODE
  symbology?: string;
  showText?: boolean;
  // conditional visibility (expression, e.g. "status == 'paid'")
  visibleIf?: string;
}

export const FONT_FAMILIES = ['Helvetica', 'Georgia', 'Times New Roman', 'Courier New'] as const;

export interface TableColumn {
  label: string;
  binding: string;
  width: number;
  format?: string;
  align?: 'left' | 'right' | 'center';
}

export interface LayoutWindow {
  id: string;
  name?: string;
  type: WindowType;
  x: number;
  y: number;
  width: number;
  height: number;
  page?: number; // 1-based; windows with repeatOnEveryPage appear on all pages
  repeatOnEveryPage?: boolean;
  locked?: boolean; // protected from canvas dragging
  background?: string;
  borderWidth?: number;
  borderColor?: string;
  padding?: number;
  cornerRadius?: number;
  visibleIf?: string;
  binding?: string; // TABLE windows
  grow?: boolean; // TABLE: flow rows onto continuation pages
  rowHeight?: number; // TABLE: pt per row for pagination (default 16)
  repeatHeader?: boolean; // TABLE windows
  columns?: TableColumn[]; // TABLE windows
  elements?: LayoutElement[];
}

export interface PageConfig {
  format: keyof typeof PAGE_FORMATS;
  orientation?: 'portrait' | 'landscape';
  margin?: { top: number; right: number; bottom: number; left: number };
  background?: string;
}

export interface Layout {
  page: PageConfig;
  /** brand tokens: reference as '@primary' in any color field */
  theme?: { colors?: Record<string, string> };
  pageCount?: number;
  windows: LayoutWindow[];
  /** translations: { "de": { "Invoice": "Rechnung" }, ... } */
  i18n?: Record<string, Record<string, string>>;
}

export function layoutPages(layout: Layout): number {
  return Number.isInteger(layout.pageCount) && (layout.pageCount as number) > 0 ? (layout.pageCount as number) : 1;
}

export function pageDims(layout: Layout): { width: number; height: number } {
  const f = PAGE_FORMATS[String(layout.page?.format || 'A4').toUpperCase()] ?? PAGE_FORMATS.A4;
  return layout.page?.orientation === 'landscape' ? { width: f.height, height: f.width } : f;
}

export interface TemplateVersion {
  ID: string;
  version: number;
  status: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
  layoutJson: string | null;
  sampleDataJson: string | null;
  sampleDatasets?: string | null;
  modifiedAt?: string;
}

export interface Block {
  ID: string;
  name: string;
  windowJson: string;
}

export interface VersionEvent {
  ID: string;
  action: string;
  comment?: string | null;
  createdAt: string;
  createdBy: string;
}

export interface AssetMeta {
  ID: string;
  fileName: string;
  mimeType: string;
  size: number;
}

export const BARCODE_SYMBOLOGIES = ['code128', 'ean13', 'ean8', 'upca', 'code39', 'interleaved2of5'] as const;

export interface Template {
  ID: string;
  name: string;
  description?: string | null;
  documentType?: string | null;
  status: string;
  activeVersion_ID?: string | null;
  versions?: TemplateVersion[];
}

export interface MissingField {
  binding: string;
  elementId?: string;
  windowId?: string;
}

export interface ValidationResult {
  valid: boolean;
  missingFields: MissingField[];
  warnings: string[];
}

export type Selection =
  | { kind: 'window'; windowId: string }
  | { kind: 'element'; windowId: string; elementId: string }
  | null;

/** Default geometry when a window type is dropped onto the sheet. */
export const WINDOW_DEFAULTS: Record<WindowType, { width: number; height: number }> = {
  HEADER: { width: 535, height: 60 },
  ADDRESS: { width: 240, height: 90 },
  METADATA: { width: 220, height: 90 },
  TABLE: { width: 535, height: 220 },
  TOTALS: { width: 220, height: 80 },
  FOOTER: { width: 535, height: 50 },
  FREE_SECTION: { width: 250, height: 100 }
};

export function emptyLayout(): Layout {
  return {
    page: { format: 'A4', orientation: 'portrait', margin: { top: 30, right: 30, bottom: 30, left: 30 } },
    windows: []
  };
}

/** Window ids in the SAP tradition: A, B, C … then W8, W9 … */
export function nextWindowId(layout: Layout): string {
  const used = new Set(layout.windows.map((w) => w.id));
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(c)) return c;
  let i = 1;
  while (used.has(`W${i}`)) i += 1;
  return `W${i}`;
}

export function nextElementId(win: LayoutWindow, type: ElementType): string {
  const base = type.toLowerCase().replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
  const used = new Set((win.elements ?? []).map((e) => e.id));
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}${i}`)) i += 1;
  return `${base}${i}`;
}

export interface DeliveryDestination {
  ID: string;
  name: string;
  type: 'LOCAL_DIR' | 'FTP' | 'SFTP' | 'PRINTER' | 'WEBHOOK';
  configJson: string;
  active?: boolean;
}

export interface Delivery {
  ID: string;
  document_ID?: string;
  destination: string;
  type: string;
  status: 'SUCCESS' | 'FAILED';
  detail?: string;
  createdAt: string;
}

export interface GeneratedDocument {
  ID: string;
  fileName: string;
  documentNumber?: string | null;
  status: string;
  size?: number | null;
  generatedAt: string;
  generatedBy?: string;
}