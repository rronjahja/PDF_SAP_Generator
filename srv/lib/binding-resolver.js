'use strict';

/**
 * Step 6 — Binding resolver
 *
 * Resolves data binding paths such as:
 *   company.name, customer.street, invoice.date, items, items[].material, totals.gross
 *
 * Supported format types: date, currency, number, text, percentage
 */

const TOKEN_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const DEFAULT_OPTIONS = { locale: 'de-DE', currency: 'EUR' };

/**
 * Parses a binding path into its segments.
 * The `[]` array marker (e.g. `items[].material`) is accepted and stripped —
 * array semantics are handled by the table renderer/validator.
 * @returns {string[]|null} segments, or null if the path is syntactically invalid
 */
function parsePath(path) {
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  const segments = trimmed.replace(/\[\]/g, '').split('.').map((s) => s.trim());
  if (segments.some((s) => !TOKEN_RE.test(s))) return null;
  return segments;
}

/** True if the path is a syntactically valid binding path */
function isValidPath(path) {
  // computed bindings ("=expr") are validated at evaluation time, fail-safe
  if (typeof path === 'string' && path.startsWith('=')) return path.length > 1;
  return parsePath(path) !== null;
}

/**
 * Resolves a binding path against a data object.
 * @returns {{found: boolean, value: any}}
 */
const { evaluate } = require('./expr');

function resolvePath(data, path) {
  if (typeof path === 'string' && path.startsWith('=')) {
    try {
      const value = evaluate(path.slice(1), data);
      return { found: value !== undefined, value };
    } catch {
      return { found: false, value: undefined };
    }
  }
  const segments = parsePath(path);
  if (!segments) return { found: false, value: undefined };
  let current = data;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object' || !(segment in current)) {
      return { found: false, value: undefined };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

/**
 * Formats a resolved value.
 * @param {*} value
 * @param {string} [format] date | currency | number | text | percentage
 * @param {{locale?: string, currency?: string}} [options]
 */
function formatValue(value, format, options = {}) {
  const { locale, currency } = { ...DEFAULT_OPTIONS, ...options };
  if (value === null || value === undefined) return '';

  switch (String(format || 'text').toLowerCase()) {
    case 'date': {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
    }
    case 'currency': {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return new Intl.NumberFormat(locale).format(n);
    }
    case 'percentage': {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(n);
    }
    case 'text':
    default:
      return String(value);
  }
}

/**
 * Collects every binding used in a layout, with its element and window context.
 * @returns {Array<{binding: string, elementId: string, windowId: string, kind: 'element'|'table'|'column'}>}
 */
function collectBindings(layout) {
  const bindings = [];
  for (const win of layout.windows || []) {
    if (win.type === 'TABLE' && win.binding) {
      bindings.push({ binding: win.binding, elementId: win.id, windowId: win.id, kind: 'table' });
      for (const col of win.columns || []) {
        if (col.binding) {
          bindings.push({
            binding: `${win.binding}[].${col.binding}`,
            elementId: col.binding,
            windowId: win.id,
            kind: 'column'
          });
        }
      }
    }
    for (const el of win.elements || []) {
      if (el.binding) {
        bindings.push({ binding: el.binding, elementId: el.id, windowId: win.id, kind: 'element' });
      }
    }
  }
  return bindings;
}

/**
 * Validates input data against the bindings of a layout (Steps 6/10).
 * @returns {{valid: boolean, missingFields: Array<{binding,elementId,windowId}>, warnings: string[]}}
 */
function validateData(layout, data) {
  const missingFields = [];
  const warnings = [];
  const payload = data || {};

  const { isVisible } = require('./expr');
  for (const win of layout.windows || []) {
    // windows hidden by their visibility condition don't require their data
    if (!isVisible(win.visibleIf, payload)) continue;
    // Table windows: binding must exist and resolve to an array
    if (win.type === 'TABLE') {
      if (!win.binding) continue; // structural problem, reported by layout validation
      const result = resolvePath(payload, win.binding);
      if (!result.found) {
        missingFields.push({ binding: win.binding, elementId: win.id, windowId: win.id });
      } else if (!Array.isArray(result.value)) {
        missingFields.push({ binding: win.binding, elementId: win.id, windowId: win.id });
        warnings.push(
          `Binding '${win.binding}' of table window '${win.id}' must be an array (TABLE_BINDING_NOT_ARRAY).`
        );
      } else {
        const rows = result.value;
        for (const col of win.columns || []) {
          if (!col.binding || rows.length === 0) continue;
          const missingCount = rows.filter((row) => !resolvePath(row, col.binding).found).length;
          if (missingCount === rows.length) {
            missingFields.push({
              binding: `${win.binding}[].${col.binding}`,
              elementId: col.binding,
              windowId: win.id
            });
          } else if (missingCount > 0) {
            warnings.push(
              `${missingCount} of ${rows.length} rows are missing field '${col.binding}' in table window '${win.id}'.`
            );
          }
        }
      }
    }

    // Regular elements
    for (const el of win.elements || []) {
      if (!el.binding) continue;
      const result = resolvePath(payload, el.binding);
      if (!result.found) {
        missingFields.push({ binding: el.binding, elementId: el.id, windowId: win.id });
      }
    }
  }

  return { valid: missingFields.length === 0, missingFields, warnings };
}

module.exports = {
  parsePath,
  isValidPath,
  resolvePath,
  formatValue,
  collectBindings,
  validateData,
  DEFAULT_OPTIONS
};
