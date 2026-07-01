import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useCallback, useEffect, useRef } from 'react';
import type { Layout, LayoutElement, LayoutWindow, Selection } from '../types';
import type { Theme } from '../theme';
import { fillToCss, resolveColor } from '../theme';

/* ── shape previews (client-side mirror of the pdfkit shapes) ───────── */
const SHAPE_TYPES = ['ELLIPSE', 'TRIANGLE', 'POLYGON', 'ARROW', 'DIVIDER', 'CALLOUT', 'WATERMARK', 'SIGNATURE', 'BACKGROUND', 'PAGE_BORDER'];

function ShapePreview({ el, zoom, theme }: { el: LayoutElement; zoom: number; theme?: Theme }) {
  const w = (el.width ?? 80) * zoom;
  const h = (el.height ?? 40) * zoom;
  const fill = fillToCss(el.fill, theme);
  const stroke = resolveColor(el.borderColor, theme) ?? '#333';
  const sw = Math.max(0, (el.borderWidth ?? 0) * zoom);
  const solid = typeof el.fill === 'string' || el.fill === undefined ? resolveColor(el.fill as string | undefined, theme) : undefined;
  const svgFill = solid ?? (typeof el.fill === 'object' ? resolveColor(el.fill.stops?.[0]?.color, theme) : undefined) ?? 'none';
  const dash = (st?: string) => (st === 'dashed' ? '6 4' : st === 'dotted' ? '1 4' : undefined);
  const op = el.opacity;

  if (el.type === 'ELLIPSE')
    return (
      <svg className="shape-prev" width={w} height={h} style={{ opacity: op }}>
        <ellipse cx={w / 2} cy={h / 2} rx={Math.max(1, w / 2 - sw / 2)} ry={Math.max(1, h / 2 - sw / 2)} fill={svgFill} stroke={sw ? stroke : 'none'} strokeWidth={sw} strokeDasharray={dash(el.borderStyle)} />
      </svg>
    );
  if (el.type === 'TRIANGLE' || el.type === 'POLYGON' || el.type === 'ARROW') {
    let pts: [number, number][] = [];
    if (el.type === 'TRIANGLE') {
      const d = el.direction ?? 'up';
      pts = d === 'down' ? [[0, 0], [w, 0], [w / 2, h]] : d === 'left' ? [[w, 0], [w, h], [0, h / 2]] : d === 'right' ? [[0, 0], [0, h], [w, h / 2]] : [[w / 2, 0], [w, h], [0, h]];
    } else if (el.type === 'POLYGON') {
      const n = el.sides && el.sides >= 3 ? el.sides : 6;
      const rot = (((el.rotation ?? 0) - 90) * Math.PI) / 180;
      const r = Math.min(w, h) / 2;
      for (let i = 0; i < n; i++) {
        const a = rot + (i * 2 * Math.PI) / n;
        pts.push([w / 2 + r * Math.cos(a), h / 2 + r * Math.sin(a)]);
      }
    } else {
      const d = el.direction ?? 'right';
      const vert = d === 'up' || d === 'down';
      const s = Math.min((el.thickness ?? (vert ? el.width ?? 26 : el.height ?? 26) * 0.4) * zoom, vert ? w : h);
      const hd = Math.min((el.headSize ?? (vert ? el.height ?? 90 : el.width ?? 90) * 0.35) * zoom, vert ? h : w);
      const cx = w / 2, cy = h / 2;
      if (d === 'right') pts = [[0, cy - s / 2], [w - hd, cy - s / 2], [w - hd, 0], [w, cy], [w - hd, h], [w - hd, cy + s / 2], [0, cy + s / 2]];
      else if (d === 'left') pts = [[w, cy - s / 2], [hd, cy - s / 2], [hd, 0], [0, cy], [hd, h], [hd, cy + s / 2], [w, cy + s / 2]];
      else if (d === 'down') pts = [[cx - s / 2, 0], [cx - s / 2, h - hd], [0, h - hd], [cx, h], [w, h - hd], [cx + s / 2, h - hd], [cx + s / 2, 0]];
      else pts = [[cx - s / 2, h], [cx - s / 2, hd], [0, hd], [cx, 0], [w, hd], [cx + s / 2, hd], [cx + s / 2, h]];
    }
    const arrowFill = el.type === 'ARROW' ? (svgFill !== 'none' ? svgFill : resolveColor(el.color, theme) ?? '#111827') : svgFill;
    return (
      <svg className="shape-prev" width={w} height={h} style={{ opacity: op }}>
        <polygon points={pts.map((p) => p.join(',')).join(' ')} fill={arrowFill} stroke={sw ? stroke : 'none'} strokeWidth={sw} strokeDasharray={dash(el.borderStyle)} />
      </svg>
    );
  }
  if (el.type === 'DIVIDER') {
    const c = resolveColor(el.color, theme) ?? '#D1D5DB';
    const st = el.lineStyle;
    const t = Math.max(1, (el.thickness ?? 1) * zoom);
    return (
      <span className="divider-prev" style={{ width: w, opacity: op }}>
        <i style={{ borderTop: `${t}px ${st === 'double' ? 'double' : st ?? 'solid'} ${c}`, ...(st === 'double' ? { borderTopWidth: t * 3 } : {}) }} />
        {(el.label || el.text) && <em style={{ background: resolveColor(el.labelBackground, theme) ?? '#fff', color: c }}>{el.label || el.text}</em>}
      </span>
    );
  }
  if (el.type === 'CALLOUT')
    return (
      <span
        className="callout-prev"
        style={{
          width: w, height: h, opacity: op,
          background: fill ?? '#F3F4F6',
          borderRadius: (el.cornerRadius ?? 6) * zoom,
          borderLeft: `${Math.max(2, (el.accentWidth ?? 3) * zoom)}px solid ${resolveColor(el.accentColor, theme) ?? '#2563EB'}`,
          padding: (el.padding ?? 8) * zoom,
          color: resolveColor(el.color, theme) ?? '#111827',
          fontWeight: el.bold ? 600 : 400
        }}
      >
        {el.text || (el.binding ? `{${el.binding}}` : 'Callout')}
      </span>
    );
  if (el.type === 'WATERMARK')
    return (
      <span className="wm-prev" style={{ width: w, height: h, opacity: el.opacity ?? 0.15, color: resolveColor(el.color, theme) ?? '#111', transform: `rotate(${el.angle ?? -30}deg)` }}>
        {el.text || 'DRAFT'}{el.fullPage ? ' (full page)' : ''}
      </span>
    );
  if (el.type === 'SIGNATURE')
    return (
      <span className="sig-prev" style={{ width: w, height: h, opacity: op }}>
        <i style={{ borderColor: resolveColor(el.color, theme) ?? '#111827', width: el.showDate ? '58%' : '100%' }} />
        {el.showDate && <i style={{ borderColor: resolveColor(el.color, theme) ?? '#111827', width: '32%' }} />}
        <em style={{ color: resolveColor(el.labelColor, theme) ?? '#6B7280' }}>{el.label ?? 'Signature'}{el.showDate ? ` · ${el.dateLabel ?? 'Date'}` : ''}</em>
      </span>
    );
  // BACKGROUND / PAGE_BORDER: page-scope — show a labeled chip on the canvas
  return (
    <span className="chip-prev">
      <i style={{ background: fill ?? (el.type === 'PAGE_BORDER' ? 'transparent' : '#fff'), borderColor: resolveColor(el.borderColor, theme) ?? '#94a3b8' }} />
      {el.type === 'BACKGROUND' ? 'Page background' : 'Page border'}
    </span>
  );
}

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
  theme,
  selected,
  readOnly,
  onSelect,
  onInspect
}: {
  win: LayoutWindow;
  el: LayoutElement;
  zoom: number;
  theme?: Theme;
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
        color: resolveColor(el.color, theme),
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined
      }
    : {
        fontSize: Math.max(7, (el.fontSize ?? 9) * zoom * 0.9),
        fontWeight: el.bold ? 600 : 400,
        textAlign: el.alignment,
        fontStyle: el.italic ? "italic" : undefined,
        color: resolveColor(el.color, theme)
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
      {SHAPE_TYPES.includes(el.type) ? (
        <ShapePreview el={el} zoom={zoom} theme={theme} />
      ) : el.type === 'RECTANGLE' ? (
        <div
          className="rect-preview"
          style={{
            width: (el.width ?? 60) * zoom,
            height: (el.height ?? 30) * zoom,
            border: `${Math.max(1, (el.borderWidth ?? 1) * zoom)}px ${el.borderStyle === 'double' ? 'double' : el.borderStyle ?? 'solid'} ${resolveColor(el.borderColor, theme) ?? '#333'}`,
            background: fillToCss(el.fill, theme),
            borderRadius: (el.cornerRadius ?? 0) * zoom,
            opacity: el.opacity
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
  theme,
  selection,
  readOnly,
  onSelect,
  onInspect,
  onResizeStart
}: {
  win: LayoutWindow;
  zoom: number;
  theme?: Theme;
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
    background: resolveColor(win.background, theme),
    ...(win.borderWidth
      ? { boxShadow: `inset 0 0 0 ${Math.max(1, win.borderWidth * zoom)}px ${resolveColor(win.borderColor, theme) ?? '#333'}` }
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
              theme={theme}
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
              theme={layout.theme}
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