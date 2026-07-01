import {
  deletePath,
  ensureBindings,
  getPath,
  renamePath,
  renameRowKey,
  sampleValue,
  setPath
} from './data-utils';
import type { Layout, LayoutElement, LayoutWindow } from './types';

/**
 * Editing state with undo/redo. Layout AND sample data travel together in
 * history, because layout edits (add element, rename binding, delete window)
 * automatically maintain the matching entries in the sample data JSON.
 */
interface Snapshot {
  layout: Layout;
  sampleData: string;
}

export interface EditorState extends Snapshot {
  past: Snapshot[];
  future: Snapshot[];
  dirty: boolean;
}

export type EditorAction =
  | { type: 'load'; layout: Layout; sampleData: string }
  | { type: 'saved' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'set-sample'; sampleData: string } // typing in the editor: no history spam
  | { type: 'sync-data' } // add every missing binding to the JSON
  | { type: 'set-page'; page: Layout['page'] }
  | { type: 'set-theme'; theme: Layout['theme'] }
  | { type: 'set-page-count'; count: number }
  | { type: 'set-i18n'; i18n: Record<string, Record<string, string>> }
  | { type: 'reorder-window'; id: string; direction: 1 | -1 } // render order = z-order
  | { type: 'add-window'; window: LayoutWindow }
  | { type: 'update-window'; id: string; patch: Partial<LayoutWindow> }
  | { type: 'remove-window'; id: string }
  | { type: 'duplicate-window'; id: string; newId: string }
  | { type: 'rename-column-binding'; windowId: string; index: number; binding: string }
  | { type: 'add-element'; windowId: string; element: LayoutElement }
  | { type: 'update-element'; windowId: string; elementId: string; patch: Partial<LayoutElement> }
  | { type: 'remove-element'; windowId: string; elementId: string }
  | { type: 'duplicate-element'; windowId: string; elementId: string; newId: string };

const HISTORY_LIMIT = 80;

/* ── sample-data helpers (tolerate hand-typed JSON that is mid-edit) ── */
function withData(sampleData: string, fn: (d: Record<string, unknown>) => void): string {
  let parsed: unknown;
  try {
    parsed = sampleData.trim() ? JSON.parse(sampleData) : {};
  } catch {
    return sampleData; // user is mid-edit; never clobber their text
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return sampleData;
  fn(parsed as Record<string, unknown>);
  return JSON.stringify(parsed, null, 2);
}

function bindingUsedElsewhere(layout: Layout, path: string, except: { windowId?: string; elementId?: string }): boolean {
  for (const w of layout.windows) {
    if (w.type === 'TABLE' && w.binding === path && w.id !== except.windowId) return true;
    for (const el of w.elements ?? []) {
      if (el.binding === path && !(w.id === except.windowId && el.id === except.elementId)) return true;
    }
  }
  return false;
}

function push(state: EditorState, snap: Partial<Snapshot>): EditorState {
  return {
    layout: snap.layout ?? state.layout,
    sampleData: snap.sampleData ?? state.sampleData,
    past: [...state.past.slice(-HISTORY_LIMIT), { layout: state.layout, sampleData: state.sampleData }],
    future: [],
    dirty: true
  };
}

function mapWindow(layout: Layout, id: string, fn: (w: LayoutWindow) => LayoutWindow): Layout {
  return { ...layout, windows: layout.windows.map((w) => (w.id === id ? fn(w) : w)) };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'load':
      return { layout: action.layout, sampleData: action.sampleData, past: [], future: [], dirty: false };
    case 'saved':
      return { ...state, dirty: false };
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        ...prev,
        past: state.past.slice(0, -1),
        future: [{ layout: state.layout, sampleData: state.sampleData }, ...state.future],
        dirty: true
      };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { ...next, past: [...state.past, { layout: state.layout, sampleData: state.sampleData }], future: rest, dirty: true };
    }
    case 'set-sample':
      return { ...state, sampleData: action.sampleData, dirty: true };
    case 'sync-data':
      return push(state, { sampleData: withData(state.sampleData, (d) => ensureBindings(d, state.layout)) });
    case 'set-page':
      return push(state, { layout: { ...state.layout, page: action.page } });
    case 'set-theme':
      return push(state, { layout: { ...state.layout, theme: action.theme && Object.keys(action.theme.colors ?? {}).length ? action.theme : undefined } });
    case 'set-i18n':
      return push(state, { layout: { ...state.layout, i18n: Object.keys(action.i18n).length ? action.i18n : undefined } });
    case 'set-page-count': {
      const count = Math.max(1, Math.min(20, Math.round(action.count)));
      // pull windows stranded beyond the last page back onto it
      const windows = state.layout.windows.map((w) =>
        (w.page || 1) > count ? { ...w, page: count } : w
      );
      return push(state, { layout: { ...state.layout, pageCount: count === 1 ? undefined : count, windows } });
    }
    case 'reorder-window': {
      const i = state.layout.windows.findIndex((w) => w.id === action.id);
      const j = i + action.direction;
      if (i < 0 || j < 0 || j >= state.layout.windows.length) return state;
      const windows = [...state.layout.windows];
      [windows[i], windows[j]] = [windows[j], windows[i]];
      return push(state, { layout: { ...state.layout, windows } });
    }

    case 'add-window': {
      const layout = { ...state.layout, windows: [...state.layout.windows, action.window] };
      let sampleData = state.sampleData;
      if (action.window.type === 'TABLE' && action.window.binding) {
        sampleData = withData(sampleData, (d) => {
          if (getPath(d, action.window.binding!) === undefined) {
            const row: Record<string, unknown> = {};
            for (const c of action.window.columns ?? []) if (c.binding) row[c.binding] = sampleValue(c.format, '…');
            setPath(d, action.window.binding!, [row]);
          }
        });
      }
      return push(state, { layout, sampleData });
    }

    case 'update-window': {
      const win = state.layout.windows.find((w) => w.id === action.id);
      let sampleData = state.sampleData;
      // table rows binding renamed -> move the array in the JSON
      if (win?.type === 'TABLE' && typeof action.patch.binding === 'string' && action.patch.binding !== win.binding) {
        sampleData = withData(sampleData, (d) => {
          if (win.binding && !bindingUsedElsewhere(state.layout, win.binding, { windowId: win.id })) {
            renamePath(d, win.binding, action.patch.binding!);
          }
          if (getPath(d, action.patch.binding!) === undefined) {
            const row: Record<string, unknown> = {};
            for (const c of win.columns ?? []) if (c.binding) row[c.binding] = sampleValue(c.format, '…');
            setPath(d, action.patch.binding!, [row]);
          }
        });
      }
      return push(state, { layout: mapWindow(state.layout, action.id, (w) => ({ ...w, ...action.patch })), sampleData });
    }

    case 'remove-window': {
      const win = state.layout.windows.find((w) => w.id === action.id);
      const layout = { ...state.layout, windows: state.layout.windows.filter((w) => w.id !== action.id) };
      let sampleData = state.sampleData;
      if (win) {
        sampleData = withData(sampleData, (d) => {
          if (win.type === 'TABLE' && win.binding && !bindingUsedElsewhere(layout, win.binding, {})) deletePath(d, win.binding);
          for (const el of win.elements ?? []) {
            if (el.binding && !bindingUsedElsewhere(layout, el.binding, {})) deletePath(d, el.binding);
          }
        });
      }
      return push(state, { layout, sampleData });
    }

    case 'duplicate-window': {
      const win = state.layout.windows.find((w) => w.id === action.id);
      if (!win) return state;
      const copy: LayoutWindow = JSON.parse(JSON.stringify(win));
      copy.id = action.newId;
      copy.name = (win.name || win.id) + ' copy';
      copy.x = Math.min(win.x + 15, 9999);
      copy.y = Math.min(win.y + 15, 9999);
      return push(state, { layout: { ...state.layout, windows: [...state.layout.windows, copy] } });
    }

    case 'rename-column-binding': {
      const win = state.layout.windows.find((w) => w.id === action.windowId);
      const col = win?.columns?.[action.index];
      if (!win || !col) return state;
      const sampleData = withData(state.sampleData, (d) => {
        if (win.binding) {
          renameRowKey(d, win.binding, col.binding, action.binding);
          const rows = getPath(d, win.binding);
          if (Array.isArray(rows) && action.binding) {
            for (const r of rows) {
              if (typeof r === 'object' && r !== null && !(action.binding in (r as object))) {
                (r as Record<string, unknown>)[action.binding] = sampleValue(col.format, '…');
              }
            }
          }
        }
      });
      const layout = mapWindow(state.layout, win.id, (w) => ({
        ...w,
        columns: (w.columns ?? []).map((c, i) => (i === action.index ? { ...c, binding: action.binding } : c))
      }));
      return push(state, { layout, sampleData });
    }

    case 'add-element': {
      const layout = mapWindow(state.layout, action.windowId, (w) => ({
        ...w,
        elements: [...(w.elements ?? []), action.element]
      }));
      const sampleData = action.element.binding
        ? withData(state.sampleData, (d) => setPath(d, action.element.binding!, sampleValue(action.element.format)))
        : state.sampleData;
      return push(state, { layout, sampleData });
    }

    case 'update-element': {
      const win = state.layout.windows.find((w) => w.id === action.windowId);
      const el = win?.elements?.find((e) => e.id === action.elementId);
      let sampleData = state.sampleData;
      // binding renamed -> move the value in the JSON
      if (el && typeof action.patch.binding === 'string' && action.patch.binding !== el.binding) {
        sampleData = withData(sampleData, (d) => {
          if (el.binding && !bindingUsedElsewhere(state.layout, el.binding, { windowId: action.windowId, elementId: el.id })) {
            renamePath(d, el.binding, action.patch.binding!);
          }
          if (action.patch.binding && getPath(d, action.patch.binding) === undefined) {
            setPath(d, action.patch.binding, sampleValue(action.patch.format ?? el.format));
          }
        });
      }
      const layout = mapWindow(state.layout, action.windowId, (w) => ({
        ...w,
        elements: (w.elements ?? []).map((e) => (e.id === action.elementId ? { ...e, ...action.patch } : e))
      }));
      return push(state, { layout, sampleData });
    }

    case 'remove-element': {
      const win = state.layout.windows.find((w) => w.id === action.windowId);
      const el = win?.elements?.find((e) => e.id === action.elementId);
      const layout = mapWindow(state.layout, action.windowId, (w) => ({
        ...w,
        elements: (w.elements ?? []).filter((e) => e.id !== action.elementId)
      }));
      const sampleData =
        el?.binding && !bindingUsedElsewhere(layout, el.binding, {})
          ? withData(state.sampleData, (d) => deletePath(d, el.binding!))
          : state.sampleData;
      return push(state, { layout, sampleData });
    }

    case 'duplicate-element': {
      const win = state.layout.windows.find((w) => w.id === action.windowId);
      const el = win?.elements?.find((e) => e.id === action.elementId);
      if (!win || !el) return state;
      const copy: LayoutElement = { ...JSON.parse(JSON.stringify(el)), id: action.newId };
      if (typeof copy.y === 'number') copy.y += 12;
      return push(state, {
        layout: mapWindow(state.layout, win.id, (w) => ({ ...w, elements: [...(w.elements ?? []), copy] }))
      });
    }

    default:
      return state;
  }
}

/* ── Client-side binding checks (fast feedback before a server round trip) ── */

export interface ClientIssue {
  level: 'error' | 'warning';
  text: string;
  windowId?: string;
}

export function clientChecks(layout: Layout, sampleDataText: string): ClientIssue[] {
  const issues: ClientIssue[] = [];
  let data: unknown = null;
  try {
    data = sampleDataText.trim() ? JSON.parse(sampleDataText) : {};
  } catch (e) {
    issues.push({ level: 'error', text: `Sample data is not valid JSON: ${(e as Error).message}` });
    return issues;
  }

  const ids = new Set<string>();
  for (const w of layout.windows) {
    if (ids.has(w.id)) issues.push({ level: 'error', text: `Duplicate window id "${w.id}"`, windowId: w.id });
    ids.add(w.id);

    if (w.type === 'TABLE') {
      if (!w.binding) {
        issues.push({ level: 'error', text: `Table window ${w.id} has no binding`, windowId: w.id });
      } else {
        const v = getPath(data, w.binding);
        if (v === undefined)
          issues.push({ level: 'warning', text: `"${w.binding}" not found in sample data`, windowId: w.id });
        else if (!Array.isArray(v))
          issues.push({ level: 'error', text: `"${w.binding}" must be an array for table ${w.id}`, windowId: w.id });
      }
      if (!w.columns?.length)
        issues.push({ level: 'error', text: `Table window ${w.id} has no columns`, windowId: w.id });
    }

    for (const el of w.elements ?? []) {
      if (el.binding && getPath(data, el.binding) === undefined) {
        issues.push({
          level: 'warning',
          text: `"${el.binding}" (${w.id}/${el.id}) not found in sample data`,
          windowId: w.id
        });
      }
    }
  }
  return issues;
}