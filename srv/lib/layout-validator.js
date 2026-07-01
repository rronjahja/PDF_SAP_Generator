'use strict';

/**
 * Step 7 — Layout JSON validation
 *
 * Validation rules (from the requirement document):
 *  - Page format must exist
 *  - Windows array must exist
 *  - Each window must have an ID, a type, position and size
 *  - Each element must have an ID and a type
 *  - Table windows must have a binding and columns
 *  - Footer windows must not overlap outside the page
 *  - Required bindings must be valid paths
 *  - No two windows may share the same ID
 */

const { isValidPath } = require('./binding-resolver');

const WINDOW_TYPES = ['HEADER', 'ADDRESS', 'METADATA', 'TABLE', 'TOTALS', 'FOOTER', 'FREE_SECTION'];
const ELEMENT_TYPES = ['TEXT', 'IMAGE', 'LINE', 'TABLE', 'QR_CODE', 'BARCODE', 'PAGE_NUMBER', 'RECTANGLE', 'CHECKBOX', 'CURRENT_DATE',
  // Phase 1 additions (styled shapes & blocks)
  'ELLIPSE', 'TRIANGLE', 'POLYGON', 'ARROW', 'DIVIDER', 'CALLOUT', 'WATERMARK', 'BACKGROUND', 'PAGE_BORDER', 'SIGNATURE'];

/** Page dimensions in points (layout coordinates are interpreted as pt) */
const PAGE_FORMATS = {
  A4: { portrait: { width: 595, height: 842 }, landscape: { width: 842, height: 595 } },
  LETTER: { portrait: { width: 612, height: 792 }, landscape: { width: 792, height: 612 } }
};

function pageDimensions(page = {}) {
  const format = PAGE_FORMATS[String(page.format || 'A4').toUpperCase()] || PAGE_FORMATS.A4;
  const orientation = String(page.orientation || 'portrait').toLowerCase() === 'landscape' ? 'landscape' : 'portrait';
  return format[orientation];
}

function isNonNegativeNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * Validates a layout object.
 * @returns {{valid: boolean, errors: Array<{code: string, message: string, windowId?: string, elementId?: string}>}}
 */
function validateLayout(layout) {
  const errors = [];
  const add = (code, message, windowId, elementId) => errors.push({ code, message, windowId, elementId });

  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) {
    add('INVALID_LAYOUT_JSON', 'Layout must be a JSON object.');
    return { valid: false, errors };
  }

  // Page format
  if (!layout.page || typeof layout.page !== 'object') {
    add('INVALID_LAYOUT_JSON', "Layout must contain a 'page' object.");
  } else if (!layout.page.format) {
    add('INVALID_LAYOUT_JSON', "Page format must exist (e.g. 'A4').");
  } else if (!PAGE_FORMATS[String(layout.page.format).toUpperCase()]) {
    add('INVALID_LAYOUT_JSON', `Unsupported page format '${layout.page.format}'. Supported: ${Object.keys(PAGE_FORMATS).join(', ')}.`);
  }

  // Theme (optional): { colors: { name: '#hex' | color, ... } }
  const themeColors = (layout.theme && layout.theme.colors && typeof layout.theme.colors === 'object' && !Array.isArray(layout.theme.colors))
    ? layout.theme.colors : {};
  if (layout.theme !== undefined) {
    if (!layout.theme || typeof layout.theme !== 'object' || Array.isArray(layout.theme)) {
      add('INVALID_LAYOUT_JSON', "'theme' must be an object like { colors: { primary: '#2563EB' } }.");
    } else if (layout.theme.colors !== undefined && (typeof layout.theme.colors !== 'object' || Array.isArray(layout.theme.colors))) {
      add('INVALID_LAYOUT_JSON', "'theme.colors' must be an object mapping token names to colors.");
    } else {
      for (const [name, val] of Object.entries(themeColors)) {
        if (typeof val !== 'string') add('INVALID_LAYOUT_JSON', `Theme color '${name}' must be a color string.`);
      }
    }
  }
  /** Errors if a '@token' color has no matching theme entry. */
  const checkToken = (val, where, windowId, elementId) => {
    if (typeof val === 'string' && val.startsWith('@') && themeColors[val.slice(1)] === undefined) {
      add('INVALID_LAYOUT_JSON', `${where} references theme color '${val}' but the theme does not define it.`, windowId, elementId);
    }
  };

  // Windows array
  if (!Array.isArray(layout.windows) || layout.windows.length === 0) {
    add('INVALID_LAYOUT_JSON', "Layout must contain a non-empty 'windows' array.");
    return { valid: errors.length === 0, errors };
  }

  const { height: pageHeight, width: pageWidth } = pageDimensions(layout.page);
  const pageCount = Number.isInteger(layout.pageCount) && layout.pageCount > 0 ? layout.pageCount : 1;
  if (layout.pageCount !== undefined && (!Number.isInteger(layout.pageCount) || layout.pageCount < 1 || layout.pageCount > 20)) {
    add('INVALID_LAYOUT_JSON', "'pageCount' must be an integer between 1 and 20.");
  }
  const windowIds = new Set();

  for (const [index, win] of layout.windows.entries()) {
    const ref = win && win.id ? `'${win.id}'` : `at index ${index}`;

    if (!win || typeof win !== 'object') {
      add('INVALID_LAYOUT_JSON', `Window ${ref} must be an object.`);
      continue;
    }
    if (!win.id) {
      add('INVALID_LAYOUT_JSON', `Window ${ref} must have an ID.`);
    } else if (windowIds.has(win.id)) {
      add('INVALID_LAYOUT_JSON', `Duplicate window ID '${win.id}'. Window IDs must be unique.`, win.id);
    } else {
      windowIds.add(win.id);
    }

    if (!win.type) {
      add('INVALID_LAYOUT_JSON', `Window ${ref} must have a type.`, win.id);
    } else if (!WINDOW_TYPES.includes(win.type)) {
      add('INVALID_LAYOUT_JSON', `Window ${ref} has unsupported type '${win.type}'. Supported: ${WINDOW_TYPES.join(', ')}.`, win.id);
    }
    if (win.page !== undefined && (!Number.isInteger(win.page) || win.page < 1 || win.page > pageCount)) {
      add('INVALID_LAYOUT_JSON', `Window ${ref} is assigned to page ${win.page}, but the layout has ${pageCount} page(s).`, win.id);
    }

    for (const prop of ['x', 'y', 'width', 'height']) {
      if (!isNonNegativeNumber(win[prop])) {
        add('INVALID_LAYOUT_JSON', `Window ${ref} must have a numeric '${prop}' (position and size are required).`, win.id);
      }
    }

    // Footer must stay inside the page
    if (win.type === 'FOOTER' && isNonNegativeNumber(win.y) && isNonNegativeNumber(win.height)) {
      if (win.y + win.height > pageHeight) {
        add('INVALID_LAYOUT_JSON', `Footer window ${ref} overlaps outside the page (y + height = ${win.y + win.height} > ${pageHeight}).`, win.id);
      }
    }
    if (isNonNegativeNumber(win.x) && isNonNegativeNumber(win.width) && win.x + win.width > pageWidth) {
      add('INVALID_LAYOUT_JSON', `Window ${ref} overlaps outside the page horizontally (x + width = ${win.x + win.width} > ${pageWidth}).`, win.id);
    }

    // Table windows
    if (win.type === 'TABLE') {
      if (!win.binding) {
        add('INVALID_LAYOUT_JSON', `Table window ${ref} must have a binding.`, win.id);
      } else if (!isValidPath(win.binding)) {
        add('INVALID_LAYOUT_JSON', `Table window ${ref} has an invalid binding path '${win.binding}'.`, win.id);
      }
      if (!Array.isArray(win.columns) || win.columns.length === 0) {
        add('INVALID_LAYOUT_JSON', `Table window ${ref} must have a non-empty 'columns' array.`, win.id);
      } else {
        for (const [colIndex, col] of win.columns.entries()) {
          if (!col || typeof col !== 'object' || !col.binding) {
            add('INVALID_LAYOUT_JSON', `Column ${colIndex} of table window ${ref} must have a binding.`, win.id);
          } else if (!isValidPath(col.binding)) {
            add('INVALID_LAYOUT_JSON', `Column '${col.binding}' of table window ${ref} has an invalid binding path.`, win.id);
          }
        }
      }
    }

    for (const prop of ['background', 'borderColor']) {
      if (typeof win[prop] === 'string') checkToken(win[prop], `Window ${ref} ('${prop}')`, win.id);
    }

    // Elements
    const elementIds = new Set();
    for (const [elIndex, el] of (win.elements || []).entries()) {
      const elRef = el && el.id ? `'${el.id}'` : `at index ${elIndex}`;
      if (!el || typeof el !== 'object') {
        add('INVALID_LAYOUT_JSON', `Element ${elRef} in window ${ref} must be an object.`, win.id);
        continue;
      }
      if (!el.id) {
        add('INVALID_LAYOUT_JSON', `Element ${elRef} in window ${ref} must have an ID.`, win.id);
      } else if (elementIds.has(el.id)) {
        add('INVALID_LAYOUT_JSON', `Duplicate element ID '${el.id}' in window ${ref}.`, win.id, el.id);
      } else {
        elementIds.add(el.id);
      }
      if (!el.type) {
        add('INVALID_LAYOUT_JSON', `Element ${elRef} in window ${ref} must have a type.`, win.id, el.id);
      } else if (!ELEMENT_TYPES.includes(el.type)) {
        add('INVALID_LAYOUT_JSON', `Element ${elRef} in window ${ref} has unsupported type '${el.type}'. Supported: ${ELEMENT_TYPES.join(', ')}.`, win.id, el.id);
      }
      if (el.binding && !isValidPath(el.binding)) {
        add('INVALID_LAYOUT_JSON', `Element ${elRef} in window ${ref} has an invalid binding path '${el.binding}'.`, win.id, el.id);
      }
      if (el.type === 'POLYGON' && el.sides !== undefined && (!Number.isInteger(el.sides) || el.sides < 3)) {
        add('INVALID_LAYOUT_JSON', `Polygon element ${elRef} in window ${ref} must have integer 'sides' >= 3.`, win.id, el.id);
      }
      for (const prop of ['color', 'fill', 'borderColor', 'accentColor', 'labelBackground', 'labelColor']) {
        if (typeof el[prop] === 'string') checkToken(el[prop], `Element ${elRef} in window ${ref} ('${prop}')`, win.id, el.id);
      }
      if (el.fill && typeof el.fill === 'object' && Array.isArray(el.fill.stops)) {
        for (const stop of el.fill.stops) if (stop && typeof stop.color === 'string') checkToken(stop.color, `Element ${elRef} in window ${ref} (gradient stop)`, win.id, el.id);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateLayout, pageDimensions, WINDOW_TYPES, ELEMENT_TYPES, PAGE_FORMATS };