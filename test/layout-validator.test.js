'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateLayout } = require('../srv/lib/layout-validator');

const validLayout = () =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'srv', 'samples', 'invoice-layout.json'), 'utf8'));

test('accepts the sample invoice layout', () => {
  const result = validateLayout(validLayout());
  assert.equal(result.valid, true, JSON.stringify(result.errors, null, 2));
});

test('rejects missing page format', () => {
  const layout = validLayout();
  delete layout.page.format;
  const result = validateLayout(layout);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes('Page format')));
});

test('rejects missing windows array', () => {
  const result = validateLayout({ page: { format: 'A4' } });
  assert.equal(result.valid, false);
});

test('rejects window without ID', () => {
  const layout = validLayout();
  delete layout.windows[0].id;
  assert.equal(validateLayout(layout).valid, false);
});

test('rejects duplicate window IDs', () => {
  const layout = validLayout();
  layout.windows[1].id = layout.windows[0].id;
  const result = validateLayout(layout);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes('Duplicate window ID')));
});

test('rejects unsupported window type', () => {
  const layout = validLayout();
  layout.windows[0].type = 'SIDEBAR';
  assert.equal(validateLayout(layout).valid, false);
});

test('rejects window without position or size', () => {
  const layout = validLayout();
  delete layout.windows[0].width;
  assert.equal(validateLayout(layout).valid, false);
});

test('rejects table window without binding', () => {
  const layout = validLayout();
  const table = layout.windows.find((w) => w.type === 'TABLE');
  delete table.binding;
  const result = validateLayout(layout);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes('must have a binding')));
});

test('rejects table window without columns', () => {
  const layout = validLayout();
  const table = layout.windows.find((w) => w.type === 'TABLE');
  delete table.columns;
  assert.equal(validateLayout(layout).valid, false);
});

test('rejects footer overlapping outside the page', () => {
  const layout = validLayout();
  const footer = layout.windows.find((w) => w.type === 'FOOTER');
  footer.y = 800;
  footer.height = 100; // 900 > 842 pt
  const result = validateLayout(layout);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.message.includes('overlaps outside the page')));
});

test('rejects element without type', () => {
  const layout = validLayout();
  delete layout.windows[0].elements[0].type;
  assert.equal(validateLayout(layout).valid, false);
});

test('rejects invalid binding paths', () => {
  const layout = validLayout();
  layout.windows[0].elements[1].binding = 'company..name';
  assert.equal(validateLayout(layout).valid, false);
});
