'use strict';

/**
 * pdf-import.js — headline feature: turn an uploaded PDF into an editable template.
 *
 * Parses the PDF with pdfjs-dist (pure JS, no browser) and reconstructs a
 * layoutJson that mirrors the original: text runs (position, size, bold/italic,
 * color), filled rectangles, horizontal/vertical lines, and embedded images
 * (logos) re-encoded as PNG data URIs. Everything is absolutely positioned in
 * one FREE_SECTION window per page and flagged `autoDetected: true` so the
 * designer can highlight it for review.
 *
 * Chromium-free by design: pdfjs-dist@3 runs in plain Node.
 *
 * Exports: async importPdf(buffer) -> { layout, stats }
 */

const zlib = require('zlib');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const MAX_ELEMENTS_PER_PAGE = 400;

/* ── minimal PNG encoder (RGBA → PNG) so logos survive without native libs ── */
const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();
function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}
function pngChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0; // filter: none
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}
function toRgba(img) {
    const { width, height, data, kind } = img;
    const out = Buffer.alloc(width * height * 4);
    if (kind === 3 /* RGBA_32BPP */) Buffer.from(data.buffer, data.byteOffset, data.length).copy(out);
    else if (kind === 2 /* RGB_24BPP */) {
        for (let i = 0, j = 0; i < width * height; i++) {
            out[i * 4] = data[j++]; out[i * 4 + 1] = data[j++]; out[i * 4 + 2] = data[j++]; out[i * 4 + 3] = 255;
        }
    } else if (kind === 1 /* GRAYSCALE_1BPP */) {
        const stride = Math.ceil(width / 8);
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
            const bit = (data[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
            const v = bit ? 255 : 0;
            const i = (y * width + x) * 4;
            out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255;
        }
    } else return null;
    return out;
}

/* ── geometry / color helpers ─────────────────────────────────────────── */
const IDENTITY = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const hex = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
const rgbHex = (r, g, b) => `#${hex(r)}${hex(g)}${hex(b)}`;
const round = (v) => Math.round(v * 100) / 100;

/** Bounding box (top-left coords) of a user-space rect under ctm, on a page of height H. */
function deviceRect(ctm, x, y, w, h, H) {
    const pts = [apply(ctm, x, y), apply(ctm, x + w, y), apply(ctm, x, y + h), apply(ctm, x + w, y + h)];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return { x: round(minX), y: round(H - maxY), w: round(maxX - minX), h: round(maxY - minY) };
}

/* ── page extraction ──────────────────────────────────────────────────── */
async function extractPage(page, pageH, stats) {
    const OPS = pdfjs.OPS;
    const opList = await page.getOperatorList();

    let gs = { ctm: IDENTITY.slice(), fill: '#000000', stroke: '#000000', lw: 1 };
    const stack = [];
    let path = []; // pending subpath primitives: {kind:'rect'|'line', ...user-space}
    const rects = [];
    const lines = [];
    const images = [];
    const colorSpans = []; // per-showText: char count + fill color, for exact color alignment

    const flushFill = () => {
        for (const p of path) if (p.kind === 'rect') {
            const r = deviceRect(gs.ctm, p.x, p.y, p.w, p.h, pageH);
            if (r.w >= 1 && r.h >= 1) rects.push({ ...r, fill: gs.fill });
        }
        path = [];
    };
    const flushStroke = () => {
        const scale = Math.hypot(gs.ctm[0], gs.ctm[1]) || 1;
        for (const p of path) {
            if (p.kind === 'rect') {
                const r = deviceRect(gs.ctm, p.x, p.y, p.w, p.h, pageH);
                if (r.w >= 1 && r.h >= 1) rects.push({ ...r, stroke: gs.stroke, lw: round(gs.lw * scale) });
            } else if (p.kind === 'line') {
                const [x1, y1] = apply(gs.ctm, p.x1, p.y1);
                const [x2, y2] = apply(gs.ctm, p.x2, p.y2);
                const horiz = Math.abs(y1 - y2) < 0.6;
                const vert = Math.abs(x1 - x2) < 0.6;
                if ((horiz || vert) && Math.hypot(x2 - x1, y2 - y1) >= 2) {
                    lines.push({
                        x: round(Math.min(x1, x2)), y: round(pageH - Math.max(y1, y2)),
                        len: round(horiz ? Math.abs(x2 - x1) : Math.abs(y2 - y1)),
                        vertical: vert && !horiz, color: gs.stroke, lw: round(gs.lw * scale)
                    });
                } else stats.skippedPaths++;
            }
        }
        path = [];
    };

    for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        const a = opList.argsArray[i];
        switch (fn) {
            case OPS.save: stack.push({ ...gs, ctm: gs.ctm.slice() }); break;
            case OPS.restore: gs = stack.pop() || gs; break;
            case OPS.transform: gs.ctm = mul(gs.ctm, a); break;
            case OPS.setLineWidth: gs.lw = a[0]; break;
            case OPS.setFillRGBColor: gs.fill = rgbHex(a[0] / 255, a[1] / 255, a[2] / 255); break;
            case OPS.setStrokeRGBColor: gs.stroke = rgbHex(a[0] / 255, a[1] / 255, a[2] / 255); break;
            case OPS.setFillGray: gs.fill = rgbHex(a[0], a[0], a[0]); break;
            case OPS.setStrokeGray: gs.stroke = rgbHex(a[0], a[0], a[0]); break;
            case OPS.setFillCMYKColor: gs.fill = rgbHex((1 - a[0]) * (1 - a[3]), (1 - a[1]) * (1 - a[3]), (1 - a[2]) * (1 - a[3])); break;
            case OPS.constructPath: {
                const ops = a[0], co = a[1];
                let k = 0, cur = null;
                for (const op of ops) {
                    if (op === OPS.rectangle) { path.push({ kind: 'rect', x: co[k], y: co[k + 1], w: co[k + 2], h: co[k + 3] }); k += 4; cur = null; }
                    else if (op === OPS.moveTo) { cur = [co[k], co[k + 1]]; k += 2; }
                    else if (op === OPS.lineTo) { if (cur) path.push({ kind: 'line', x1: cur[0], y1: cur[1], x2: co[k], y2: co[k + 1] }); cur = [co[k], co[k + 1]]; k += 2; }
                    else if (op === OPS.curveTo) { k += 6; cur = [co[k - 2], co[k - 1]]; stats.skippedPaths++; }
                    else if (op === OPS.curveTo2 || op === OPS.curveTo3) { k += 4; cur = [co[k - 2], co[k - 1]]; stats.skippedPaths++; }
                    else if (op === OPS.closePath) { cur = null; }
                }
                break;
            }
            case OPS.fill:
            case OPS.eoFill: flushFill(); break;
            case OPS.fillStroke:
            case OPS.eoFillStroke: flushFill(); flushStroke(); break;
            case OPS.stroke:
            case OPS.closeStroke: flushStroke(); break;
            case OPS.endPath: path = []; break; // clip path definition — not drawn
            case OPS.showText: {
                let n = 0;
                try { for (const g of a[0] || []) if (g && typeof g === 'object' && g.unicode) n += g.unicode.replace(/ /g, '').length; } catch { /* keep 0 */ }
                colorSpans.push({ n, c: gs.fill });
                break;
            }
            case OPS.paintImageXObject:
            case OPS.paintInlineImageXObject: {
                try {
                    const img = fn === OPS.paintInlineImageXObject ? a[0] : page.objs.get(a[0]);
                    if (img && img.data && img.width && img.height && img.width * img.height <= 4_000_000) {
                        const rgba = toRgba(img);
                        if (rgba) {
                            const r = deviceRect(gs.ctm, 0, 0, 1, 1, pageH);
                            images.push({ ...r, png: encodePng(img.width, img.height, rgba) });
                        }
                    }
                } catch { stats.skippedImages++; }
                break;
            }
            default: break;
        }
    }

    /* text: merge fragments into runs on the same baseline */
    const tc = await page.getTextContent();
    const items = [];
    // exact color lookup by character offset into the page's text stream
    const offsets = [];
    let acc = 0;
    for (const sp of colorSpans) { offsets.push({ at: acc, c: sp.c }); acc += sp.n; }
    // spaces are stripped on both sides: pdfjs synthesizes them, glyph streams may not carry them
    const colorAt = (pos) => {
        let c = '#111111';
        for (const o of offsets) { if (o.at <= pos) c = o.c; else break; }
        return c;
    };
    let charPos = 0;
    tc.items.forEach((it) => {
        const myPos = charPos;
        charPos += (it.str || '').replace(/ /g, '').length;
        if (!it.str || !it.str.trim()) return;
        const fs = Math.hypot(it.transform[1], it.transform[3]) || Math.abs(it.transform[3]) || 10;
        let fontName = '';
        try { const f = page.commonObjs.get(it.fontName); fontName = (f && f.name) || ''; } catch { /* not resolved */ }
        const family = /times|georgia|serif/i.test(fontName) && !/sans/i.test(fontName) ? 'Times New Roman'
            : /courier|mono/i.test(fontName) ? 'Courier New' : undefined;
        const ascent = (tc.styles[it.fontName] && tc.styles[it.fontName].ascent) || 0.75;
        items.push({
            str: it.str,
            x: it.transform[4],
            base: it.transform[5],
            top: round(pageH - (it.transform[5] + ascent * fs)),
            w: it.width,
            fs: round(fs),
            bold: /bold|black|heavy/i.test(fontName),
            italic: /italic|oblique/i.test(fontName),
            family,
            color: colorSpans.length ? colorAt(myPos) : '#111111'
        });
    });
    items.sort((p, q) => (Math.abs(p.base - q.base) < 1 ? p.x - q.x : q.base - p.base));
    const runs = [];
    for (const it of items) {
        const last = runs[runs.length - 1];
        if (
            last && Math.abs(last.base - it.base) < 1 && Math.abs(last.fs - it.fs) < 0.6 &&
            last.bold === it.bold && last.italic === it.italic && last.color === it.color && last.family === it.family &&
            it.x - (last.x + last.w) < Math.max(1.2, last.fs * 0.4) && it.x - (last.x + last.w) > -1
        ) {
            const gap = it.x - (last.x + last.w);
            last.str += (gap > last.fs * 0.14 ? ' ' : '') + it.str;
            last.w = it.x + it.w - last.x;
        } else runs.push({ ...it });
    }
    return { runs, rects, lines, images };
}

/* ── assembly ─────────────────────────────────────────────────────────── */
function pickFormat(w, h) {
    const candidates = [
        { format: 'A4', orientation: 'portrait', w: 595, h: 842 },
        { format: 'A4', orientation: 'landscape', w: 842, h: 595 },
        { format: 'LETTER', orientation: 'portrait', w: 612, h: 792 },
        { format: 'LETTER', orientation: 'landscape', w: 792, h: 612 }
    ];
    candidates.sort((a, b) => Math.abs(a.w - w) + Math.abs(a.h - h) - (Math.abs(b.w - w) + Math.abs(b.h - h)));
    return candidates[0];
}

async function importPdf(buffer) {
    const stats = { pages: 0, textRuns: 0, rects: 0, lines: 0, images: 0, skippedPaths: 0, skippedImages: 0 };
    const doc = await pdfjs.getDocument({
        data: new Uint8Array(buffer),
        isEvalSupported: false,
        disableFontFace: true,
        useSystemFonts: false,
        verbosity: 0
    }).promise;

    stats.pages = doc.numPages;
    const first = await doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    const fmt = pickFormat(vp.width, vp.height);
    const pageW = fmt.orientation === 'landscape' ? (fmt.format === 'A4' ? 842 : 792) : (fmt.format === 'A4' ? 595 : 612);
    const pageH = fmt.orientation === 'landscape' ? (fmt.format === 'A4' ? 595 : 612) : (fmt.format === 'A4' ? 842 : 792);

    const windows = [];
    for (let p = 1; p <= doc.numPages; p++) {
        const page = p === 1 ? first : await doc.getPage(p);
        const { runs, rects, lines, images } = await extractPage(page, page.getViewport({ scale: 1 }).height, stats);

        const elements = [];
        let n = 0;
        const push = (el) => { if (elements.length < MAX_ELEMENTS_PER_PAGE) elements.push({ ...el, autoDetected: true }); };

        // rectangles first (backgrounds under text) — skip full-page white paper
        for (const r of rects) {
            if (r.fill && r.w > pageW * 0.97 && r.h > pageH * 0.97 && /^#f[8-f]f[8-f]f[8-f]$|^#ffffff$/i.test(r.fill)) continue;
            stats.rects++;
            push({
                id: `rect${++n}`, type: 'RECTANGLE', x: r.x, y: r.y, width: r.w, height: r.h,
                ...(r.fill ? { fill: r.fill } : {}),
                ...(r.stroke ? { borderColor: r.stroke, borderWidth: Math.max(0.5, r.lw || 1) } : {})
            });
        }
        for (const im of images) {
            stats.images++;
            push({
                id: `img${++n}`, type: 'IMAGE', x: im.x, y: im.y, width: round(im.w), height: round(im.h),
                url: `data:image/png;base64,${im.png.toString('base64')}`, fit: 'stretch'
            });
        }
        for (const l of lines) {
            stats.lines++;
            push({
                id: `line${++n}`, type: 'LINE', x: l.x, y: l.y,
                ...(l.vertical ? { orientation: 'vertical', height: l.len } : { width: l.len }),
                thickness: Math.max(0.5, l.lw || 1), ...(l.color && l.color !== '#000000' ? { color: l.color } : {})
            });
        }
        for (const t of runs) {
            stats.textRuns++;
            push({
                id: `text${++n}`, type: 'TEXT', x: round(t.x), y: t.top, text: t.str,
                fontSize: t.fs, ...(t.bold ? { bold: true } : {}), ...(t.italic ? { italic: true } : {}),
                ...(t.family ? { fontFamily: t.family } : {}),
                ...(t.color && t.color !== '#000000' && t.color !== '#111111' ? { color: t.color } : {})
            });
        }

        // structure detection: split into HEADER / body / FOOTER windows by vertical band
        const headerH = Math.round(pageH * 0.17);
        const footerY = Math.round(pageH * 0.9);
        const bandOf = (el) => {
            const h = el.height || (el.fontSize ? el.fontSize * 1.2 : 12);
            const cy = (el.y || 0) + h / 2;
            if ((el.y || 0) === 0 && h >= pageH * 0.9) return 'body'; // full-page background
            if (cy <= headerH) return 'header';
            if (cy >= footerY) return 'footer';
            return 'body';
        };
        const bands = { header: [], body: [], footer: [] };
        for (const el of elements) bands[bandOf(el)].push(el);
        const idBase = p === 1 ? '' : String(p);
        if (bands.header.length) {
            windows.push({
                id: `H${idBase || 1}`, name: `Header (page ${p})`, type: 'HEADER',
                x: 0, y: 0, width: pageW, height: headerH, page: p, elements: bands.header
            });
        }
        windows.push({
            id: String.fromCharCode(64 + Math.min(p, 26)) + (p > 26 ? p : ''),
            name: `Imported page ${p}`, type: 'FREE_SECTION',
            x: 0, y: 0, width: pageW, height: pageH, page: p, elements: bands.body
        });
        if (bands.footer.length) {
            windows.push({
                id: `F${idBase || 1}`, name: `Footer (page ${p})`, type: 'FOOTER',
                x: 0, y: footerY, width: pageW, height: pageH - footerY, page: p,
                elements: bands.footer.map((el) => ({ ...el, y: Math.max(0, (el.y || 0) - footerY) }))
            });
        }
    }

    const layout = {
        page: { format: fmt.format, orientation: fmt.orientation },
        ...(doc.numPages > 1 ? { pageCount: doc.numPages } : {}),
        windows
    };
    try { await doc.destroy(); } catch { /* ignore */ }
    return { layout, stats };
}

module.exports = { importPdf };