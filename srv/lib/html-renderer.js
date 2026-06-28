'use strict';

/**
 * HTML renderer (Step 8, extended).
 *
 * Pipeline: layoutJson + inputData → resolve bindings (incl. computed "=expr")
 * → apply visibility conditions → paginate (fixed pages + growing tables)
 * → generate HTML per page → apply CSS.
 *
 * Coordinates are PDF points (pt) on e.g. a 595×842pt A4 page.
 * Features: multi-page with correct page numbers, growing tables that flow
 * onto continuation pages, real QR codes (SVG) and barcodes (PNG), i18n label
 * translation, window decorations, asset images, conditional visibility.
 */

const { resolvePath, formatValue } = require('./binding-resolver');
const { pageDimensions } = require('./layout-validator');
const { isVisible } = require('./expr');

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textStyle(el) {
  const parts = [];
  if (el.fontSize) parts.push(`font-size:${el.fontSize}pt`);
  if (el.bold) parts.push('font-weight:bold');
  if (el.italic) parts.push('font-style:italic');
  if (el.alignment) parts.push(`text-align:${esc(el.alignment)}`);
  if (el.color) parts.push(`color:${esc(el.color)}`);
  if (el.fontFamily) parts.push(`font-family:${esc(el.fontFamily)}, sans-serif`);
  return parts.join(';');
}

function boxStyle(el) {
  if (typeof el.x !== 'number' && typeof el.y !== 'number') return '';
  const parts = ['position:absolute'];
  if (typeof el.x === 'number') parts.push(`left:${el.x}pt`);
  if (typeof el.y === 'number') parts.push(`top:${el.y}pt`);
  if (typeof el.width === 'number') parts.push(`width:${el.width}pt`);
  if (typeof el.height === 'number') parts.push(`height:${el.height}pt`);
  return parts.join(';');
}

function resolveText(el, data, ctx) {
  if (el.binding) {
    const { found, value } = resolvePath(data, el.binding);
    return found ? formatValue(value, el.format, ctx) : '';
  }
  return ctx.tr(el.text ?? '');
}

/* ── element renderers ─────────────────────────────────────────────── */

function renderTextElement(el, data, ctx) {
  const value = esc(resolveText(el, data, ctx));
  const style = [boxStyle(el), textStyle(el)].filter(Boolean).join(';');
  if (el.label) {
    return (
      `<div class="el el-text labeled" data-element="${esc(el.id)}" style="${style}">` +
      `<span class="lbl">${esc(ctx.tr(el.label))}</span><span class="val">${value}</span></div>`
    );
  }
  return `<div class="el el-text" data-element="${esc(el.id)}" style="${style}">${value}</div>`;
}

function renderImageElement(el, data, ctx) {
  let src = el.url || el.src || '';
  if (!src && el.binding) {
    const { found, value } = resolvePath(data, el.binding);
    if (found) src = String(value);
  }
  if (!src && el.assetId && ctx.resolveAssetUrl) src = ctx.resolveAssetUrl(el.assetId) || '';
  if (!src) return '';
  const style = boxStyle(el);
  const fit = el.fit === 'cover' || el.fit === 'contain'
    ? `width:100%;height:100%;object-fit:${el.fit}`
    : [
        typeof el.width === 'number' ? `width:${el.width}pt` : '',
        typeof el.height === 'number' ? `height:${el.height}pt` : ''
      ].filter(Boolean).join(';');
  return `<div class="el el-image" data-element="${esc(el.id)}" style="${style}"><img src="${esc(src)}" style="${fit}" alt=""/></div>`;
}

function renderLineElement(el) {
  const style = [
    boxStyle(el) || 'position:relative',
    `border-top:${typeof el.height === 'number' && el.height > 0 ? el.height : 1}pt ${esc(el.borderStyle || 'solid')} ${esc(el.color || '#333')}`
  ].join(';');
  return `<div class="el el-line" data-element="${esc(el.id)}" style="${style}"></div>`;
}

function renderRectangleElement(el) {
  const style = [
    boxStyle(el) || 'position:relative',
    `border:${typeof el.borderWidth === 'number' ? el.borderWidth : 1}pt ${esc(el.borderStyle || 'solid')} ${esc(el.borderColor || '#333')}`,
    el.fill ? `background:${esc(el.fill)}` : '',
    typeof el.cornerRadius === 'number' ? `border-radius:${el.cornerRadius}pt` : ''
  ].filter(Boolean).join(';');
  return `<div class="el el-rect" data-element="${esc(el.id)}" style="${style}"></div>`;
}

function renderCheckboxElement(el, data, ctx) {
  let checked = !!el.checked;
  if (el.binding) {
    const { found, value } = resolvePath(data, el.binding);
    if (found) checked = value === true || value === 'true' || value === 1 || value === 'X' || value === 'x';
  }
  const style = [boxStyle(el), textStyle(el)].filter(Boolean).join(';');
  const box = checked ? '&#9745;' : '&#9744;';
  const label = el.label ? ` <span class="cb-label">${esc(ctx.tr(el.label))}</span>` : '';
  return `<div class="el el-checkbox" data-element="${esc(el.id)}" style="${style}"><span class="cb">${box}</span>${label}</div>`;
}

function renderCurrentDateElement(el, ctx) {
  const value = esc(formatValue(new Date().toISOString().slice(0, 10), el.format || 'date', ctx));
  const style = [boxStyle(el), textStyle(el)].filter(Boolean).join(';');
  if (el.label) {
    return `<div class="el el-text labeled" data-element="${esc(el.id)}" style="${style}"><span class="lbl">${esc(ctx.tr(el.label))}</span><span class="val">${value}</span></div>`;
  }
  return `<div class="el el-text" data-element="${esc(el.id)}" style="${style}">${value}</div>`;
}

function renderPageNumberElement(el, ctx) {
  const pattern = ctx.tr(el.text || 'Page {{page}} of {{pages}}');
  const value = esc(pattern)
    .replace(/\{\{\s*page\s*\}\}/g, String(ctx.page || 1))
    .replace(/\{\{\s*pages\s*\}\}/g, String(ctx.pages || 1));
  const style = [boxStyle(el), textStyle(el)].filter(Boolean).join(';');
  return `<div class="el el-pagenumber" data-element="${esc(el.id)}" style="${style}">${value}</div>`;
}

function renderCodeElement(el, ctx) {
  // pre-generated in the async pre-pass; key by element identity
  const markup = ctx.codes.get(el);
  if (!markup) return '';
  const style = boxStyle(el) || 'position:relative';
  return `<div class="el el-code" data-element="${esc(el.id)}" style="${style}">${markup}</div>`;
}

function renderElement(el, data, ctx) {
  if (!isVisible(el.visibleIf, data)) return '';
  switch (el.type) {
    case 'TEXT': return renderTextElement(el, data, ctx);
    case 'IMAGE': return renderImageElement(el, data, ctx);
    case 'LINE': return renderLineElement(el);
    case 'RECTANGLE': return renderRectangleElement(el);
    case 'CHECKBOX': return renderCheckboxElement(el, data, ctx);
    case 'CURRENT_DATE': return renderCurrentDateElement(el, ctx);
    case 'PAGE_NUMBER': return renderPageNumberElement(el, ctx);
    case 'QR_CODE':
    case 'BARCODE': return renderCodeElement(el, ctx);
    default: return '';
  }
}

/* ── table rendering (supports row chunks for growing tables) ──────── */

function renderTableWindow(win, data, ctx, rowsOverride) {
  let rows;
  if (rowsOverride) {
    rows = rowsOverride;
  } else {
    const { found, value } = resolvePath(data, win.binding);
    rows = found && Array.isArray(value) ? value : [];
  }
  const columns = win.columns || [];

  const colgroup = `<colgroup>${columns.map((c) => `<col style="width:${typeof c.width === 'number' ? `${c.width}pt` : 'auto'}"/>`).join('')}</colgroup>`;
  const thead = `<thead><tr>${columns.map((c) => `<th${c.align ? ` style="text-align:${esc(c.align)}"` : ''}>${esc(ctx.tr(c.label || c.binding))}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map((row) => `<tr>${columns
      .map((c) => {
        const cell = resolvePath(row, c.binding);
        const text = cell.found ? formatValue(cell.value, c.format, ctx) : '';
        const numeric = c.format === 'currency' || c.format === 'number' || c.format === 'percentage';
        const align = c.align ? ` style="text-align:${esc(c.align)}"` : '';
        return `<td class="${numeric && !c.align ? 'num' : ''}"${align}>${esc(text)}</td>`;
      })
      .join('')}</tr>`)
    .join('')}</tbody>`;

  return `<table class="items">${colgroup}${thead}${tbody}</table>`;
}

function renderWindow(win, data, ctx, rowsOverride) {
  const decorations = [
    win.background ? `background:${esc(win.background)}` : '',
    typeof win.borderWidth === 'number' && win.borderWidth > 0
      ? `border:${win.borderWidth}pt solid ${esc(win.borderColor || '#333')}`
      : '',
    typeof win.padding === 'number' ? `padding:${win.padding}pt` : '',
    typeof win.cornerRadius === 'number' ? `border-radius:${win.cornerRadius}pt` : ''
  ].filter(Boolean).join(';');
  const style = `position:absolute;left:${win.x}pt;top:${win.y}pt;width:${win.width}pt;height:${win.height}pt;${decorations ? decorations + ';' : ''}`;
  const typeClass = `window-${String(win.type || 'free_section').toLowerCase()}`;
  let inner;
  if (win.type === 'TABLE') {
    inner = renderTableWindow(win, data, ctx, rowsOverride);
  } else {
    inner = (win.elements || []).map((el) => renderElement(el, data, ctx)).join('\n');
  }
  return `<div class="window ${typeClass}" data-window="${esc(win.id)}" style="${style}">\n${inner}\n</div>`;
}

/* ── pagination: fixed pages + growing tables ──────────────────────── */

const DEFAULT_ROW_HEIGHT = 16; // pt, includes cell padding

/**
 * Builds the final list of physical pages. Each physical page knows its base
 * layout page and, for growing tables, which slice of rows to render.
 * @returns {Array<{base:number, slices: Map<windowId, rows[]>}>}
 */
function paginate(layout, data) {
  const basePages = Number.isInteger(layout.pageCount) && layout.pageCount > 0 ? layout.pageCount : 1;
  const windows = layout.windows || [];
  const physical = [];

  for (let p = 1; p <= basePages; p++) {
    const growTables = windows.filter(
      (w) => w.type === 'TABLE' && w.grow && !w.repeatOnEveryPage && (w.page || 1) === p && isVisible(w.visibleIf, data)
    );

    // Split each growing table's rows into page-sized chunks
    const chunked = growTables.map((w) => {
      const { found, value } = resolvePath(data, w.binding);
      const rows = found && Array.isArray(value) ? value : [];
      const rowH = typeof w.rowHeight === 'number' && w.rowHeight > 4 ? w.rowHeight : DEFAULT_ROW_HEIGHT;
      const headerH = w.repeatHeader === false ? 0 : rowH + 4;
      const capacity = Math.max(1, Math.floor((w.height - headerH) / rowH));
      const chunks = [];
      for (let i = 0; i < Math.max(rows.length, 1); i += capacity) chunks.push(rows.slice(i, i + capacity));
      return { win: w, chunks };
    });

    const overflowCount = Math.max(0, ...chunked.map((c) => c.chunks.length - 1), 0);

    for (let k = 0; k <= overflowCount; k++) {
      const slices = new Map();
      for (const { win, chunks } of chunked) {
        if (chunks[k]) slices.set(win.id, chunks[k]);
        else slices.set(win.id, null); // table exhausted: hide on this continuation page
      }
      physical.push({ base: p, continuation: k > 0, slices });
    }
  }
  return physical;
}

/* ── async pre-pass: QR codes and barcodes ─────────────────────────── */

async function generateCodes(layout, data) {
  const codes = new Map();
  const jobs = [];
  for (const win of layout.windows || []) {
    for (const el of win.elements || []) {
      if (el.type !== 'QR_CODE' && el.type !== 'BARCODE') continue;
      let value = el.text || '';
      if (el.binding) {
        const { found, value: v } = resolvePath(data, el.binding);
        if (found) value = String(v);
      }
      if (!value) continue;
      jobs.push(
        (async () => {
          try {
            if (el.type === 'QR_CODE') {
              const QRCode = require('qrcode');
              const size = el.width || el.height || 60;
              const svg = await QRCode.toString(value, { type: 'svg', margin: 0, width: 256 });
              codes.set(el, `<div style="width:${size}pt;height:${size}pt">${svg.replace('<svg ', '<svg style="width:100%;height:100%" ')}</div>`);
            } else {
              const bwipjs = require('bwip-js');
              const png = await bwipjs.toBuffer({
                bcid: el.symbology || 'code128',
                text: value,
                scale: 2,
                height: Math.max(6, Math.round((el.height || 14) * 0.6)),
                includetext: el.showText !== false,
                textxalign: 'center'
              });
              const w = el.width ? `width:${el.width}pt;` : '';
              const h = el.height ? `height:${el.height}pt;` : '';
              codes.set(el, `<img src="data:image/png;base64,${png.toString('base64')}" style="${w}${h}" alt=""/>`);
            }
          } catch {
            codes.set(el, `<span class="code-error">${esc(value)}</span>`);
          }
        })()
      );
    }
  }
  await Promise.all(jobs);
  return codes;
}

/* ── document assembly ─────────────────────────────────────────────── */

function baseCss(dim) {
  return `
@page { size: ${dim.width}pt ${dim.height}pt; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; color: #111; -webkit-print-color-adjust: exact; }
.page { width: ${dim.width}pt; min-height: ${dim.height}pt; position: relative; page-break-after: always; overflow: hidden; background: #fff; }
.page:last-child { page-break-after: auto; }
.window { overflow: hidden; }
.el { line-height: 1.35; }
.el.labeled { display: flex; justify-content: space-between; gap: 8pt; }
.el .lbl { color: #555; }
.window-address .el, .window-metadata .el, .window-totals .el { margin-bottom: 2pt; }
.window-totals .el.labeled { border-bottom: 0.5pt solid #ddd; padding-bottom: 1pt; }
.window-totals .el.labeled:last-child { border-bottom: 1pt solid #333; }
table.items { width: 100%; border-collapse: collapse; font-size: 9pt; table-layout: fixed; }
table.items th { text-align: left; border-bottom: 1pt solid #333; padding: 3pt 4pt; font-weight: bold; }
table.items td { border-bottom: 0.5pt solid #ccc; padding: 3pt 4pt; word-wrap: break-word; }
table.items td.num { text-align: right; }
.window-footer { border-top: 0.5pt solid #999; padding-top: 4pt; font-size: 8pt; color: #444; display: flex; justify-content: space-between; align-items: flex-start; gap: 8pt; }
.window-footer .el { position: static; }
.el-code svg, .el-code img { display: block; }
`.trim();
}

/**
 * Renders a complete HTML document from a layout and business data.
 * Now async (QR/barcode generation). Returns {html, pages}.
 */
async function renderDocument(layout, data, options = {}) {
  const dim = pageDimensions(layout.page);
  const localeFull = options.locale || 'de-DE';
  const localeShort = String(localeFull).slice(0, 2).toLowerCase();
  const i18n = (layout.i18n && (layout.i18n[localeFull] || layout.i18n[localeShort])) || null;
  const tr = (s) => (i18n && typeof s === 'string' && i18n[s] !== undefined ? i18n[s] : s);

  const codes = await generateCodes(layout, data);
  const physical = paginate(layout, data);
  const windows = layout.windows || [];

  const pagesHtml = physical.map((phys, idx) => {
    const ctx = {
      locale: localeFull,
      currency: options.currency || (data && data.invoice && data.invoice.currency) || 'EUR',
      resolveAssetUrl: options.resolveAssetUrl,
      page: idx + 1,
      pages: physical.length,
      tr,
      codes
    };
    const pageWindows = windows.filter((w) => {
      if (!isVisible(w.visibleIf, data)) return false;
      if (w.repeatOnEveryPage) return true;
      if ((w.page || 1) !== phys.base) return false;
      if (phys.continuation) return phys.slices.has(w.id) && phys.slices.get(w.id) !== null; // only continued tables
      return true;
    });
    const inner = pageWindows
      .map((w) => {
        const slice = phys.slices.get(w.id);
        if (w.type === 'TABLE' && w.grow && slice === null) return ''; // exhausted on this page
        return renderWindow(w, data, ctx, w.type === 'TABLE' && w.grow ? slice || undefined : undefined);
      })
      .join('\n');
    const pageBg = layout.page && layout.page.background ? `;background:${esc(layout.page.background)}` : '';
    return `<div class="page" data-page="${idx + 1}" style="height:${dim.height}pt${pageBg}">\n${inner}\n</div>`;
  });

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
${baseCss(dim)}
</style>
</head>
<body>
${pagesHtml.join('\n')}
</body>
</html>`;

  return { html, pages: physical.length };
}

module.exports = { renderDocument };
