'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { renderDocument } = require('../srv/lib/html-renderer');

const layout = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'srv', 'samples', 'invoice-layout.json'), 'utf8'));
const sampleData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'srv', 'samples', 'invoice-data.json'), 'utf8'));

test('renders a complete A4 HTML document', async () => {
  const { html } = await renderDocument(layout, sampleData);
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('size: 595pt 842pt'));
  assert.ok(html.includes('width: 595pt'));
  assert.ok(html.includes('class="page"'));
});

test('text bindings appear correctly', async () => {
  const { html } = await renderDocument(layout, sampleData);
  assert.ok(html.includes('Example GmbH'));
  assert.ok(html.includes('Musterkunde GmbH'));
  assert.ok(html.includes('Mainzer Landstraße 10'));
  assert.ok(html.includes('9000001234'));
  assert.ok(html.includes('Invoice')); // static text element
  assert.ok(html.includes('03.06.2026')); // formatted date
});

test('table rows appear correctly with formatted currency', async () => {
  const { html } = await renderDocument(layout, sampleData);
  assert.ok(html.includes('Consulting Service'));
  assert.ok(html.includes('Development Service'));
  assert.ok(html.includes('MAT-100'));
  assert.match(html, /100,00/); // price formatted de-DE
  assert.match(html, /500,00/); // line total
  // column headers
  for (const label of ['Material', 'Description', 'Qty', 'Price', 'Total']) {
    assert.ok(html.includes(`<th>${label}</th>`), `missing column header ${label}`);
  }
});

test('totals appear correctly', async () => {
  const { html } = await renderDocument(layout, sampleData);
  assert.match(html, /950,00/);
  assert.match(html, /180,50/);
  assert.match(html, /1\.130,50/);
  assert.ok(html.includes('Gross'));
});

test('windows are absolutely positioned with pt coordinates', async () => {
  const { html } = await renderDocument(layout, sampleData);
  assert.ok(html.includes('data-window="A"'));
  assert.ok(html.includes('left:30pt;top:20pt;width:535pt;height:90pt'));
  assert.ok(html.includes('data-window="Z"'));
  assert.ok(html.includes('left:30pt;top:760pt'));
});

test('page number placeholder is resolved (single-page MVP)', async () => {
  const { html } = await renderDocument(layout, sampleData);
  assert.ok(html.includes('Page 1 of 1'));
});

test('missing bound values render as empty strings, not errors', async () => {
  const data = JSON.parse(JSON.stringify(sampleData));
  delete data.company.footerText;
  const { html } = await renderDocument(layout, data);
  assert.ok(html.includes('class="page"'));
  assert.ok(!html.includes('undefined'));
});

test('values are HTML-escaped', async () => {
  const data = JSON.parse(JSON.stringify(sampleData));
  data.customer.name = '<script>alert(1)</script> & Co.';
  const { html } = await renderDocument(layout, data);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp; Co.'));
});

/* ── v3: multi-page, new elements, window styling ── */
const { renderDocument: renderV3 } = require('../srv/lib/html-renderer');

test('renders multiple pages with correct page numbers', async () => {
  const layout = {
    page: { format: 'A4' },
    pageCount: 2,
    windows: [
      { id: 'A', type: 'HEADER', x: 0, y: 0, width: 500, height: 40, repeatOnEveryPage: true, elements: [] },
      { id: 'B', type: 'FREE_SECTION', x: 0, y: 60, width: 200, height: 50, page: 2, elements: [] },
      { id: 'Z', type: 'FOOTER', x: 0, y: 780, width: 500, height: 30, repeatOnEveryPage: true,
        elements: [{ id: 'pn', type: 'PAGE_NUMBER', text: 'Page {{page}} of {{pages}}' }] }
    ]
  };
  const { html } = await renderV3(layout, {});
  assert.match(html, /data-page="1"/);
  assert.match(html, /data-page="2"/);
  assert.match(html, /Page 1 of 2/);
  assert.match(html, /Page 2 of 2/);
  // window B only on page 2
  const p1 = html.slice(html.indexOf('data-page="1"'), html.indexOf('data-page="2"'));
  assert.ok(!p1.includes('data-window="B"'));
});

test('renders rectangle, checkbox, and current date elements', async () => {
  const layout = {
    page: { format: 'A4' },
    windows: [{
      id: 'A', type: 'FREE_SECTION', x: 0, y: 0, width: 400, height: 200,
      background: '#f5f5f5', borderWidth: 1, borderColor: '#999', padding: 6,
      elements: [
        { id: 'r1', type: 'RECTANGLE', x: 0, y: 0, width: 100, height: 40, fill: '#eef', borderColor: '#36c' },
        { id: 'c1', type: 'CHECKBOX', binding: 'opts.agree', label: 'Agreed' },
        { id: 'd1', type: 'CURRENT_DATE', label: 'Printed' }
      ]
    }]
  };
  const { html } = await renderV3(layout, { opts: { agree: true } });
  assert.match(html, /el-rect/);
  assert.match(html, /background:#eef/);
  assert.match(html, /&#9745;/); // checked box
  assert.match(html, /Agreed/);
  assert.match(html, /Printed/);
  assert.match(html, /background:#f5f5f5/); // window decoration
});

/* ── v4: expressions, visibility, codes, flow, i18n ── */
test('computed bindings evaluate expressions', async () => {
  const l = { page: { format: 'A4' }, windows: [{ id: 'A', type: 'FREE_SECTION', x: 0, y: 0, width: 300, height: 60,
    elements: [{ id: 't', type: 'TEXT', binding: '=net * 0.19', format: 'number' }] }] };
  const { html } = await renderV3(l, { net: 100 });
  assert.match(html, />19</);
});

test('visibleIf hides windows and elements', async () => {
  const l = { page: { format: 'A4' }, windows: [
    { id: 'P', type: 'FREE_SECTION', x: 0, y: 0, width: 100, height: 30, visibleIf: "status == 'paid'",
      elements: [{ id: 'p1', type: 'TEXT', text: 'PAID' }] },
    { id: 'Q', type: 'FREE_SECTION', x: 0, y: 50, width: 100, height: 30,
      elements: [{ id: 'q1', type: 'TEXT', text: 'Discount', visibleIf: 'discount > 0' }] }
  ] };
  const out1 = (await renderV3(l, { status: 'open', discount: 0 })).html;
  assert.ok(!out1.includes('PAID') && !out1.includes('Discount'));
  const out2 = (await renderV3(l, { status: 'paid', discount: 5 })).html;
  assert.ok(out2.includes('PAID') && out2.includes('Discount'));
});

test('QR codes render as inline SVG and barcodes as PNG', async () => {
  const l = { page: { format: 'A4' }, windows: [{ id: 'A', type: 'FREE_SECTION', x: 0, y: 0, width: 300, height: 200,
    elements: [
      { id: 'q', type: 'QR_CODE', text: 'https://example.com', width: 60, height: 60 },
      { id: 'b', type: 'BARCODE', binding: 'trackingNo', width: 120, height: 30 }
    ] }] };
  const { html } = await renderV3(l, { trackingNo: 'PKG12345678' });
  assert.match(html, /<svg/);
  assert.match(html, /data:image\/png;base64,/);
});

test('growing table flows onto continuation pages with correct page numbers', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ name: `Item ${i + 1}` }));
  const l = { page: { format: 'A4' }, windows: [
    { id: 'H', type: 'HEADER', x: 30, y: 20, width: 535, height: 30, repeatOnEveryPage: true,
      elements: [{ id: 'pn', type: 'PAGE_NUMBER' }] },
    { id: 'T', type: 'TABLE', x: 30, y: 70, width: 535, height: 400, grow: true, rowHeight: 16,
      binding: 'items', columns: [{ label: 'Name', binding: 'name', width: 535 }] }
  ] };
  const { html, pages } = await renderV3(l, { items: rows });
  assert.ok(pages >= 3, `expected >=3 pages, got ${pages}`);
  assert.match(html, new RegExp(`Page 1 of ${pages}`));
  assert.match(html, new RegExp(`Page ${pages} of ${pages}`));
  assert.match(html, /Item 60/);
  // base page must not contain the last item
  const p1 = html.slice(html.indexOf('data-page="1"'), html.indexOf('data-page="2"'));
  assert.ok(p1.includes('Item 1') && !p1.includes('Item 60'));
});

test('i18n translates labels by locale', async () => {
  const l = { page: { format: 'A4' },
    i18n: { de: { Invoice: 'Rechnung', Date: 'Datum' } },
    windows: [{ id: 'A', type: 'FREE_SECTION', x: 0, y: 0, width: 300, height: 60,
      elements: [
        { id: 't', type: 'TEXT', text: 'Invoice', fontSize: 20 },
        { id: 'd', type: 'TEXT', label: 'Date', binding: 'when', format: 'date' }
      ] }] };
  const de = (await renderV3(l, { when: '2026-06-10' }, { locale: 'de-DE' })).html;
  assert.ok(de.includes('Rechnung') && de.includes('Datum') && de.includes('10.06.2026'));
  const en = (await renderV3(l, { when: '2026-06-10' }, { locale: 'en-US' })).html;
  assert.ok(en.includes('Invoice') && en.includes('Date'));
});

test('page background color renders on every page', async () => {
  const l = { page: { format: 'A4', background: '#fdf6e3' }, pageCount: 2,
    windows: [{ id: 'A', type: 'FREE_SECTION', x: 0, y: 0, width: 100, height: 30, elements: [] }] };
  const { html } = await renderV3(l, {});
  assert.strictEqual((html.match(/background:#fdf6e3/g) || []).length, 2);
});

test('page background color renders on every page', async () => {
  const l = { page: { format: 'A4', background: '#fdf6e3' }, pageCount: 2, windows: [
    { id: 'A', type: 'FREE_SECTION', x: 0, y: 0, width: 100, height: 30, elements: [] }
  ] };
  const { html } = await renderV3(l, {});
  assert.strictEqual((html.match(/background:#fdf6e3/g) || []).length, 2);
});
