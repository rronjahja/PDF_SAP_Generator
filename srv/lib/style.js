'use strict';

/**
 * style.js — theme tokens, fills, strokes and shape drawing for the pdfkit renderer.
 *
 * Theme tokens: layout.theme = { colors: { primary: '#2563EB', accent: '#F59E0B', ... } }
 * Any color prop (color, fill, borderColor, ...) may be '@primary' to reference a token.
 * The active theme is stashed on the pdfkit document as doc._theme by renderPdf().
 *
 * Gradient fills: fill may be an object instead of a color string:
 *   { "type": "linear", "angle": 90, "stops": [ { "at": 0, "color": "@primary" }, { "at": 1, "color": "#FFFFFF" } ] }
 * angle in degrees: 0 = left→right, 90 = top→bottom.
 *
 * Stroke styles (borderStyle / lineStyle): 'solid' (default) | 'dashed' | 'dotted' | 'double'.
 */

/* ── colors & theme ──────────────────────────────────────────────────────── */

function resolveColor(value, theme) {
    if (typeof value !== 'string') return value;
    if (value.startsWith('@')) {
        const name = value.slice(1);
        const colors = (theme && theme.colors) || {};
        return colors[name] || '#111111';
    }
    return value;
}

/** Returns a pdfkit-fillable value (color string or gradient) for a fill spec. */
function resolveFill(doc, spec, box) {
    const theme = doc._theme;
    if (spec == null) return null;
    if (typeof spec === 'string') return resolveColor(spec, theme);
    if (typeof spec === 'object' && spec.type === 'linear' && Array.isArray(spec.stops) && spec.stops.length >= 2) {
        const angle = ((Number(spec.angle) || 0) * Math.PI) / 180;
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const L = Math.sqrt(box.w * box.w + box.h * box.h) / 2;
        const dx = Math.cos(angle) * L;
        const dy = Math.sin(angle) * L;
        const g = doc.linearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
        for (const s of spec.stops) {
            const at = Math.min(1, Math.max(0, Number(s.at) || 0));
            g.stop(at, resolveColor(s.color, theme) || '#000000');
        }
        return g;
    }
    return null;
}

/* ── strokes & dashes ────────────────────────────────────────────────────── */

function applyDash(doc, style, thickness) {
    const t = Math.max(1, thickness || 1);
    if (style === 'dashed') doc.dash(Math.max(4, t * 3), { space: Math.max(3, t * 2) });
    else if (style === 'dotted') { doc.lineCap('round'); doc.dash(0.1, { space: Math.max(3, t * 2) }); }
    else doc.undash();
}

/** Common per-element style extraction (flat props, consistent with RECTANGLE). */
function styleOf(el) {
    return {
        fill: el.fill,
        stroke: el.borderColor,
        strokeWidth: typeof el.borderWidth === 'number' ? el.borderWidth : 0,
        dash: el.borderStyle,
        opacity: typeof el.opacity === 'number' ? el.opacity : undefined
    };
}

/**
 * Fills and/or strokes an arbitrary path with theme-aware colors, gradients,
 * opacity and dash styles. makePath() must (re)build the path on doc.
 */
function paintShape(doc, makePath, style, box) {
    const theme = doc._theme;
    if (style.fill != null) {
        doc.save();
        if (style.opacity !== undefined) doc.fillOpacity(style.opacity);
        makePath();
        const f = resolveFill(doc, style.fill, box);
        if (f != null) doc.fill(f);
        doc.restore();
    }
    if (style.strokeWidth > 0) {
        doc.save();
        if (style.opacity !== undefined) doc.strokeOpacity(style.opacity);
        applyDash(doc, style.dash, style.strokeWidth);
        makePath();
        doc.lineWidth(style.strokeWidth).stroke(resolveColor(style.stroke, theme) || '#333333');
        doc.restore();
    }
}

/* ── lines & dividers ────────────────────────────────────────────────────── */

function drawLine(doc, x, y, len, { vertical = false, thickness = 1, color, style } = {}) {
    const c = resolveColor(color, doc._theme) || '#333333';
    const seg = (ox, oy) => {
        doc.moveTo(x + ox, y + oy);
        if (vertical) doc.lineTo(x + ox, y + oy + len); else doc.lineTo(x + ox + len, y + oy);
    };
    doc.save();
    if (style === 'double') {
        const gap = thickness + 1.5;
        doc.lineWidth(thickness).strokeColor(c);
        seg(0, 0); doc.stroke();
        if (vertical) seg(gap, 0); else seg(0, gap);
        doc.stroke();
    } else {
        applyDash(doc, style, thickness);
        doc.lineWidth(thickness).strokeColor(c);
        seg(0, 0); doc.stroke();
    }
    doc.restore();
}

function drawDivider(doc, box, el, label) {
    const cy = box.y + box.h / 2;
    const thickness = typeof el.thickness === 'number' ? el.thickness : 1;
    drawLine(doc, box.x, cy, box.w, { thickness, color: el.color || '#D1D5DB', style: el.lineStyle });
    if (label) {
        const fs = el.fontSize || 8;
        doc.save();
        doc.font('Helvetica').fontSize(fs);
        const tw = doc.widthOfString(label) + 12;
        const tx = box.x + box.w / 2 - tw / 2;
        doc.rect(tx, cy - fs, tw, fs * 2).fillColor(resolveColor(el.labelBackground, doc._theme) || '#FFFFFF').fill();
        doc.fillColor(resolveColor(el.color, doc._theme) || '#6B7280').text(label, tx + 6, cy - fs / 2, { lineBreak: false });
        doc.restore();
    }
}

/* ── shapes ──────────────────────────────────────────────────────────────── */

function drawTriangle(doc, box, el) {
    const { x, y, w, h } = box;
    const dir = el.direction || 'up';
    let pts;
    if (dir === 'down') pts = [[x, y], [x + w, y], [x + w / 2, y + h]];
    else if (dir === 'left') pts = [[x + w, y], [x + w, y + h], [x, y + h / 2]];
    else if (dir === 'right') pts = [[x, y], [x, y + h], [x + w, y + h / 2]];
    else pts = [[x + w / 2, y], [x + w, y + h], [x, y + h]];
    paintShape(doc, () => doc.polygon(...pts), styleOf(el), box);
}

function drawPolygon(doc, box, el) {
    const sides = Number.isInteger(el.sides) && el.sides >= 3 ? el.sides : 6;
    const rot = ((Number(el.rotation) || 0) - 90) * (Math.PI / 180);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const r = Math.min(box.w, box.h) / 2;
    const pts = [];
    for (let i = 0; i < sides; i++) {
        const a = rot + (i * 2 * Math.PI) / sides;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    paintShape(doc, () => doc.polygon(...pts), styleOf(el), box);
}

function drawArrow(doc, box, el) {
    const { x, y, w, h } = box;
    const dir = el.direction || 'right';
    const vertical = dir === 'up' || dir === 'down';
    const shaft = Math.min(typeof el.thickness === 'number' ? el.thickness : (vertical ? w : h) * 0.4, vertical ? w : h);
    const head = Math.min(typeof el.headSize === 'number' ? el.headSize : (vertical ? h : w) * 0.35, vertical ? h : w);
    const cx = x + w / 2, cy = y + h / 2;
    let pts;
    if (dir === 'right') pts = [[x, cy - shaft / 2], [x + w - head, cy - shaft / 2], [x + w - head, y], [x + w, cy], [x + w - head, y + h], [x + w - head, cy + shaft / 2], [x, cy + shaft / 2]];
    else if (dir === 'left') pts = [[x + w, cy - shaft / 2], [x + head, cy - shaft / 2], [x + head, y], [x, cy], [x + head, y + h], [x + head, cy + shaft / 2], [x + w, cy + shaft / 2]];
    else if (dir === 'down') pts = [[cx - shaft / 2, y], [cx - shaft / 2, y + h - head], [x, y + h - head], [cx, y + h], [x + w, y + h - head], [cx + shaft / 2, y + h - head], [cx + shaft / 2, y]];
    else pts = [[cx - shaft / 2, y + h], [cx - shaft / 2, y + head], [x, y + head], [cx, y], [x + w, y + head], [cx + shaft / 2, y + head], [cx + shaft / 2, y + h]];
    const style = styleOf(el);
    if (style.fill == null) style.fill = el.color || '#111827';
    paintShape(doc, () => doc.polygon(...pts), style, box);
}

/* ── content blocks ──────────────────────────────────────────────────────── */

function drawCallout(doc, box, el, text) {
    const r = typeof el.cornerRadius === 'number' ? el.cornerRadius : 6;
    const pad = typeof el.padding === 'number' ? el.padding : 8;
    const aw = typeof el.accentWidth === 'number' ? el.accentWidth : 3;
    const style = styleOf(el);
    if (style.fill == null) style.fill = '#F3F4F6';
    const path = () => doc.roundedRect(box.x, box.y, box.w, box.h, r);
    paintShape(doc, path, style, box);
    if (el.accentColor !== null) {
        doc.save();
        path(); doc.clip();
        doc.rect(box.x, box.y, aw, box.h).fillColor(resolveColor(el.accentColor, doc._theme) || '#2563EB').fill();
        doc.restore();
    }
    if (text) {
        const font = el.bold ? 'Helvetica-Bold' : 'Helvetica';
        doc.font(font).fontSize(el.fontSize || 10).fillColor(resolveColor(el.color, doc._theme) || '#111827');
        doc.text(String(text), box.x + pad + aw, box.y + pad, { width: box.w - 2 * pad - aw, align: el.alignment || 'left' });
    }
}

function drawWatermark(doc, el, box, text) {
    const str = String(text || 'DRAFT');
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const angle = typeof el.angle === 'number' ? el.angle : -30;
    doc.save();
    doc.opacity(typeof el.opacity === 'number' ? el.opacity : 0.08);
    doc.rotate(angle, { origin: [cx, cy] });
    const font = el.bold === false ? 'Helvetica' : 'Helvetica-Bold';
    let fs = el.fontSize;
    if (typeof fs !== 'number') {
        doc.font(font).fontSize(100);
        fs = Math.max(18, Math.min(120, (box.w * 0.9 * 100) / Math.max(1, doc.widthOfString(str))));
    }
    doc.font(font).fontSize(fs).fillColor(resolveColor(el.color, doc._theme) || '#111111');
    doc.text(str, cx - doc.widthOfString(str) / 2, cy - fs / 2, { lineBreak: false });
    doc.restore();
}

function drawSignature(doc, box, el, tr) {
    const c = resolveColor(el.color, doc._theme) || '#111827';
    const labelColor = resolveColor(el.labelColor, doc._theme) || '#6B7280';
    const fs = el.fontSize || 8;
    const lineY = box.y + box.h - fs - 6;
    const gap = 16;
    const mainW = el.showDate ? box.w * 0.6 : box.w;
    drawLine(doc, box.x, lineY, mainW, { thickness: el.thickness || 1, color: c });
    doc.font('Helvetica').fontSize(fs).fillColor(labelColor);
    doc.text(tr(el.label != null ? el.label : 'Signature'), box.x, lineY + 4, { lineBreak: false });
    if (el.showDate) {
        const dx = box.x + mainW + gap;
        const dw = box.w - mainW - gap;
        if (dw > 20) {
            drawLine(doc, dx, lineY, dw, { thickness: el.thickness || 1, color: c });
            doc.fillColor(labelColor).text(tr(el.dateLabel != null ? el.dateLabel : 'Date'), dx, lineY + 4, { lineBreak: false });
        }
    }
}

/* ── page-scope elements ─────────────────────────────────────────────────── */

function drawBackground(doc, el, dim) {
    const box = { x: 0, y: 0, w: dim.width, h: dim.height };
    doc.save();
    if (typeof el.opacity === 'number') doc.fillOpacity(el.opacity);
    doc.rect(0, 0, dim.width, dim.height);
    const f = resolveFill(doc, el.fill != null ? el.fill : '#FFFFFF', box);
    if (f != null) doc.fill(f);
    doc.restore();
}

function drawPageBorder(doc, el, dim) {
    const inset = typeof el.inset === 'number' ? el.inset : 12;
    const t = typeof el.borderWidth === 'number' ? el.borderWidth : 1;
    const r = typeof el.cornerRadius === 'number' ? el.cornerRadius : 0;
    const c = resolveColor(el.borderColor || el.color, doc._theme) || '#111827';
    const rectAt = (i) => {
        const w = dim.width - 2 * i, h = dim.height - 2 * i;
        if (r > 0) doc.roundedRect(i, i, w, h, r); else doc.rect(i, i, w, h);
    };
    doc.save();
    if (typeof el.opacity === 'number') doc.strokeOpacity(el.opacity);
    if (el.borderStyle === 'double') {
        doc.lineWidth(t).strokeColor(c);
        rectAt(inset); doc.stroke();
        rectAt(inset + t + 2); doc.stroke();
    } else {
        applyDash(doc, el.borderStyle, t);
        doc.lineWidth(t).strokeColor(c);
        rectAt(inset); doc.stroke();
    }
    doc.restore();
}

module.exports = {
    resolveColor,
    resolveFill,
    applyDash,
    styleOf,
    paintShape,
    drawLine,
    drawDivider,
    drawTriangle,
    drawPolygon,
    drawArrow,
    drawCallout,
    drawWatermark,
    drawSignature,
    drawBackground,
    drawPageBorder
};