'use strict';

/**
 * demo-invoices.js
 *
 * Builds two fully-rendered, professional invoice PDFs entirely in Node —
 * no Chromium / Playwright required. Uses:
 *   - pdfkit   : vector PDF drawing
 *   - qrcode   : QR code PNG
 *   - bwip-js  : Code-128 barcode PNG
 *
 * Each builder returns { documentNumber, fileName, buffer }.
 */

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');

// ---- A4 geometry (points) -------------------------------------------------
const PAGE_W = 595.28;
const PAGE_H = 841.89;

// ---- small helpers --------------------------------------------------------
function money(n, currency) {
  const s = Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'USD' ? `$${s}` : `${s} \u20AC`;
}

function collectBuffer(doc) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

async function qrPng(text, dark, light) {
  return QRCode.toBuffer(text, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
    color: { dark: dark || '#111111', light: light || '#FFFFFF' }
  });
}

async function barcodePng(text, color, bg) {
  return bwipjs.toBuffer({
    bcid: 'code128',
    text,
    scale: 3,
    height: 9,
    includetext: false,
    backgroundcolor: bg || 'FFFFFF',
    barcolor: color || '111111'
  });
}

// ===========================================================================
//  INVOICE A — "AURELIA Interiors"  (elegant, warm, sidebar-free top layout)
// ===========================================================================
async function buildInvoiceA() {
  const C = {
    ink: '#1A1A2E',
    terracotta: '#E07856',
    gold: '#C9A227',
    cream: '#FAF4EE',
    line: '#E7DED4',
    muted: '#8A8275'
  };
  const data = {
    number: 'AUR-2026-0142',
    date: '12 June 2026',
    due: '26 June 2026',
    from: { name: 'AURELIA Interiors', line1: 'Atelier 14, Goethestraße 22', line2: '60313 Frankfurt am Main', vat: 'VAT DE 287 654 321' },
    to: { name: 'Lindqvist & Co. AB', line1: 'Strandvägen 7B', line2: '114 56 Stockholm, Sweden', ref: 'PO-SE-5589' },
    items: [
      { d: 'Bespoke walnut credenza — hand-finished', q: 2, p: 1850.0 },
      { d: 'Brass pendant lighting (Series IX)', q: 6, p: 245.0 },
      { d: 'Wool-blend area rug, 240×340 cm', q: 3, p: 690.0 },
      { d: 'On-site styling & installation', q: 1, p: 1200.0 }
    ],
    currency: 'EUR',
    vatRate: 0.19
  };
  const sub = data.items.reduce((a, it) => a + it.q * it.p, 0);
  const vat = sub * data.vatRate;
  const total = sub + vat;

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const out = collectBuffer(doc);

  // --- top banner ---------------------------------------------------------
  doc.rect(0, 0, PAGE_W, 150).fill(C.cream);
  doc.rect(0, 150, PAGE_W, 4).fill(C.terracotta);

  // monogram mark
  doc.save();
  doc.circle(74, 70, 30).lineWidth(2).stroke(C.gold);
  doc.font('Helvetica-Bold').fontSize(26).fillColor(C.ink).text('A', 62, 55);
  doc.restore();

  doc.font('Helvetica-Bold').fontSize(22).fillColor(C.ink).text('AURELIA', 116, 50);
  doc.font('Helvetica').fontSize(9).fillColor(C.muted).text('I N T E R I O R S', 117, 78, { characterSpacing: 2 });

  // INVOICE block (right)
  doc.font('Helvetica-Bold').fontSize(30).fillColor(C.terracotta).text('INVOICE', 360, 46, { width: 195, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(C.ink);
  const metaY = 92;
  const metaRows = [['Invoice No.', data.number], ['Issued', data.date], ['Due', data.due]];
  metaRows.forEach((r, i) => {
    const y = metaY + i * 15;
    doc.font('Helvetica').fillColor(C.muted).text(r[0], 360, y, { width: 95, align: 'right' });
    doc.font('Helvetica-Bold').fillColor(C.ink).text(r[1], 360, y, { width: 195, align: 'right' });
  });

  // --- from / to ----------------------------------------------------------
  let y = 188;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted).text('FROM', 56, y, { characterSpacing: 1.5 });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.muted).text('BILL TO', 320, y, { characterSpacing: 1.5 });
  y += 14;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(data.from.name, 56, y);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(data.to.name, 320, y);
  y += 16;
  doc.font('Helvetica').fontSize(9).fillColor('#555');
  doc.text(`${data.from.line1}\n${data.from.line2}\n${data.from.vat}`, 56, y, { width: 230, lineGap: 2 });
  doc.text(`${data.to.line1}\n${data.to.line2}\nYour ref: ${data.to.ref}`, 320, y, { width: 230, lineGap: 2 });

  // --- items table --------------------------------------------------------
  y = 280;
  const X = { desc: 56, qty: 360, price: 410, amount: 480 };
  const RIGHT = 539;
  doc.rect(56, y, RIGHT - 56, 24).fill(C.ink);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF');
  doc.text('DESCRIPTION', X.desc + 10, y + 8, { characterSpacing: 0.5 });
  doc.text('QTY', X.qty, y + 8, { width: 40, align: 'right' });
  doc.text('UNIT', X.price, y + 8, { width: 60, align: 'right' });
  doc.text('AMOUNT', X.amount, y + 8, { width: RIGHT - X.amount - 10, align: 'right' });
  y += 24;

  data.items.forEach((it, i) => {
    const h = 26;
    if (i % 2 === 1) doc.rect(56, y, RIGHT - 56, h).fill(C.cream);
    doc.font('Helvetica').fontSize(9.5).fillColor(C.ink).text(it.d, X.desc + 10, y + 8, { width: 280 });
    doc.fillColor('#555');
    doc.text(String(it.q), X.qty, y + 8, { width: 40, align: 'right' });
    doc.text(money(it.p, data.currency), X.price, y + 8, { width: 60, align: 'right' });
    doc.font('Helvetica-Bold').fillColor(C.ink).text(money(it.q * it.p, data.currency), X.amount, y + 8, { width: RIGHT - X.amount - 10, align: 'right' });
    y += h;
  });
  doc.moveTo(56, y).lineTo(RIGHT, y).lineWidth(1).stroke(C.line);

  // --- totals -------------------------------------------------------------
  y += 14;
  const tx = 360;
  const trow = (label, val, bold) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 9.5).fillColor(bold ? C.ink : '#555');
    doc.text(label, tx, y, { width: 90, align: 'left' });
    doc.text(val, X.amount - 30, y, { width: RIGHT - X.amount + 20, align: 'right' });
    y += 18;
  };
  trow('Subtotal', money(sub, data.currency));
  trow(`VAT (${Math.round(data.vatRate * 100)}%)`, money(vat, data.currency));
  y += 4;
  doc.roundedRect(tx, y, RIGHT - tx, 30, 4).fill(C.terracotta);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF').text('TOTAL DUE', tx + 12, y + 9);
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF').text(money(total, data.currency), tx, y + 8, { width: RIGHT - tx - 12, align: 'right' });
  y += 30;

  // --- QR + payment note --------------------------------------------------
  const qr = await qrPng(`PAY;IBAN=DE89370400440532013000;AMT=${total.toFixed(2)};REF=${data.number}`, C.ink, C.cream);
  const payY = 580;
  doc.roundedRect(56, payY, 250, 96, 6).fill(C.cream);
  doc.image(qr, 66, payY + 12, { width: 72, height: 72 });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.ink).text('Scan to pay', 150, payY + 16);
  doc.font('Helvetica').fontSize(8).fillColor(C.muted).text('IBAN  DE89 3704 0044 0532 0130 00\nBIC  COBADEFFXXX\nPayable within 14 days.', 150, payY + 32, { width: 145, lineGap: 2 });

  // thank-you
  doc.font('Helvetica-Oblique').fontSize(11).fillColor(C.gold).text('Thank you for choosing Aurelia.', 320, payY + 30, { width: 219, align: 'right' });

  // --- footer with barcode -----------------------------------------------
  const bc = await barcodePng(data.number, '111111', 'FFFFFF');
  doc.image(bc, 56, 760, { width: 150, height: 28 });
  doc.font('Helvetica').fontSize(7.5).fillColor(C.muted)
    .text('AURELIA Interiors GmbH · Frankfurt am Main · Reg. HRB 99214 · www.aurelia-interiors.example', 56, 800, { width: 483, align: 'center' });

  doc.end();
  const buffer = await out;
  return { documentNumber: data.number, fileName: `${data.number}.pdf`, buffer };
}

// ===========================================================================
//  INVOICE B — "MERIDIAN Logistics"  (corporate, header band, metadata cards)
// ===========================================================================
async function buildInvoiceB() {
  const C = {
    navy: '#0B2545',
    steel: '#134074',
    orange: '#FB8500',
    grey: '#EEF2F6',
    line: '#D7DEE6',
    muted: '#6B7785'
  };
  const data = {
    number: 'MRD-INV-77310',
    date: '2026-06-18',
    po: 'PO-44215-DE',
    incoterms: 'DAP Hamburg',
    tracking: 'MRDU2208841',
    from: { name: 'MERIDIAN Logistics GmbH', line1: 'Speicherstadt 4, Block H', line2: '20457 Hamburg, Germany' },
    to: { name: 'Cascadia Trading LLC', line1: '1200 Harbor Blvd, Suite 410', line2: 'Seattle, WA 98101, USA' },
    items: [
      { d: 'Ocean freight — 2× 40ft HC container', q: 2, w: '24,800 kg', p: 3120.0 },
      { d: 'Customs clearance & documentation', q: 1, w: '—', p: 480.0 },
      { d: 'Inland haulage (Hamburg port to terminal)', q: 1, w: '—', p: 640.0 },
      { d: 'Cargo insurance (0.35% of value)', q: 1, w: '—', p: 415.5 }
    ],
    currency: 'USD',
    vatRate: 0.0
  };
  const sub = data.items.reduce((a, it) => a + it.q * it.p, 0);
  const vat = sub * data.vatRate;
  const total = sub + vat;

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const out = collectBuffer(doc);

  // --- header band --------------------------------------------------------
  doc.rect(0, 0, PAGE_W, 96).fill(C.navy);
  doc.rect(0, 96, PAGE_W, 6).fill(C.orange);
  // mark
  doc.rect(40, 30, 36, 36).fill(C.orange);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(C.navy).text('M', 49, 38);
  doc.font('Helvetica-Bold').fontSize(19).fillColor('#FFFFFF').text('MERIDIAN', 88, 32);
  doc.font('Helvetica').fontSize(8.5).fillColor('#9FB3C8').text('L O G I S T I C S', 89, 56, { characterSpacing: 2 });
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF').text('COMMERCIAL INVOICE', 300, 38, { width: 255, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor('#9FB3C8').text('International freight forwarding', 300, 58, { width: 255, align: 'right' });

  // --- metadata cards -----------------------------------------------------
  const cards = [
    ['INVOICE NO.', data.number],
    ['DATE', data.date],
    ['PO NUMBER', data.po],
    ['INCOTERMS', data.incoterms]
  ];
  let cx = 40;
  const cardW = (PAGE_W - 80 - 3 * 12) / 4;
  const cardY = 122;
  cards.forEach((c) => {
    doc.roundedRect(cx, cardY, cardW, 52, 4).fill(C.grey);
    doc.rect(cx, cardY, cardW, 3).fill(C.orange);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.muted).text(c[0], cx + 10, cardY + 12, { characterSpacing: 0.8 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.navy).text(c[1], cx + 10, cardY + 27, { width: cardW - 20 });
    cx += cardW + 12;
  });

  // --- ship from / to -----------------------------------------------------
  let y = 198;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange).text('SHIP FROM', 40, y, { characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange).text('SHIP TO', 310, y, { characterSpacing: 1 });
  y += 13;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.navy).text(data.from.name, 40, y);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.navy).text(data.to.name, 310, y);
  y += 15;
  doc.font('Helvetica').fontSize(9).fillColor('#555');
  doc.text(`${data.from.line1}\n${data.from.line2}`, 40, y, { width: 240, lineGap: 2 });
  doc.text(`${data.to.line1}\n${data.to.line2}`, 310, y, { width: 245, lineGap: 2 });

  // --- items table --------------------------------------------------------
  y = 268;
  const RIGHT = 555;
  const X = { desc: 40, w: 320, qty: 400, price: 440, amount: 500 };
  doc.rect(40, y, RIGHT - 40, 24).fill(C.steel);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
  doc.text('SERVICE / DESCRIPTION', X.desc + 8, y + 8);
  doc.text('WEIGHT', X.w, y + 8, { width: 55, align: 'right' });
  doc.text('QTY', X.qty, y + 8, { width: 30, align: 'right' });
  doc.text('RATE', X.price, y + 8, { width: 55, align: 'right' });
  doc.text('AMOUNT', X.amount, y + 8, { width: RIGHT - X.amount - 8, align: 'right' });
  y += 24;

  data.items.forEach((it, i) => {
    const h = 26;
    if (i % 2 === 1) doc.rect(40, y, RIGHT - 40, h).fill(C.grey);
    doc.font('Helvetica').fontSize(9).fillColor(C.navy).text(it.d, X.desc + 8, y + 8, { width: 270 });
    doc.fillColor('#555').fontSize(8.5);
    doc.text(it.w, X.w, y + 8, { width: 55, align: 'right' });
    doc.text(String(it.q), X.qty, y + 8, { width: 30, align: 'right' });
    doc.text(money(it.p, data.currency), X.price, y + 8, { width: 55, align: 'right' });
    doc.font('Helvetica-Bold').fillColor(C.navy).fontSize(9).text(money(it.q * it.p, data.currency), X.amount, y + 8, { width: RIGHT - X.amount - 8, align: 'right' });
    y += h;
  });
  doc.moveTo(40, y).lineTo(RIGHT, y).lineWidth(1).stroke(C.line);

  // --- totals -------------------------------------------------------------
  y += 14;
  const tx = 360;
  doc.font('Helvetica').fontSize(9.5).fillColor('#555').text('Subtotal', tx, y);
  doc.text(money(sub, data.currency), X.amount - 40, y, { width: RIGHT - X.amount + 40, align: 'right' });
  y += 17;
  doc.text('Duties & taxes (export, 0%)', tx, y);
  doc.text(money(vat, data.currency), X.amount - 40, y, { width: RIGHT - X.amount + 40, align: 'right' });
  y += 20;
  doc.rect(tx, y, RIGHT - tx, 32).fill(C.navy);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#FFFFFF').text('TOTAL (USD)', tx + 12, y + 10);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.orange).text(money(total, data.currency), tx, y + 9, { width: RIGHT - tx - 12, align: 'right' });

  // --- tracking panel: QR + barcode --------------------------------------
  const panelY = 600;
  doc.roundedRect(40, panelY, RIGHT - 40, 110, 6).fill(C.grey);
  doc.rect(40, panelY, 5, 110).fill(C.orange);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(C.navy).text('SHIPMENT TRACKING', 60, panelY + 14, { characterSpacing: 0.5 });
  const qr = await qrPng(`https://track.meridian.example/${data.tracking}`, C.navy, C.grey);
  doc.image(qr, 60, panelY + 30, { width: 66, height: 66 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#555').text('Scan for live status and ETA at the destination terminal.', 140, panelY + 34, { width: 180, lineGap: 2 });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.navy).text(`Tracking: ${data.tracking}`, 140, panelY + 66);
  const bc = await barcodePng(data.tracking, '0B2545', 'EEF2F6');
  doc.image(bc, 360, panelY + 36, { width: 170, height: 34 });
  doc.font('Helvetica').fontSize(7.5).fillColor(C.muted).text(data.tracking, 360, panelY + 74, { width: 170, align: 'center' });

  // --- footer band --------------------------------------------------------
  doc.rect(0, PAGE_H - 34, PAGE_W, 34).fill(C.navy);
  doc.font('Helvetica').fontSize(7.5).fillColor('#9FB3C8')
    .text('MERIDIAN Logistics GmbH · Speicherstadt 4, Hamburg · VAT DE 198 220 110 · support@meridian.example · +49 40 555 0192', 40, PAGE_H - 22, { width: RIGHT - 40, align: 'center' });

  doc.end();
  const buffer = await out;
  return { documentNumber: data.number, fileName: `${data.number}.pdf`, buffer };
}

module.exports = { buildInvoiceA, buildInvoiceB };