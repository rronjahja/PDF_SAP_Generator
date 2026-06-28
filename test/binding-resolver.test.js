'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  resolvePath,
  formatValue,
  validateData,
  isValidPath,
  collectBindings
} = require('../srv/lib/binding-resolver');

const layout = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'srv', 'samples', 'invoice-layout.json'), 'utf8'));
const sampleData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'srv', 'samples', 'invoice-data.json'), 'utf8'));

test('resolves simple nested paths', () => {
  assert.deepEqual(resolvePath(sampleData, 'customer.name'), { found: true, value: 'Musterkunde GmbH' });
  assert.deepEqual(resolvePath(sampleData, 'invoice.number'), { found: true, value: '9000001234' });
  assert.deepEqual(resolvePath(sampleData, 'totals.gross'), { found: true, value: 1130.5 });
});

test('resolves table arrays', () => {
  const { found, value } = resolvePath(sampleData, 'items');
  assert.equal(found, true);
  assert.equal(Array.isArray(value), true);
  assert.equal(value.length, 2);
  assert.equal(value[0].material, 'MAT-100');
});

test('detects missing fields', () => {
  assert.equal(resolvePath(sampleData, 'invoice.dueDate').found, false);
  assert.equal(resolvePath(sampleData, 'does.not.exist').found, false);
  assert.equal(resolvePath({}, 'customer.name').found, false);
});

test('accepts array marker syntax (items[].material)', () => {
  assert.equal(isValidPath('items[].material'), true);
  assert.equal(isValidPath('customer.name'), true);
  assert.equal(isValidPath('customer..name'), false);
  assert.equal(isValidPath(''), false);
});

test('formats dates (de-DE)', () => {
  assert.equal(formatValue('2026-06-03', 'date'), '03.06.2026');
});

test('formats currency (de-DE / EUR)', () => {
  const formatted = formatValue(1130.5, 'currency');
  assert.match(formatted, /1\.130,50/);
  assert.match(formatted, /€/);
});

test('formats number and percentage', () => {
  assert.match(formatValue(1234.5, 'number'), /1\.234,5/);
  assert.match(formatValue(0.19, 'percentage'), /19\s?%/);
});

test('validateData passes for the sample invoice', () => {
  const result = validateData(layout, sampleData);
  assert.equal(result.valid, true);
  assert.equal(result.missingFields.length, 0);
});

test('validateData reports missing fields with element and window context', () => {
  const data = JSON.parse(JSON.stringify(sampleData));
  delete data.invoice.number;
  const result = validateData(layout, data);
  assert.equal(result.valid, false);
  const missing = result.missingFields.find((f) => f.binding === 'invoice.number');
  assert.ok(missing, 'invoice.number must be reported as missing');
  assert.equal(missing.elementId, 'invoiceNumber');
  assert.equal(missing.windowId, 'C');
});

test('validateData reports table binding that is not an array', () => {
  const data = { ...sampleData, items: 'not-an-array' };
  const result = validateData(layout, data);
  assert.equal(result.valid, false);
  assert.ok(result.warnings.some((w) => w.includes('TABLE_BINDING_NOT_ARRAY')));
});

test('collectBindings finds element, table, and column bindings', () => {
  const bindings = collectBindings(layout);
  const paths = bindings.map((b) => b.binding);
  assert.ok(paths.includes('customer.name'));
  assert.ok(paths.includes('items'));
  assert.ok(paths.includes('items[].material'));
  assert.ok(paths.includes('totals.gross'));
});
