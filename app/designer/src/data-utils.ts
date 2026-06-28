import type { Layout, LayoutElement } from './types';

/** Utilities that keep the sample data JSON in sync with layout bindings. */

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function getPath(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const part of path.replace(/\[\]/g, '').split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Sets a value at a dotted path, creating intermediate objects. No-op on conflicts. */
export function setPath(data: Obj, path: string, value: unknown): void {
  const parts = path.replace(/\[\]/g, '').split('.');
  let cur: Obj = data;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (cur[k] === undefined) cur[k] = {};
    if (!isObj(cur[k])) return; // an existing scalar blocks the path — leave user data alone
    cur = cur[k] as Obj;
  }
  if (cur[parts[parts.length - 1]] === undefined) cur[parts[parts.length - 1]] = value;
}

/** Deletes a path and prunes now-empty parent objects. */
export function deletePath(data: Obj, path: string): void {
  const parts = path.replace(/\[\]/g, '').split('.');
  const stack: { obj: Obj; key: string }[] = [];
  let cur: Obj = data;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!isObj(cur[parts[i]])) return;
    stack.push({ obj: cur, key: parts[i] });
    cur = cur[parts[i]] as Obj;
  }
  delete cur[parts[parts.length - 1]];
  for (let i = stack.length - 1; i >= 0; i--) {
    const { obj, key } = stack[i];
    if (isObj(obj[key]) && Object.keys(obj[key] as Obj).length === 0) delete obj[key];
    else break;
  }
}

/** Moves a value from one path to another (used when a binding is renamed). */
export function renamePath(data: Obj, oldPath: string, newPath: string): void {
  if (!oldPath || !newPath || oldPath === newPath) return;
  const v = getPath(data, oldPath);
  if (v === undefined) return;
  deletePath(data, oldPath);
  setPath(data, newPath, v);
}

/** Renames a key inside every row of an array at tablePath (table column rename). */
export function renameRowKey(data: Obj, tablePath: string, oldKey: string, newKey: string): void {
  if (!oldKey || !newKey || oldKey === newKey) return;
  const rows = getPath(data, tablePath);
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (isObj(row) && oldKey in row && !(newKey in row)) {
      row[newKey] = row[oldKey];
      delete row[oldKey];
    }
  }
}

/** A sensible placeholder for a binding, by display format. */
export function sampleValue(format?: string, hint?: string): unknown {
  switch (format) {
    case 'date': return new Date().toISOString().slice(0, 10);
    case 'currency': return 100;
    case 'number': return 1;
    case 'percentage': return 0.15;
    default: return hint ?? 'Sample text';
  }
}

/** All bindings used anywhere in the layout, with the format and table context. */
export function collectBindings(layout: Layout): { path: string; format?: string; table?: { rows: string; cols: { key: string; format?: string }[] } }[] {
  const out: ReturnType<typeof collectBindings> = [];
  for (const w of layout.windows) {
    if (w.type === 'TABLE' && w.binding) {
      out.push({
        path: w.binding,
        table: { rows: w.binding, cols: (w.columns ?? []).map((c) => ({ key: c.binding, format: c.format })) }
      });
    }
    for (const el of w.elements ?? []) {
      if (el.binding) out.push({ path: el.binding, format: el.format });
    }
  }
  return out;
}

/** Adds every layout binding that is missing from the data. Returns the count added. */
export function ensureBindings(data: Obj, layout: Layout): number {
  let added = 0;
  for (const b of collectBindings(layout)) {
    if (b.table) {
      if (getPath(data, b.table.rows) === undefined) {
        const row: Obj = {};
        for (const c of b.table.cols) if (c.key) row[c.key] = sampleValue(c.format, '…');
        setPath(data, b.table.rows, [row, { ...row }]);
        added++;
      } else {
        const rows = getPath(data, b.table.rows);
        if (Array.isArray(rows)) {
          for (const c of b.table.cols) {
            if (c.key && rows.length && isObj(rows[0]) && !(c.key in (rows[0] as Obj))) {
              for (const r of rows) if (isObj(r)) (r as Obj)[c.key] = sampleValue(c.format, '…');
              added++;
            }
          }
        }
      }
    } else if (getPath(data, b.path) === undefined) {
      setPath(data, b.path, sampleValue(b.format));
      added++;
    }
  }
  return added;
}

/** Auto-assigned binding names: text1, text2, image1, qr1 … unique across the layout. */
export function nextBinding(layout: Layout, el: Pick<LayoutElement, 'type'>): string {
  const prefix = { TEXT: 'text', IMAGE: 'image', QR_CODE: 'qr', BARCODE: 'barcode', LINE: 'line', PAGE_NUMBER: 'page', CHECKBOX: 'check', RECTANGLE: 'rect', CURRENT_DATE: 'date' }[el.type] ?? 'field';
  const used = new Set(collectBindings(layout).map((b) => b.path));
  let i = 1;
  while (used.has(`${prefix}${i}`)) i += 1;
  return `${prefix}${i}`;
}

export function nextTableBinding(layout: Layout): string {
  const used = new Set(collectBindings(layout).map((b) => b.path));
  let i = 1;
  while (used.has(`table${i}`)) i += 1;
  return `table${i}`;
}
