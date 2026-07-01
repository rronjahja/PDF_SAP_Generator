import {
  DndContext,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent
} from '@dnd-kit/core';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Notify } from '../App';
import type { Block } from '../types';
import * as api from '../api';
import { nextBinding, nextTableBinding } from '../data-utils';
import { clientChecks, editorReducer, type ClientIssue } from '../state';
import type {
  ElementType,
  Layout,
  LayoutElement,
  LayoutWindow,
  Selection,
  Template,
  TemplateVersion,
  WindowType
} from '../types';
import { emptyLayout, layoutPages, nextElementId, nextWindowId, pageDims, WINDOW_DEFAULTS } from '../types';
import { AssetsModal } from './AssetsModal';
import { Canvas, type Guides } from './Canvas';
import { DiffModal, HistoryModal } from './HistoryDiff';
import { PreviewPane } from './PreviewPane';
import { LayersPanel } from './LayersPanel';
import { Modals } from './Modals';
import { DataPanel } from './DataPanel';
import { PaintBar } from './PaintBar';
import { ThemePanel } from './ThemePanel';
import { Palette } from './Palette';
import { PropertiesPanel } from './PropertiesPanel';

function parseLayout(json: string | null): Layout {
  if (!json) return emptyLayout();
  try {
    const l = JSON.parse(json);
    if (!l.page) l.page = emptyLayout().page; // tolerate older drafts
    if (!Array.isArray(l.windows)) l.windows = [];
    return l as Layout;
  } catch {
    return emptyLayout();
  }
}

/** Prefer window drop zones over the sheet so elements land in the window under the pointer. */
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const wins = within.filter((c) => String(c.id).startsWith('windrop:'));
  if (wins.length) return wins;
  if (within.length) return within;
  return rectIntersection(args);
};

export function Designer({
  templateId,
  onBack,
  notify
}: {
  templateId: string;
  onBack: () => void;
  notify: Notify;
}) {
  const [template, setTemplate] = useState<Template | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [state, dispatch] = useReducer(editorReducer, {
    layout: emptyLayout(),
    sampleData: '{}',
    past: [],
    future: [],
    dirty: false
  });
  const [selection, setSelection] = useState<Selection>(null);
  const [zoom, setZoom] = useState(1.05);
  const [grid, setGrid] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [modal, setModal] = useState<null | 'shortcuts' | 'api'>(null);
  const [dialog, setDialog] = useState<null | 'assets' | 'history' | 'diff'>(null);
  const [assetTarget, setAssetTarget] = useState<{ windowId: string; elementId: string } | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [datasets, setDatasets] = useState<Record<string, string>>({});
  const [activeDataset, setActiveDataset] = useState('default');
  const [locale, setLocale] = useState('de-DE');
  const [guides, setGuides] = useState<Guides>(null);
  const [paint, setPaint] = useState<{ on: boolean; color: string | null }>({ on: false, color: '#0a6ed1' });
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const refreshBlocks = useCallback(() => {
    api.listBlocks().then(setBlocks).catch(() => setBlocks([]));
  }, []);
  useEffect(() => { refreshBlocks(); }, [refreshBlocks]);
  const [tab, setTab] = useState<'props' | 'data' | 'preview'>('props');
  const [issues, setIssues] = useState<ClientIssue[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const sheetEl = useRef<HTMLDivElement | null>(null);

  const versions = template?.versions ?? [];
  const version = versions.find((v) => v.ID === versionId) ?? null;
  const readOnly = !version || version.status !== 'DRAFT';
  const snap = useCallback((v: number) => (grid ? Math.round(v / 5) * 5 : Math.round(v)), [grid]);
  const pages = layoutPages(state.layout);
  useEffect(() => { if (currentPage > pages) setCurrentPage(pages); }, [pages, currentPage]);
  const zoomTo = useCallback((z: number) => setZoom(Math.min(2, Math.max(0.4, Math.round(z * 20) / 20))), []);
  const fitWidth = useCallback(() => {
    const desk = document.querySelector('.desk');
    if (desk) zoomTo((desk.clientWidth - 90) / pageDims(state.layout).width);
  }, [state.layout, zoomTo]);

  /* ── Loading ── */
  const load = useCallback(
    async (preferVersion?: string) => {
      const t = await api.getTemplate(templateId);
      setTemplate(t);
      const vs = t.versions ?? [];
      const pick =
        vs.find((v) => v.ID === preferVersion) ??
        vs.find((v) => v.status === 'DRAFT') ??
        vs.find((v) => v.ID === t.activeVersion_ID) ??
        vs[0] ??
        null;
      setVersionId(pick?.ID ?? null);
      dispatch({ type: 'load', layout: parseLayout(pick?.layoutJson ?? null), sampleData: pick?.sampleDataJson || '{}' });
      try {
        setDatasets(pick?.sampleDatasets ? JSON.parse(pick.sampleDatasets) : {});
      } catch {
        setDatasets({});
      }
      setActiveDataset('default');
      setSelection(null);
      setIssues(null);
    },
    [templateId]
  );

  useEffect(() => {
    load().catch((e) => notify('error', 'Could not load template', e.message));
  }, [load, notify]);

  const switchVersion = (v: TemplateVersion) => {
    if (state.dirty && !window.confirm('Discard unsaved changes?')) return;
    setVersionId(v.ID);
    dispatch({ type: 'load', layout: parseLayout(v.layoutJson), sampleData: v.sampleDataJson || '{}' });
    setSelection(null);
    setIssues(null);
  };

  /* ── Persistence and lifecycle ── */
  const save = useCallback(async (): Promise<boolean> => {
    if (!version) return false;
    try {
      setBusy('save');
      const ds = { ...datasets, [activeDataset]: state.sampleData };
      await api.saveVersion(version.ID, JSON.stringify(state.layout, null, 2), state.sampleData, JSON.stringify(ds));
      setDatasets(ds);
      dispatch({ type: 'saved' });
      notify('success', `Draft v${version.version} saved`);
      return true;
    } catch (e) {
      notify('error', 'Save failed', (e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }, [version, state.layout, state.sampleData, datasets, activeDataset, notify]);

  const publish = async () => {
    if (!version) return;
    if (state.dirty && !(await save())) return;
    try {
      setBusy('publish');
      await api.publishVersion(version.ID);
      notify('success', `Version ${version.version} published`);
      await load(version.ID);
    } catch (e) {
      const err = e as Error & { details?: { message?: string }[] };
      notify('error', 'Publish failed', err.details?.[0]?.message ?? err.message);
    } finally {
      setBusy(null);
    }
  };

  const newDraft = async () => {
    try {
      setBusy('draft');
      const d = await api.createDraft(templateId);
      notify('success', `Draft v${d.version} created`);
      await load(d.ID);
    } catch (e) {
      notify('error', 'Could not create draft', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const submitReview = async () => {
    if (!version) return;
    if (state.dirty && !(await save())) return;
    try {
      setBusy('review');
      await api.submitForReview(version.ID);
      notify('success', `Version ${version.version} submitted for review`);
      await load(version.ID);
    } catch (e) {
      notify('error', 'Submit failed', (e as Error).message);
    } finally { setBusy(null); }
  };

  const decideReview = async (approve: boolean) => {
    if (!version) return;
    const comment = window.prompt(approve ? 'Approval comment (optional):' : 'Rejection reason:') ?? undefined;
    if (!approve && !comment) return;
    try {
      setBusy('review');
      if (approve) await api.approveVersion(version.ID, comment);
      else await api.rejectVersion(version.ID, comment);
      notify('success', approve ? 'Approved and published' : 'Rejected — back to draft');
      await load(version.ID);
    } catch (e) {
      notify('error', 'Action failed', (e as Error).message);
    } finally { setBusy(null); }
  };

  const parseSample = (): unknown => {
    try {
      return JSON.parse(state.sampleData);
    } catch {
      return undefined;
    }
  };

  const runChecks = async () => {
    const local = clientChecks(state.layout, state.sampleData);
    setIssues(local);
    setTab('data');
    if (local.some((i) => i.level === 'error')) return;
    if (version && !readOnly && state.dirty && !(await save())) return;
    if (!version) return;
    try {
      setBusy('checks');
      await api.previewPdf(version.ID, parseSample(), locale);
      setIssues([]);
      notify('success', 'Layout and data check out — preview opened');
    } catch (e) {
      const err = e as Error & { code?: string; details?: { binding?: string; windowId?: string; message?: string }[] };
      if (err.code === 'PDF_RENDERING_FAILED') {
        setIssues([]);
        notify('info', 'Layout and data are valid', 'PDF rendering is unavailable on the server (Chromium missing) — HTML preview still works.');
        window.open(api.previewHtmlUrl(version.ID), '_blank');
      } else if (err.details?.length) {
        setIssues(
          err.details.map((d) => ({
            level: 'error',
            text: d.message ?? `Missing "${d.binding}"${d.windowId ? ` (window ${d.windowId})` : ''}`,
            windowId: d.windowId
          }))
        );
        notify('error', 'Checks found problems', err.message);
      } else {
        notify('error', 'Check failed', err.message);
      }
    } finally {
      setBusy(null);
    }
  };

  const preview = async () => {
    if (!version) return;
    if (!readOnly && state.dirty && !(await save())) return;
    try {
      setBusy('preview');
      await api.previewPdf(version.ID, parseSample(), locale);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'PDF_RENDERING_FAILED') {
        notify('info', 'PDF rendering unavailable on the server', 'Opening the HTML preview instead.');
        window.open(api.previewHtmlUrl(version.ID), '_blank');
      } else {
        notify('error', 'Preview failed', err.message);
      }
    } finally {
      setBusy(null);
    }
  };

  /* ── Keyboard: undo/redo/save/delete/duplicate/nudge ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const editingField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
      if (e.key === 'Escape') {
        setPaint((p) => (p.on ? { ...p, on: false } : p));
      } else if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'undo' });
      } else if (mod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        dispatch({ type: 'redo' });
      } else if (mod && e.key === 's') {
        e.preventDefault();
        if (!readOnly) void save();
      } else if (mod && e.key === 'd' && selection && !readOnly && !editingField) {
        e.preventDefault();
        if (selection.kind === 'window') {
          const newId = nextWindowId(state.layout);
          dispatch({ type: 'duplicate-window', id: selection.windowId, newId });
          setSelection({ kind: 'window', windowId: newId });
        } else {
          const win = state.layout.windows.find((w) => w.id === selection.windowId);
          const el = win?.elements?.find((x) => x.id === selection.elementId);
          if (win && el) {
            const newId = nextElementId(win, el.type);
            dispatch({ type: 'duplicate-element', windowId: win.id, elementId: el.id, newId });
            setSelection({ kind: 'element', windowId: win.id, elementId: newId });
          }
        }
      } else if (/^Arrow/.test(e.key) && selection && !readOnly && !editingField) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (selection.kind === 'window') {
          const w = state.layout.windows.find((x) => x.id === selection.windowId);
          if (w) dispatch({ type: 'update-window', id: w.id, patch: { x: Math.max(0, w.x + dx), y: Math.max(0, w.y + dy) } });
        } else {
          const w = state.layout.windows.find((x) => x.id === selection.windowId);
          const el = w?.elements?.find((x) => x.id === selection.elementId);
          if (el && typeof el.x === 'number' && typeof el.y === 'number')
            dispatch({
              type: 'update-element',
              windowId: selection.windowId,
              elementId: selection.elementId,
              patch: { x: Math.max(0, el.x + dx), y: Math.max(0, el.y + dy) }
            });
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection && !readOnly && !editingField) {
        e.preventDefault();
        if (selection.kind === 'element')
          dispatch({ type: 'remove-element', windowId: selection.windowId, elementId: selection.elementId });
        else dispatch({ type: 'remove-window', id: selection.windowId });
        setSelection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [readOnly, save, selection, state.layout]);

  /* ── Drag and drop ── */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const dims = pageDims(state.layout);

  /** Alignment-guide snapping: find lines within tolerance of the dragged window. */
  const SNAP = 4;
  const computeSnap = (winId: string, x: number, y: number, w: number, h: number) => {
    const others = state.layout.windows.filter(
      (o) => o.id !== winId && (o.repeatOnEveryPage || (o.page || 1) === currentPage)
    );
    const vCand = [0, dims.width / 2, dims.width];
    const hCand = [0, dims.height / 2, dims.height];
    for (const o of others) {
      vCand.push(o.x, o.x + o.width / 2, o.x + o.width);
      hCand.push(o.y, o.y + o.height / 2, o.y + o.height);
    }
    let best: { v?: number; h?: number; dx: number; dy: number } = { dx: 0, dy: 0 };
    let bestV = SNAP + 1;
    for (const c of vCand) for (const edge of [x, x + w / 2, x + w]) {
      const d = c - edge;
      if (Math.abs(d) < bestV) { bestV = Math.abs(d); best.v = c; best.dx = d; }
    }
    let bestH = SNAP + 1;
    for (const c of hCand) for (const edge of [y, y + h / 2, y + h]) {
      const d = c - edge;
      if (Math.abs(d) < bestH) { bestH = Math.abs(d); best.h = c; best.dy = d; }
    }
    if (best.v === undefined) best.dx = 0;
    if (best.h === undefined) best.dy = 0;
    return best;
  };

  const onDragMove = (e: DragMoveEvent) => {
    const id = String(e.active.id);
    if (!id.startsWith('win:') || readOnly) return;
    const win = state.layout.windows.find((w) => w.id === id.slice(4));
    if (!win || win.locked) return;
    const snapRes = computeSnap(win.id, win.x + e.delta.x / zoom, win.y + e.delta.y / zoom, win.width, win.height);
    setGuides(snapRes.v !== undefined || snapRes.h !== undefined ? { v: snapRes.v, h: snapRes.h } : null);
  };

  /** Window under a point on the sheet (pt coords), excluding TABLE windows for element drops. */
  const windowAt = (xPt: number, yPt: number): LayoutWindow | undefined =>
    [...state.layout.windows]
      .reverse()
      .filter((w) => w.repeatOnEveryPage || (w.page || 1) === currentPage)
      .find((w) => xPt >= w.x && xPt <= w.x + w.width && yPt >= w.y && yPt <= w.y + w.height);

  const [themeOpen, setThemeOpen] = useState(false);
  const addElementTo = (win: LayoutWindow, type: ElementType, atX?: number, atY?: number) => {
    const noBinding = ['LINE', 'PAGE_NUMBER', 'RECTANGLE', 'CURRENT_DATE', 'ELLIPSE', 'TRIANGLE', 'POLYGON', 'ARROW', 'DIVIDER', 'CALLOUT', 'WATERMARK', 'SIGNATURE', 'BACKGROUND', 'PAGE_BORDER'].includes(type);
    const binding = noBinding ? undefined : nextBinding(state.layout, { type });
    const el: LayoutElement = {
      id: nextElementId(win, type),
      type,
      ...(typeof atX === 'number' && typeof atY === 'number'
        ? {
          x: Math.max(0, Math.min(snap(atX), win.width - 20)),
          y: Math.max(0, Math.min(snap(atY), win.height - 12))
        }
        : {}),
      ...(binding ? { binding } : {}),
      ...(type === 'TEXT' ? { fontSize: 10 } : {}),
      ...(type === 'LINE' ? { width: Math.min(120, win.width), height: 1 } : {}),
      ...(type === 'RECTANGLE' ? { width: 80, height: 40, borderWidth: 1, borderColor: '#333333' } : {}),
      ...(type === 'CHECKBOX' ? { label: 'Label' } : {}),
      ...(type === 'CURRENT_DATE' ? { label: 'Date', format: 'date' } : {}),
      ...(type === 'PAGE_NUMBER' ? { text: 'Page {{page}} of {{pages}}' } : {}),
      ...(type === 'ELLIPSE' ? { width: 80, height: 50, fill: '#0a6ed1' } : {}),
      ...(type === 'TRIANGLE' ? { width: 60, height: 52, fill: '#0a6ed1' } : {}),
      ...(type === 'POLYGON' ? { width: 60, height: 60, sides: 6, fill: '#0a6ed1' } : {}),
      ...(type === 'ARROW' ? { width: 90, height: 26, color: '#0a6ed1' } : {}),
      ...(type === 'DIVIDER' ? { width: Math.min(200, win.width), height: 12 } : {}),
      ...(type === 'CALLOUT' ? { width: 200, height: 50, text: 'Note…' } : {}),
      ...(type === 'WATERMARK' ? { width: 180, height: 60, text: 'DRAFT' } : {}),
      ...(type === 'SIGNATURE' ? { width: 170, height: 40 } : {}),
      ...(type === 'BACKGROUND' ? { width: 90, height: 20, fill: '#f8fafc' } : {}),
      ...(type === 'PAGE_BORDER' ? { width: 90, height: 20, inset: 14, borderWidth: 1, borderColor: '#333333' } : {})
    };
    dispatch({ type: 'add-element', windowId: win.id, element: el });
    setSelection({ kind: 'element', windowId: win.id, elementId: el.id });
    if (binding) notify('info', `Bound to "${binding}"`, 'A matching entry was added to the sample data. Rename the binding in Properties and the data follows.');
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (readOnly) return;
    const id = String(e.active.id);
    const rect = e.active.rect.current.translated;
    const sheet = sheetEl.current?.getBoundingClientRect();

    if (id.startsWith('new-window:')) {
      if (!sheet || !rect || !e.over) return;
      const type = id.slice('new-window:'.length) as WindowType;
      const def = WINDOW_DEFAULTS[type];
      const x = snap((rect.left - sheet.left) / zoom);
      const y = snap((rect.top - sheet.top) / zoom);
      const tableBinding = type === 'TABLE' ? nextTableBinding(state.layout) : undefined;
      const win: LayoutWindow = {
        id: nextWindowId(state.layout),
        name: type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' '),
        type,
        x: Math.max(0, Math.min(x, dims.width - def.width)),
        y: Math.max(0, Math.min(y, dims.height - def.height)),
        ...def,
        ...(type === 'TABLE'
          ? {
            binding: tableBinding,
            repeatHeader: true,
            columns: [
              { label: 'Column 1', binding: 'col1', width: Math.round(def.width / 2) },
              { label: 'Column 2', binding: 'col2', width: Math.round(def.width / 2) }
            ]
          }
          : { elements: [] }),
        ...(type === 'HEADER' || type === 'FOOTER' ? { repeatOnEveryPage: true } : {}),
        ...(currentPage > 1 ? { page: currentPage } : {})
      };
      dispatch({ type: 'add-window', window: win });
      setSelection({ kind: 'window', windowId: win.id });
      if (tableBinding) notify('info', `Table bound to "${tableBinding}"`, 'Sample rows were added to the data.');
      return;
    }

    if (id.startsWith('new-el:')) {
      const type = id.slice('new-el:'.length) as ElementType;
      const overId = e.over ? String(e.over.id) : '';
      let win: LayoutWindow | undefined;
      let localX: number | undefined;
      let localY: number | undefined;

      if (overId.startsWith('windrop:')) {
        win = state.layout.windows.find((w) => w.id === overId.slice('windrop:'.length));
      }
      if (!win && sheet && rect) {
        // fallback: locate the window from drop coordinates
        win = windowAt((rect.left - sheet.left) / zoom, (rect.top - sheet.top) / zoom);
      }
      if (!win) {
        notify('info', 'Drop elements inside a window', 'Add a window first (drag one in from the palette), then drop elements into it.');
        return;
      }
      if (win.type === 'TABLE') {
        notify('info', 'Tables take columns, not elements', 'Select the table and edit its columns in the properties panel.');
        return;
      }
      if (sheet && rect) {
        localX = (rect.left - sheet.left) / zoom - win.x;
        localY = (rect.top - sheet.top) / zoom - win.y;
      }
      addElementTo(win, type, localX, localY);
      return;
    }

    if (id.startsWith('new-block:')) {
      if (!sheet || !rect || !e.over) return;
      const block = blocks.find((b) => b.ID === id.slice('new-block:'.length));
      if (!block) return;
      try {
        const tplWin = JSON.parse(block.windowJson) as LayoutWindow;
        const x = snap((rect.left - sheet.left) / zoom);
        const y = snap((rect.top - sheet.top) / zoom);
        const win: LayoutWindow = {
          ...tplWin,
          id: nextWindowId(state.layout),
          x: Math.max(0, Math.min(x, dims.width - tplWin.width)),
          y: Math.max(0, Math.min(y, dims.height - tplWin.height)),
          repeatOnEveryPage: tplWin.repeatOnEveryPage,
          ...(currentPage > 1 && !tplWin.repeatOnEveryPage ? { page: currentPage } : { page: undefined })
        };
        dispatch({ type: 'add-window', window: win });
        dispatch({ type: 'sync-data' });
        setSelection({ kind: 'window', windowId: win.id });
        notify('success', `Block "${block.name}" inserted`);
      } catch {
        notify('error', 'Block is corrupted', 'The stored window JSON could not be parsed.');
      }
      return;
    }

    if (id.startsWith('win:')) {
      const windowId = id.slice('win:'.length);
      const win = state.layout.windows.find((w) => w.id === windowId);
      setGuides(null);
      if (!win || (e.delta.x === 0 && e.delta.y === 0)) return;
      const rawX = win.x + e.delta.x / zoom;
      const rawY = win.y + e.delta.y / zoom;
      const snapRes = computeSnap(windowId, rawX, rawY, win.width, win.height);
      const x = Math.max(0, Math.min(
        snapRes.v !== undefined ? Math.round(rawX + snapRes.dx) : snap(rawX),
        dims.width - win.width));
      const y = Math.max(0, Math.min(
        snapRes.h !== undefined ? Math.round(rawY + snapRes.dy) : snap(rawY),
        dims.height - win.height));
      dispatch({ type: 'update-window', id: windowId, patch: { x, y } });
      return;
    }

    if (id.startsWith('el:')) {
      const [, windowId, elementId] = id.split(':');
      const win = state.layout.windows.find((w) => w.id === windowId);
      const el = win?.elements?.find((x) => x.id === elementId);
      if (!win || !el || typeof el.x !== 'number' || typeof el.y !== 'number') return;
      if (e.delta.x === 0 && e.delta.y === 0) return;
      dispatch({
        type: 'update-element',
        windowId,
        elementId,
        patch: {
          x: Math.max(0, snap(el.x + e.delta.x / zoom)),
          y: Math.max(0, snap(el.y + e.delta.y / zoom))
        }
      });
    }
  };

  const onResize = useCallback(
    (windowId: string, width: number, height: number) =>
      dispatch({ type: 'update-window', id: windowId, patch: { width, height } }),
    []
  );

  const inspect = useCallback((sel: Selection) => {
    setSelection(sel);
    setTab('props');
  }, []);

  const rememberColor = (c: string | null) => {
    if (!c) return;
    setRecentColors((r) => [c, ...r.filter((x) => x !== c)].slice(0, 8));
  };

  /** Paint-bucket: fill whatever was clicked with the active color. */
  const applyPaint = useCallback(
    (sel: Selection) => {
      const c = paint.color ?? undefined;
      if (!sel) return;
      if (sel.kind === 'window') {
        dispatch({ type: 'update-window', id: sel.windowId, patch: { background: c } });
      } else {
        const win = state.layout.windows.find((w) => w.id === sel.windowId);
        const el = win?.elements?.find((x) => x.id === sel.elementId);
        if (!el) return;
        if (el.type === 'RECTANGLE') {
          dispatch({ type: 'update-element', windowId: sel.windowId, elementId: sel.elementId, patch: { fill: c } });
        } else {
          dispatch({ type: 'update-element', windowId: sel.windowId, elementId: sel.elementId, patch: { color: c } });
        }
      }
      rememberColor(paint.color);
    },
    [paint.color, state.layout]
  );

  const paintPage = useCallback(() => {
    dispatch({ type: 'set-page', page: { ...state.layout.page, background: paint.color ?? undefined } });
    rememberColor(paint.color);
  }, [paint.color, state.layout.page]);

  const statusChip = useMemo(
    () => version && <span className={`chip ${version.status}`}>{version.status}</span>,
    [version]
  );

  if (!template) return <div className="loading">Loading template…</div>;

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragMove={onDragMove} onDragEnd={onDragEnd}>
      <div className="toolbar">
        <button onClick={onBack} title="Back to templates">←</button>
        <span className="brand">{template.name}</span>
        <select
          className="version-select"
          value={versionId ?? ''}
          onChange={(e) => {
            const v = versions.find((x) => x.ID === e.target.value);
            if (v) switchVersion(v);
          }}
        >
          {versions.map((v) => (
            <option key={v.ID} value={v.ID}>
              v{v.version} · {v.status}
            </option>
          ))}
        </select>
        {statusChip}
        {state.dirty ? <span className="dirty-dot" title="Unsaved changes" /> : null}
        <span className="spacer" />
        <button onClick={() => dispatch({ type: 'undo' })} disabled={!state.past.length || readOnly} title="Undo (Ctrl+Z)">Undo</button>
        <button onClick={() => dispatch({ type: 'redo' })} disabled={!state.future.length || readOnly} title="Redo (Ctrl+Y)">Redo</button>
        <span className="vr" />
        <button onClick={runChecks} disabled={busy !== null}>Run checks</button>
        <button onClick={preview} disabled={busy !== null}>Preview PDF</button>
        <span className="vr" />
        <button
          className={paint.on ? 'active-tool' : ''}
          title="Paint mode: pick a color, click to fill (Esc to exit)"
          disabled={readOnly}
          onClick={() => setPaint((p) => ({ ...p, on: !p.on }))}
        >
          🖌 Paint
        </button>
        <span className="theme-anchor">
          <button
            className={themeOpen ? 'active-tool' : ''}
            title="Template theme colors (tokens & presets)"
            onClick={() => setThemeOpen((v) => !v)}
          >
            🎨 Theme
          </button>
          {themeOpen && (
            <ThemePanel
              theme={state.layout.theme}
              readOnly={readOnly}
              onChange={(t) => dispatch({ type: 'set-theme', theme: t })}
              onClose={() => setThemeOpen(false)}
            />
          )}
        </span>
        <span className="vr" />
        <button title="Download the layout as JSON" onClick={() => {
          const blob = new Blob([JSON.stringify(state.layout, null, 2)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `${template.name}-layout.json`;
          a.click();
          URL.revokeObjectURL(a.href);
        }}>Export</button>
        <button title="Import a layout JSON file" disabled={readOnly} onClick={() => fileInput.current?.click()}>Import</button>
        <input ref={fileInput} type="file" accept="application/json" style={{ display: 'none' }} onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const l = JSON.parse(await f.text());
            if (!l.page || !Array.isArray(l.windows)) throw new Error('not a layout file');
            dispatch({ type: 'load', layout: l, sampleData: state.sampleData });
            dispatch({ type: 'sync-data' });
            notify('success', 'Layout imported', 'Review and save the draft to keep it.');
          } catch (err) {
            notify('error', 'Import failed', (err as Error).message);
          } finally {
            e.target.value = '';
          }
        }} />
        <button title="Manage uploaded images" onClick={() => { setAssetTarget(null); setDialog('assets'); }}>Assets</button>
        <button title="Lifecycle history of this version" onClick={() => setDialog('history')}>History</button>
        <button title="Compare two versions side by side" onClick={() => setDialog('diff')} disabled={(versions.length || 0) < 2}>Compare</button>
        <button title="How to call this template via the API" onClick={() => setModal('api')}>API</button>
        <button title="Keyboard shortcuts" onClick={() => setModal('shortcuts')}>?</button>
        <span className="vr" />
        {version?.status === 'REVIEW' ? (
          <>
            <button className="primary" onClick={() => void decideReview(true)} disabled={busy !== null}>Approve & publish</button>
            <button onClick={() => void decideReview(false)} disabled={busy !== null}>Reject</button>
          </>
        ) : readOnly ? (
          <button className="primary" onClick={newDraft} disabled={busy !== null}>New draft version</button>
        ) : (
          <>
            <button onClick={() => void save()} disabled={busy !== null || !state.dirty}>
              Save draft
            </button>
            <button onClick={submitReview} disabled={busy !== null} title="Send to a publisher for approval">Submit for review</button>
            <button className="primary" onClick={publish} disabled={busy !== null} title="Publish directly (skips review)">Publish</button>
          </>
        )}
      </div>

      {readOnly && version && (
        <div className="banner">
          {version.status === 'REVIEW'
            ? `Version ${version.version} is awaiting review. Approve to publish it, or reject to send it back to draft.`
            : `Version ${version.version} is ${version.status.toLowerCase()} and locked. Create a new draft version to make changes.`}
        </div>
      )}

      {paint.on && !readOnly && (
        <PaintBar
          color={paint.color}
          recents={recentColors}
          onColor={(c) => setPaint({ on: true, color: c })}
          onClose={() => setPaint((p) => ({ ...p, on: false }))}
        />
      )}
      <div className="designer">
        <div className="leftcol">
          <Palette readOnly={readOnly} blocks={blocks} onDeleteBlock={async (id) => { await api.deleteBlock(id).catch(() => undefined); refreshBlocks(); }} />
          <LayersPanel
            layout={state.layout}
            currentPage={currentPage}
            selection={selection}
            readOnly={readOnly}
            dispatch={dispatch}
            onSelect={inspect}
          />
        </div>
        <Canvas
          layout={state.layout}
          zoom={zoom}
          grid={grid}
          guides={guides}
          currentPage={currentPage}
          paintMode={paint.on && !readOnly}
          onSheetClick={paint.on && !readOnly ? paintPage : undefined}
          selection={selection}
          readOnly={readOnly}
          onSelect={paint.on && !readOnly ? applyPaint : setSelection}
          onInspect={paint.on && !readOnly ? applyPaint : inspect}
          onResize={onResize}
          onZoomDelta={(d) => zoomTo(zoom * (d > 0 ? 0.92 : 1.08))}
          registerSheet={(el) => (sheetEl.current = el)}
        />
        <aside className="side">
          <div className="tabs">
            <button className={tab === 'props' ? 'active' : ''} onClick={() => setTab('props')}>Properties</button>
            <button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}>
              Data{issues?.length ? ` (${issues.length})` : ''}
            </button>
            <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Preview</button>
          </div>
          {tab === 'preview' ? (
            <PreviewPane layout={state.layout} sampleData={state.sampleData} locale={locale} />
          ) : tab === 'props' ? (
            <PropertiesPanel
              layout={state.layout}
              selection={selection}
              readOnly={readOnly}
              dispatch={dispatch}
              onSelect={setSelection}
              onSaveBlock={async (name, windowJson) => {
                try {
                  await api.saveBlock(name, windowJson);
                  refreshBlocks();
                  notify('success', `Block "${name}" saved`, 'Find it at the bottom of the palette.');
                } catch (e) {
                  notify('error', 'Could not save block', (e as Error).message);
                }
              }}
              onPickAsset={() => {
                if (selection?.kind === 'element') setAssetTarget({ windowId: selection.windowId, elementId: selection.elementId });
                setDialog('assets');
              }}
            />
          ) : (
            <DataPanel
              sampleData={state.sampleData}
              readOnly={readOnly}
              issues={issues}
              dispatch={dispatch}
              datasets={datasets}
              activeDataset={activeDataset}
              locale={locale}
              onLocale={setLocale}
              onDataset={(name) => {
                setDatasets((d) => ({ ...d, [activeDataset]: state.sampleData }));
                setActiveDataset(name);
                dispatch({ type: 'set-sample', sampleData: datasets[name] ?? state.sampleData });
              }}
              onSaveDataset={(name) => {
                setDatasets((d) => ({ ...d, [name]: state.sampleData }));
                setActiveDataset(name);
              }}
              onDeleteDataset={(name) => {
                setDatasets((d) => {
                  const n = { ...d };
                  delete n[name];
                  return n;
                });
                if (activeDataset === name) setActiveDataset('default');
              }}
              onSelectWindow={(id) => inspect({ kind: 'window', windowId: id })}
            />
          )}
        </aside>
      </div>

      <div className="statusbar">
        <span>{dims.width}×{dims.height}pt · {state.layout.page.format}</span>
        <span className="pagenav">
          <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1}>‹</button>
          Page {currentPage}/{pages}
          <button onClick={() => setCurrentPage(Math.min(pages, currentPage + 1))} disabled={currentPage >= pages}>›</button>
          {!readOnly && (
            <>
              <button title="Add a page" onClick={() => { dispatch({ type: 'set-page-count', count: pages + 1 }); setCurrentPage(pages + 1); }}>+</button>
              <button title="Remove the last page" disabled={pages <= 1} onClick={() => dispatch({ type: 'set-page-count', count: pages - 1 })}>−</button>
            </>
          )}
        </span>
        <span>{selection ? (selection.kind === 'window'
          ? (() => { const w = state.layout.windows.find((x) => x.id === selection.windowId); return w ? `${w.id}: ${w.x},${w.y} ${w.width}×${w.height}pt` : ''; })()
          : `${selection.windowId}/${selection.elementId}`) : `${state.layout.windows.length} windows`}</span>
        <span className="spacer" />
        <label>
          <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
          Grid & snap 5pt
        </label>
        <span className="zoomctl">
          <button onClick={() => zoomTo(zoom * 0.87)} title="Zoom out (Ctrl+scroll)">−</button>
          <button className="zoomval" onClick={fitWidth} title="Fit width">{Math.round(zoom * 100)}%</button>
          <button onClick={() => zoomTo(zoom * 1.15)} title="Zoom in (Ctrl+scroll)">+</button>
        </span>
      </div>
      <Modals modal={modal} onClose={() => setModal(null)} templateName={template.name} sampleData={state.sampleData} />
      {dialog === 'assets' && (
        <AssetsModal
          onClose={() => { setDialog(null); setAssetTarget(null); }}
          onPick={assetTarget ? (a) => {
            dispatch({ type: 'update-element', windowId: assetTarget.windowId, elementId: assetTarget.elementId, patch: { assetId: a.ID } });
            setDialog(null);
            setAssetTarget(null);
            notify('success', `Image "${a.fileName}" assigned`);
          } : undefined}
        />
      )}
      {dialog === 'history' && version && <HistoryModal versionId={version.ID} onClose={() => setDialog(null)} />}
      {dialog === 'diff' && <DiffModal template={template} onClose={() => setDialog(null)} />}
    </DndContext>
  );
}