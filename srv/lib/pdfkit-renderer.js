'use strict';

/**
 * pdfkit-renderer.js
 *
 * A Chromium-free PDF backend for the same layoutJson the designer saves.
 * It mirrors html-renderer.js semantics (windows, absolute + flow elements,
 * labeled rows, totals borders, tables with growing/pagination, QR + barcode,
 * footer) but draws with pdfkit instead of HTML + headless Chrome — so it runs
 * inside SAP BAS (non-root, no system libraries).
 *
 * Reuses the project's own binding-resolver / expr / layout-validator, so
 * binding resolution, value formatting (de-DE etc.) and page geometry are
 * identical to the HTML pipeline.
 *
 * Exports: async renderPdf(layout, data, options) -> Buffer
 */

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const { resolvePath, formatValue } = require('./binding-resolver');
const { isVisible } = require('./expr');
const { pageDimensions } = require('./layout-validator');
const S = require('./style');

const DEFAULT_ROW_HEIGHT = 16;

function fontFor(el) {
  if (el.bold && el.italic) return 'Helvetica-BoldOblique';
  if (el.bold) return 'Helvetica-Bold';
  if (el.italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

function resolveText(el, data, ctx) {
  if (el.binding) {
    const { found, value } = resolvePath(data, el.binding);
    return found ? formatValue(value, el.format, ctx) : '';
  }
  return ctx.tr(el.text != null ? el.text : '');
}

/* ── pagination: fixed pages + growing tables (ported from html-renderer) ── */
function paginate(layout, data) {
  const basePages = Number.isInteger(layout.pageCount) && layout.pageCount > 0 ? layout.pageCount : 1;
  const windows = layout.windows || [];
  const physical = [];
  for (let p = 1; p <= basePages; p++) {
    const growTables = windows.filter(
      (w) => w.type === 'TABLE' && w.grow && !w.repeatOnEveryPage && (w.page || 1) === p && isVisible(w.visibleIf, data)
    );
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
      for (const { win, chunks } of chunked) slices.set(win.id, chunks[k] || null);
      physical.push({ base: p, continuation: k > 0, slices });
    }
  }
  return physical;
}

/* ── async pre-pass: QR codes and barcodes as PNG buffers ──────────────── */
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
              codes.set(el, await QRCode.toBuffer(value, { type: 'png', margin: 1, width: 256 }));
            } else {
              codes.set(el, await bwipjs.toBuffer({
                bcid: el.symbology || 'code128',
                text: value,
                scale: 3,
                height: Math.max(6, Math.round((el.height || 14) * 0.5)),
                includetext: el.showText !== false,
                textxalign: 'center'
              }));
            }
          } catch {
            codes.set(el, null);
          }
        })()
      );
    }
  }
  await Promise.all(jobs);
  return codes;
}

/* ── element drawing ───────────────────────────────────────────────────── */
function drawTextAt(doc, el, str, gx, gy) {
  const fs = el.fontSize || 10;
  doc.font(fontFor(el)).fontSize(fs).fillColor(S.resolveColor(el.color, doc._theme) || '#111111');
  const opts = { lineGap: fs * 0.35 };
  if (typeof el.width === 'number') { opts.width = el.width; opts.align = el.alignment || 'left'; }
  else { opts.lineBreak = false; if (el.alignment) opts.align = el.alignment; }
  doc.text(str == null ? '' : String(str), gx, gy, opts);
}

function drawAbsoluteElement(doc, el, win, data, ctx, codes) {
  const gx = win.x + (el.x || 0);
  const gy = win.y + (el.y || 0);
  switch (el.type) {
    case 'TEXT': {
      if (el.label !== undefined) {
        const w = el.width || 120;
        doc.font('Helvetica').fontSize(el.fontSize || 10).fillColor('#555555').text(ctx.tr(el.label), gx, gy, { lineBreak: false });
        doc.font(fontFor(el)).fontSize(el.fontSize || 10).fillColor(S.resolveColor(el.color, doc._theme) || '#111111').text(resolveText(el, data, ctx), gx, gy, { width: w, align: 'right', lineBreak: false });
      } else {
        drawTextAt(doc, el, resolveText(el, data, ctx), gx, gy);
      }
      break;
    }
    case 'RECTANGLE': {
      const w = el.width || 0, h = el.height || 0;
      const r = typeof el.cornerRadius === 'number' ? el.cornerRadius : 0;
      const path = () => (r > 0 ? doc.roundedRect(gx, gy, w, h, r) : doc.rect(gx, gy, w, h));
      S.paintShape(doc, path, S.styleOf(el), { x: gx, y: gy, w, h });
      break;
    }
    case 'LINE': {
      const vertical = el.orientation === 'vertical';
      const len = vertical ? (el.height || 0) : (el.width || 0);
      const thick = typeof el.thickness === 'number' ? el.thickness
        : (!vertical && typeof el.height === 'number' && el.height > 0 ? el.height : 1);
      S.drawLine(doc, gx, gy, len, { vertical, thickness: thick, color: el.color, style: el.lineStyle });
      break;
    }
    case 'QR_CODE':
    case 'BARCODE': {
      const png = codes.get(el);
      if (png) {
        const w = el.width || el.height || 60;
        const h = el.height || el.width || 60;
        doc.image(png, gx, gy, { width: w, height: h });
      }
      break;
    }
    case 'PAGE_NUMBER': {
      const pattern = ctx.tr(el.text || 'Page {{page}} of {{pages}}');
      const str = pattern.replace(/\{\{\s*page\s*\}\}/g, String(ctx.page)).replace(/\{\{\s*pages\s*\}\}/g, String(ctx.pages));
      drawTextAt(doc, el, str, gx, gy);
      break;
    }
    case 'CURRENT_DATE': {
      drawTextAt(doc, el, formatValue(new Date().toISOString().slice(0, 10), el.format || 'date', ctx), gx, gy);
      break;
    }
    case 'CHECKBOX': {
      let checked = !!el.checked;
      if (el.binding) {
        const { found, value } = resolvePath(data, el.binding);
        if (found) checked = value === true || value === 'true' || value === 1 || value === 'X' || value === 'x';
      }
      const label = el.label ? `  ${ctx.tr(el.label)}` : '';
      drawTextAt(doc, { ...el }, `${checked ? '\u2611' : '\u2610'}${label}`, gx, gy);
      break;
    }
    case 'IMAGE': {
      let src = el.url || el.src || '';
      if (!src && el.binding) { const { found, value } = resolvePath(data, el.binding); if (found) src = String(value); }
      if (src && src.startsWith('data:image')) {
        try {
          const buf = Buffer.from(src.split(',')[1], 'base64');
          if (el.fit === 'contain' && el.width && el.height) doc.image(buf, gx, gy, { fit: [el.width, el.height], align: 'center', valign: 'center' });
          else if (el.fit === 'cover' && el.width && el.height) {
            doc.save(); doc.rect(gx, gy, el.width, el.height).clip();
            doc.image(buf, gx, gy, { cover: [el.width, el.height] });
            doc.restore();
          } else doc.image(buf, gx, gy, { width: el.width, height: el.height });
        } catch { /* ignore */ }
      }
      break;
    }
    case 'ELLIPSE': {
      const w = el.width || 0, h = el.height || 0;
      S.paintShape(doc, () => doc.ellipse(gx + w / 2, gy + h / 2, w / 2, h / 2), S.styleOf(el), { x: gx, y: gy, w, h });
      break;
    }
    case 'TRIANGLE': {
      S.drawTriangle(doc, { x: gx, y: gy, w: el.width || 0, h: el.height || 0 }, el);
      break;
    }
    case 'POLYGON': {
      S.drawPolygon(doc, { x: gx, y: gy, w: el.width || 0, h: el.height || 0 }, el);
      break;
    }
    case 'ARROW': {
      S.drawArrow(doc, { x: gx, y: gy, w: el.width || 0, h: el.height || 0 }, el);
      break;
    }
    case 'DIVIDER': {
      const label = el.label != null ? ctx.tr(el.label) : (el.text != null ? ctx.tr(el.text) : null);
      S.drawDivider(doc, { x: gx, y: gy, w: el.width || win.width, h: el.height || 0 }, el, label);
      break;
    }
    case 'CALLOUT': {
      S.drawCallout(doc, { x: gx, y: gy, w: el.width || 120, h: el.height || 40 }, el, resolveText(el, data, ctx));
      break;
    }
    case 'WATERMARK': {
      if (el.fullPage) break; // handled at page scope in renderPdf
      S.drawWatermark(doc, el, { x: gx, y: gy, w: el.width || 200, h: el.height || 60 }, resolveText(el, data, ctx) || el.text || 'DRAFT');
      break;
    }
    case 'SIGNATURE': {
      S.drawSignature(doc, { x: gx, y: gy, w: el.width || 160, h: el.height || 40 }, el, (t) => ctx.tr(t));
      break;
    }
    case 'BACKGROUND':
    case 'PAGE_BORDER':
      break; // handled at page scope in renderPdf
    default:
      break;
  }
}

function drawFlowElements(doc, win, data, ctx) {
  const pad = typeof win.padding === 'number' ? win.padding : 0;
  const innerX = win.x + pad;
  const innerW = win.width - 2 * pad;
  const flow = (win.elements || []).filter((el) => isVisible(el.visibleIf, data) && typeof el.x !== 'number' && typeof el.y !== 'number'
    && el.type !== 'BACKGROUND' && el.type !== 'PAGE_BORDER' && !(el.type === 'WATERMARK' && el.fullPage));
  const isTotals = win.type === 'TOTALS';
  let cy = win.y + pad;
  flow.forEach((el, i) => {
    const fs = el.fontSize || 10;
    const lineH = fs * 1.35;
    if (el.label !== undefined) {
      doc.font('Helvetica').fontSize(fs).fillColor('#555555').text(ctx.tr(el.label), innerX, cy, { lineBreak: false });
      doc.font(fontFor(el)).fontSize(fs).fillColor(el.color || '#111111').text(resolveText(el, data, ctx), innerX, cy, { width: innerW, align: 'right', lineBreak: false });
      cy += lineH + 2;
      if (isTotals) {
        const last = i === flow.length - 1;
        doc.moveTo(innerX, cy - 1).lineTo(innerX + innerW, cy - 1).lineWidth(last ? 1 : 0.5).strokeColor(last ? '#333333' : '#dddddd').stroke();
        cy += 2;
      }
    } else {
      doc.font(fontFor(el)).fontSize(fs).fillColor(el.color || '#111111').text(resolveText(el, data, ctx), innerX, cy, { width: innerW, align: el.alignment || 'left', lineBreak: false });
      cy += lineH + 2;
    }
  });
}

function drawTable(doc, win, data, ctx, rowsOverride) {
  const cols = win.columns || [];
  let rows;
  if (rowsOverride !== undefined) rows = rowsOverride || [];
  else { const { found, value } = resolvePath(data, win.binding); rows = found && Array.isArray(value) ? value : []; }

  const totalW = cols.reduce((a, c) => a + (typeof c.width === 'number' ? c.width : 60), 0) || win.width;
  const scale = win.width / totalW;
  const colW = cols.map((c) => (typeof c.width === 'number' ? c.width : 60) * scale);
  const fs = 9, padX = 4;
  const rowH = typeof win.rowHeight === 'number' && win.rowHeight > 4 ? win.rowHeight : DEFAULT_ROW_HEIGHT;
  const x0 = win.x;
  let y = win.y;

  if (win.repeatHeader !== false) {
    let cx = x0;
    doc.font('Helvetica-Bold').fontSize(fs).fillColor('#111111');
    cols.forEach((c, i) => {
      doc.text(ctx.tr(c.label || c.binding || ''), cx + padX, y + 4, { width: colW[i] - 2 * padX, align: c.align || 'left', lineBreak: false });
      cx += colW[i];
    });
    y += rowH;
    doc.moveTo(x0, y).lineTo(x0 + win.width, y).lineWidth(1).strokeColor('#333333').stroke();
  }
  for (const row of rows) {
    let cx = x0;
    cols.forEach((c, i) => {
      const cell = resolvePath(row, c.binding);
      const text = cell.found ? formatValue(cell.value, c.format, ctx) : '';
      const numeric = c.format === 'currency' || c.format === 'number' || c.format === 'percentage';
      const align = c.align || (numeric ? 'right' : 'left');
      doc.font('Helvetica').fontSize(fs).fillColor('#111111').text(String(text), cx + padX, y + 4, { width: colW[i] - 2 * padX, align, lineBreak: false });
      cx += colW[i];
    });
    y += rowH;
    doc.moveTo(x0, y).lineTo(x0 + win.width, y).lineWidth(0.5).strokeColor('#cccccc').stroke();
  }
}

function drawFooter(doc, win, data, ctx) {
  const pad = typeof win.padding === 'number' ? win.padding : 0;
  const x0 = win.x + pad;
  const innerW = win.width - 2 * pad;
  if (!win.background) {
    doc.moveTo(win.x, win.y).lineTo(win.x + win.width, win.y).lineWidth(0.5).strokeColor('#999999').stroke();
  }
  const ty = win.y + pad + 4;
  const els = (win.elements || []).filter((el) => isVisible(el.visibleIf, data));
  const pageEl = els.find((e) => e.type === 'PAGE_NUMBER');
  const textEls = els.filter((e) => e.type !== 'PAGE_NUMBER');
  if (textEls.length) {
    const leftStr = textEls.map((e) => resolveText(e, data, ctx)).join('   ');
    const c = textEls[0].color || '#444444';
    doc.font('Helvetica').fontSize(textEls[0].fontSize || 8).fillColor(c).text(leftStr, x0, ty, { width: innerW * 0.72, lineBreak: false });
  }
  if (pageEl) {
    const pattern = ctx.tr(pageEl.text || 'Page {{page}} of {{pages}}');
    const str = pattern.replace(/\{\{\s*page\s*\}\}/g, String(ctx.page)).replace(/\{\{\s*pages\s*\}\}/g, String(ctx.pages));
    doc.font('Helvetica').fontSize(pageEl.fontSize || 8).fillColor(pageEl.color || '#444444').text(str, x0, ty, { width: innerW, align: 'right', lineBreak: false });
  }
}

function drawWindow(doc, win, data, ctx, codes, rowsOverride) {
  const r = typeof win.cornerRadius === 'number' ? win.cornerRadius : 0;
  const path = () => (r > 0 ? doc.roundedRect(win.x, win.y, win.width, win.height, r) : doc.rect(win.x, win.y, win.width, win.height));

  // decorations
  if (win.background) { path(); doc.fillColor(S.resolveColor(win.background, doc._theme)).fill(); }
  if (typeof win.borderWidth === 'number' && win.borderWidth > 0) { path(); doc.lineWidth(win.borderWidth).strokeColor(S.resolveColor(win.borderColor, doc._theme) || '#333333').stroke(); }

  // contents (clipped to the window)
  doc.save();
  path(); doc.clip();
  if (win.type === 'TABLE') drawTable(doc, win, data, ctx, rowsOverride);
  else if (win.type === 'FOOTER') drawFooter(doc, win, data, ctx);
  else {
    drawFlowElements(doc, win, data, ctx);
    (win.elements || []).forEach((el) => {
      if (isVisible(el.visibleIf, data) && (typeof el.x === 'number' || typeof el.y === 'number')) drawAbsoluteElement(doc, el, win, data, ctx, codes);
    });
  }
  doc.restore();
}

/* ── document assembly ─────────────────────────────────────────────────── */
async function renderPdf(layout, data, options = {}) {
  const dim = pageDimensions(layout.page);
  const localeFull = options.locale || 'de-DE';
  const localeShort = String(localeFull).slice(0, 2).toLowerCase();
  const i18n = (layout.i18n && (layout.i18n[localeFull] || layout.i18n[localeShort])) || null;
  const tr = (s) => (i18n && typeof s === 'string' && i18n[s] !== undefined ? i18n[s] : s);

  const codes = await generateCodes(layout, data);
  const physical = paginate(layout, data);
  const windows = layout.windows || [];

  const doc = new PDFDocument({ size: [dim.width, dim.height], margin: 0 });
  doc._theme = layout.theme || null;
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  physical.forEach((phys, idx) => {
    if (idx > 0) doc.addPage({ size: [dim.width, dim.height], margin: 0 });
    const ctx = {
      locale: localeFull,
      currency: options.currency || (data && data.invoice && data.invoice.currency) || 'EUR',
      resolveAssetUrl: options.resolveAssetUrl,
      page: idx + 1,
      pages: physical.length,
      tr,
      codes
    };
    if (layout.page && layout.page.background) { doc.rect(0, 0, dim.width, dim.height).fillColor(S.resolveColor(layout.page.background, doc._theme)).fill(); }

    const pageWindows = windows.filter((w) => {
      if (!isVisible(w.visibleIf, data)) return false;
      if (w.repeatOnEveryPage) return true;
      if ((w.page || 1) !== phys.base) return false;
      if (phys.continuation) return phys.slices.has(w.id) && phys.slices.get(w.id) !== null;
      return true;
    });

    // Page-scope elements: BACKGROUND under everything, PAGE_BORDER / full-page WATERMARK over everything
    const pageScope = [];
    for (const win of pageWindows) {
      for (const el of win.elements || []) {
        if (!isVisible(el.visibleIf, data)) continue;
        if (el.type === 'BACKGROUND' || el.type === 'PAGE_BORDER' || (el.type === 'WATERMARK' && el.fullPage)) pageScope.push(el);
      }
    }
    for (const el of pageScope) if (el.type === 'BACKGROUND') S.drawBackground(doc, el, dim);

    for (const win of pageWindows) {
      const slice = phys.slices.get(win.id);
      if (win.type === 'TABLE' && win.grow && slice === null) continue;
      drawWindow(doc, win, data, ctx, codes, win.type === 'TABLE' && win.grow ? slice || [] : undefined);
    }

    for (const el of pageScope) {
      if (el.type === 'PAGE_BORDER') S.drawPageBorder(doc, el, dim);
      else if (el.type === 'WATERMARK') S.drawWatermark(doc, el, { x: 0, y: 0, w: dim.width, h: dim.height }, el.text || 'DRAFT');
    }
  });

  doc.end();
  return done;
}

module.exports = { renderPdf };