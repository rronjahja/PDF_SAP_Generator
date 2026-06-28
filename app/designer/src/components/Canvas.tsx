import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useCallback, useEffect, useRef } from 'react';
import type { Layout, LayoutElement, LayoutWindow, Selection } from '../types';

export type Guides = { v?: number; h?: number } | null;
import { pageDims } from '../types';

const RULER = 22; // px width of the rulers

/* ── Rulers (the drafting signature: pt ticks along the sheet) ──────── */
function Ruler({ length, zoom, axis }: { length: number; zoom: number; axis: 'h' | 'v' }) {
  const ticks = [];
  for (let pt = 0; pt <= length; pt += 10) {
    const major = pt % 50 === 0;
    const pos = pt * zoom;
    ticks.push(
      <span
        key={pt}
        className={`tick${major ? ' major' : ''}`}
        style={axis === 'h' ? { left: pos } : { top: pos }}
      />
    );
    if (major && pt > 0) {
      ticks.push(
        <span
          key={`l${pt}`}
          className="tick-label"
          style={axis === 'h' ? { left: pos } : { top: pos }}
        >
          {pt}
        </span>
      );
    }
  }
  const style =
    axis === 'h'
      ? { left: RULER, width: length * zoom, top: 0 }
      : { top: RULER, height: length * zoom, left: 0 };
  return (
    <div className={`ruler ${axis}`} style={style} aria-hidden="true">
      {ticks}
    </div>
  );
}

/* ── Element rendering inside a window ──────────────────────────────── */
function elementCaption(el: LayoutElement): JSX.Element {
  const bind = el.binding ? <span className="b">{`{${el.binding}}`}</span> : null;
  switch (el.type) {
    case 'TEXT':
      return (
        <>
          {el.label ? `${el.label}: ` : ''}
          {el.text || bind || <span className="b">empty text</span>}
        </>
      );
    case 'PAGE_NUMBER':
      return <span className="b">Page n of m</span>;
    case 'LINE':
      return <span className="b">───────</span>;
    default:
      return (
        <>
          <span className="b">{el.type}</span> {bind}
        </>
      );
  }
}

function ElementView({
  win,
  el,
  zoom,
  selected,
  readOnly,
  onSelect,
  onInspect
}: {
  win: LayoutWindow;
  el: LayoutElement;
  zoom: number;
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onInspect: () => void;
}) {
  const abs = typeof el.x === 'number' && typeof el.y === 'number';
  const lastDown = useRef(0);
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `el:${win.id}:${el.id}`,
    disabled: readOnly || !abs
  });
  const style: React.CSSProperties = abs
    ? {
        left: (el.x as number) * zoom,
        top: (el.y as number) * zoom,
        ...(el.width ? { width: el.width * zoom } : {}),
        fontSize: Math.max(7, (el.fontSize ?? 9) * zoom * 0.9),
        fontWeight: el.bold ? 600 : 400,
        textAlign: el.alignment,
        fontStyle: el.italic ? "italic" : undefined,
        color: el.color,
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined
      }
    : {
        fontSize: Math.max(7, (el.fontSize ?? 9) * zoom * 0.9),
        fontWeight: el.bold ? 600 : 400,
        textAlign: el.alignment,
        fontStyle: el.italic ? "italic" : undefined,
        color: el.color
      };
  return (
    <div
      ref={setNodeRef}
      className={`el${abs ? ' abs' : ''}${abs && !readOnly ? ' draggable' : ''}${selected ? ' selected' : ''}`}
      style={style}
      {...(abs && !readOnly ? attributes : {})}
      onPointerDown={(e) => {
        e.stopPropagation();
        const now = Date.now();
        if (now - lastDown.current < 350) onInspect();
        else onSelect();
        lastDown.current = now;
        if (abs && !readOnly) (listeners?.onPointerDown as ((ev: React.PointerEvent) => void) | undefined)?.(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onInspect();
      }}
    >
      {el.type === 'RECTANGLE' ? (
        <div
          className="rect-preview"
          style={{
            width: (el.width ?? 60) * zoom,
            height: (el.height ?? 30) * zoom,
            border: `${Math.max(1, (el.borderWidth ?? 1) * zoom)}px ${el.borderStyle ?? 'solid'} ${el.borderColor ?? '#333'}`,
            background: el.fill,
            borderRadius: (el.cornerRadius ?? 0) * zoom
          }}
        />
      ) : el.type === 'CHECKBOX' ? (
        <span>{el.checked ? '☑' : '☐'} {el.label ?? ''}{el.binding ? ' ' : ''}{el.binding && <span className="b">{`{${el.binding}}`}</span>}</span>
      ) : el.type === 'QR_CODE' || el.type === 'BARCODE' ? (
        <span className={el.type === 'QR_CODE' ? 'code-ph qr' : 'code-ph bar'}>
          {el.type === 'QR_CODE' ? '▦' : '∥∥∥'} {el.binding ? <span className="b">{`{${el.binding}}`}</span> : el.text ?? ''}
        </span>
      ) : el.type === 'IMAGE' && el.assetId ? (
        <img className="img-preview" src={`/api/v1/assets/${el.assetId}`} alt=""
          style={{ width: (el.width ?? 60) * zoom, height: el.height ? el.height * zoom : undefined, objectFit: el.fit ?? 'contain' }} />
      ) : el.type === 'CURRENT_DATE' ? (
        <span>{el.label ? `${el.label}: ` : ''}<span className="b">{'{today}'}</span></span>
      ) : (
        elementCaption(el)
      )}
    </div>
  );
}

/* ── Window on the sheet ────────────────────────────────────────────── */
function WindowView({
  win,
  zoom,
  selection,
  readOnly,
  onSelect,
  onInspect,
  onResizeStart
}: {
  win: LayoutWindow;
  zoom: number;
  selection: Selection;
  readOnly: boolean;
  onSelect: (sel: Selection) => void;
  onInspect: (sel: Selection) => void;
  onResizeStart: (e: React.PointerEvent, win: LayoutWindow) => void;
}) {
  const selected = selection?.windowId === win.id && selection.kind === 'window';
  const lastDown = useRef(0);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `win:${win.id}`,
    disabled: readOnly || !!win.locked
  });
  const { setNodeRef: setDropRef } = useDroppable({ id: `windrop:${win.id}` });

  const style: React.CSSProperties = {
    left: win.x * zoom,
    top: win.y * zoom,
    width: win.width * zoom,
    height: win.height * zoom,
    background: win.background,
    ...(win.borderWidth
      ? { boxShadow: `inset 0 0 0 ${Math.max(1, win.borderWidth * zoom)}px ${win.borderColor ?? '#333'}` }
      : {}),
    borderRadius: win.cornerRadius ? win.cornerRadius * zoom : undefined,
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined
  };

  return (
    <div
      ref={setNodeRef}
      data-window={win.id}
      className={`win t-${win.type}${selected ? ' selected' : ''}${isDragging ? ' dragging' : ''}`}
      style={style}
      {...(!readOnly ? attributes : {})}
      onPointerDown={(e) => {
        e.stopPropagation();
        const now = Date.now();
        if (now - lastDown.current < 350) onInspect({ kind: 'window', windowId: win.id });
        else onSelect({ kind: 'window', windowId: win.id });
        lastDown.current = now;
        if (!readOnly) (listeners?.onPointerDown as ((ev: React.PointerEvent) => void) | undefined)?.(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onInspect({ kind: 'window', windowId: win.id });
      }}
    >
      <span className="win-tag">
        {win.id} · {win.name || win.type}
        {win.repeatOnEveryPage ? ' ∀' : ''}
        {win.locked ? ' 🔒' : ''}
        {win.visibleIf ? ' 👁' : ''}
      </span>
      <div className="win-body" ref={setDropRef}>
        {win.type === 'TABLE' ? (
          <table className="tbl-preview">
            <thead>
              <tr>
                {(win.columns ?? []).map((c, i) => (
                  <th key={i} style={{ width: c.width * zoom }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {(win.columns ?? []).map((c, i) => (
                  <td key={i} style={{ textAlign: c.align }}>{`{${c.binding}}`}</td>
                ))}
              </tr>
            </tbody>
          </table>
        ) : (
          (win.elements ?? []).map((el) => (
            <ElementView
              key={el.id}
              win={win}
              el={el}
              zoom={zoom}
              readOnly={readOnly}
              selected={selection?.kind === 'element' && selection.elementId === el.id}
              onSelect={() => onSelect({ kind: 'element', windowId: win.id, elementId: el.id })}
              onInspect={() => onInspect({ kind: 'element', windowId: win.id, elementId: el.id })}
            />
          ))
        )}
      </div>
      {selected && !readOnly && !win.locked && (
        <span
          className="resize-handle"
          onPointerDown={(e) => {
            e.stopPropagation();
            onResizeStart(e, win);
          }}
        />
      )}
    </div>
  );
}

/* ── Canvas ─────────────────────────────────────────────────────────── */
export function Canvas({
  layout,
  zoom,
  grid,
  guides,
  currentPage,
  paintMode,
  onSheetClick,
  selection,
  readOnly,
  onSelect,
  onInspect,
  onResize,
  onZoomDelta,
  registerSheet
}: {
  layout: Layout;
  zoom: number;
  grid: boolean;
  guides: Guides;
  currentPage: number;
  paintMode?: boolean;
  onSheetClick?: () => void;
  selection: Selection;
  readOnly: boolean;
  onSelect: (sel: Selection) => void;
  onInspect: (sel: Selection) => void;
  onResize: (windowId: string, width: number, height: number) => void;
  onZoomDelta: (deltaY: number) => void;
  registerSheet: (el: HTMLDivElement | null) => void;
}) {
  const page = pageDims(layout);
  const { setNodeRef } = useDroppable({ id: 'sheet' });
  const sheetRef = useRef<HTMLDivElement | null>(null);

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      sheetRef.current = el;
      setNodeRef(el);
      registerSheet(el);
    },
    [setNodeRef, registerSheet]
  );

  // Resize via pointer events (dnd-kit handles moving, not resizing)
  const resizing = useRef<{ id: string; startX: number; startY: number; w: number; h: number } | null>(null);

  const onResizeStart = (e: React.PointerEvent, win: LayoutWindow) => {
    resizing.current = { id: win.id, startX: e.clientX, startY: e.clientY, w: win.width, h: win.height };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const r = resizing.current;
      if (!r) return;
      const w = Math.max(20, r.w + (e.clientX - r.startX) / zoom);
      const h = Math.max(15, r.h + (e.clientY - r.startY) / zoom);
      onResize(r.id, Math.round(w / 5) * 5, Math.round(h / 5) * 5);
    };
    const up = () => (resizing.current = null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [zoom, onResize]);

  return (
    <div
      className={`desk${paintMode ? ' painting' : ''}`}
      onPointerDown={() => onSelect(null)}
      onWheel={(e) => {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          onZoomDelta(e.deltaY);
        }
      }}
    >
      <div className="desk-inner" style={{ paddingTop: RULER + 14, paddingLeft: RULER + 14 }}>
        <Ruler length={page.width} zoom={zoom} axis="h" />
        <Ruler length={page.height} zoom={zoom} axis="v" />
        <div
          ref={setRefs}
          className={`sheet${readOnly ? ' readonly' : ''}${grid ? ' grid' : ''}`}
          style={{
            width: page.width * zoom,
            height: page.height * zoom,
            backgroundColor: layout.page.background ?? '#ffffff',
            ...(grid ? { backgroundSize: `${10 * zoom}px ${10 * zoom}px` } : {})
          }}
          onPointerDown={(e) => {
            if (onSheetClick) {
              e.stopPropagation();
              onSheetClick();
            }
          }}
        >
          {layout.windows
            .filter((w) => w.repeatOnEveryPage || (w.page || 1) === currentPage)
            .map((w) => (
            <WindowView
              key={w.id}
              win={w}
              zoom={zoom}
              selection={selection}
              readOnly={readOnly}
              onSelect={onSelect}
              onInspect={onInspect}
              onResizeStart={onResizeStart}
            />
          ))}
          {guides?.v !== undefined && <div className="guide v" style={{ left: guides.v * zoom }} />}
          {guides?.h !== undefined && <div className="guide h" style={{ top: guides.h * zoom }} />}
        </div>
      </div>
    </div>
  );
}
