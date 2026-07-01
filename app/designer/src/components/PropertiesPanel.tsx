import type { Dispatch } from 'react';
import { useState } from 'react';
import { nextBinding } from '../data-utils';
import type { EditorAction } from '../state';
import type { Layout, LayoutElement, LayoutWindow, Selection, TableColumn } from '../types';
import { BARCODE_SYMBOLOGIES, ELEMENT_TYPES, FONT_FAMILIES, FORMATS, layoutPages, WINDOW_TYPES } from '../types';
import { nextElementId, nextWindowId } from '../types';

/* ── Small form primitives ──────────────────────────────────────────── */
import { ColorPicker } from './ColorPicker';
import type { Theme } from '../theme';
import type { GradientFill } from '../types';

const SHAPE_STYLE_TYPES = ['RECTANGLE', 'ELLIPSE', 'TRIANGLE', 'POLYGON', 'CALLOUT', 'BACKGROUND'];
const NO_BINDING_TYPES = ['PAGE_NUMBER', 'LINE', 'RECTANGLE', 'CURRENT_DATE', 'ELLIPSE', 'TRIANGLE', 'POLYGON', 'ARROW', 'DIVIDER', 'SIGNATURE', 'BACKGROUND', 'PAGE_BORDER'];
const NO_TEXTSTYLE_TYPES = ['RECTANGLE', 'ELLIPSE', 'TRIANGLE', 'POLYGON', 'ARROW', 'BACKGROUND', 'PAGE_BORDER', 'DIVIDER'];

/** Solid color / linear gradient / none — for shape fills. */
function FillEditor({ value, theme, readOnly, onChange }: {
  value?: string | GradientFill;
  theme?: Theme;
  readOnly: boolean;
  onChange: (v: string | GradientFill | undefined) => void;
}) {
  const kind = value === undefined ? 'none' : typeof value === 'string' ? 'solid' : 'gradient';
  const grad = kind === 'gradient' ? (value as GradientFill) : undefined;
  return (
    <>
      <Row label="Fill">
        <select
          value={kind}
          disabled={readOnly}
          onChange={(e) => {
            const k = e.target.value;
            if (k === 'none') onChange(undefined);
            else if (k === 'solid') onChange(typeof value === 'string' ? value : '#eef3fa');
            else onChange({ type: 'linear', angle: 90, stops: [{ at: 0, color: typeof value === 'string' ? value : '#0a6ed1' }, { at: 1, color: '#ffffff' }] });
          }}
        >
          <option value="none">none</option>
          <option value="solid">solid</option>
          <option value="gradient">gradient</option>
        </select>
        {kind === 'solid' && (
          <ColorPicker value={value as string} theme={theme} disabled={readOnly} allowClear={false} onChange={(v) => onChange(v ?? undefined)} />
        )}
      </Row>
      {grad && (
        <>
          <div className="prow2">
            <Row label="From">
              <ColorPicker value={grad.stops[0]?.color} theme={theme} disabled={readOnly} allowClear={false}
                onChange={(v) => v && onChange({ ...grad, stops: [{ at: 0, color: v }, grad.stops[1] ?? { at: 1, color: '#ffffff' }] })} />
            </Row>
            <Row label="To">
              <ColorPicker value={grad.stops[grad.stops.length - 1]?.color} theme={theme} disabled={readOnly} allowClear={false}
                onChange={(v) => v && onChange({ ...grad, stops: [grad.stops[0] ?? { at: 0, color: '#0a6ed1' }, { at: 1, color: v }] })} />
            </Row>
          </div>
          <Row label="Angle°">
            <Num value={grad.angle ?? 0} disabled={readOnly} onChange={(v) => onChange({ ...grad, angle: v ?? 0 })} />
          </Row>
        </>
      )}
    </>
  );
}

/** Tiny helper that composes a valid expr.js condition (path op value). */
function ConditionBuilder({ onApply }: { onApply: (expr: string) => void }) {
  const [p, setP] = useState('');
  const [op, setOp] = useState('==');
  const [v, setV] = useState('');
  const compose = () => {
    if (!p.trim()) return;
    if (op === 'truthy') return onApply(p.trim());
    const raw = v.trim();
    const lit = raw === '' ? "''" : /^(true|false|\d+(\.\d+)?)$/.test(raw) ? raw : `'${raw.replace(/'/g, "\\'")}'`;
    onApply(`${p.trim()} ${op} ${lit}`);
  };
  return (
    <div className="cond-builder">
      <input className="mono" placeholder="field e.g. invoice.status" value={p} onChange={(e) => setP(e.target.value)} />
      <select value={op} onChange={(e) => setOp(e.target.value)}>
        <option>==</option><option>!=</option><option>&gt;</option><option>&lt;</option><option>&gt;=</option><option>&lt;=</option>
        <option value="truthy">is set</option>
      </select>
      <input className="mono" placeholder="value" value={v} disabled={op === 'truthy'} onChange={(e) => setV(e.target.value)} />
      <button className="linkish" onClick={compose}>Set</button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="prow">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Num({
  value,
  onChange,
  disabled,
  min = 0
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  disabled?: boolean;
  min?: number;
}) {
  return (
    <input
      type="number"
      min={min}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

function Txt({
  value,
  onChange,
  disabled,
  mono,
  placeholder
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  disabled?: boolean;
  mono?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      className={mono ? 'mono' : undefined}
      value={value ?? ''}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value || undefined)}
    />
  );
}

/* ── Table columns editor ───────────────────────────────────────────── */
function ColumnsEditor({
  win,
  readOnly,
  dispatch
}: {
  win: LayoutWindow;
  readOnly: boolean;
  dispatch: Dispatch<EditorAction>;
}) {
  const cols = win.columns ?? [];
  const update = (i: number, patch: Partial<TableColumn>) =>
    dispatch({
      type: 'update-window',
      id: win.id,
      patch: { columns: cols.map((c, j) => (j === i ? { ...c, ...patch } : c)) }
    });
  const remove = (i: number) =>
    dispatch({ type: 'update-window', id: win.id, patch: { columns: cols.filter((_, j) => j !== i) } });
  const add = () =>
    dispatch({
      type: 'update-window',
      id: win.id,
      patch: { columns: [...cols, { label: `Column ${cols.length + 1}`, binding: `col${cols.length + 1}`, width: 80 }] }
    });

  const total = cols.reduce((s, c) => s + (c.width || 0), 0);

  return (
    <div className="cols-editor">
      <div className="cols-head">
        <span>Columns</span>
        <span className={`mono${total > win.width ? ' over' : ''}`}>{total}/{win.width}pt</span>
      </div>
      {cols.map((c, i) => (
        <div className="col-row" key={i}>
          <Txt value={c.label} disabled={readOnly} onChange={(v) => update(i, { label: v ?? '' })} placeholder="Label" />
          <Txt
            value={c.binding}
            disabled={readOnly}
            mono
            onChange={(v) => dispatch({ type: 'rename-column-binding', windowId: win.id, index: i, binding: v ?? '' })}
            placeholder="binding"
          />
          <Num value={c.width} disabled={readOnly} min={10} onChange={(v) => update(i, { width: v ?? 10 })} />
          <select value={c.format ?? 'text'} disabled={readOnly} onChange={(e) => update(i, { format: e.target.value === 'text' ? undefined : e.target.value })}>
            {FORMATS.map((f) => <option key={f}>{f}</option>)}
          </select>
          <select value={c.align ?? 'left'} disabled={readOnly} onChange={(e) => update(i, { align: e.target.value === 'left' ? undefined : (e.target.value as TableColumn['align']) })} title="Alignment">
            <option value="left">←</option>
            <option value="center">↔</option>
            <option value="right">→</option>
          </select>
          <button className="icon danger" disabled={readOnly} onClick={() => remove(i)} title="Remove column">×</button>
        </div>
      ))}
      <button disabled={readOnly} onClick={add}>Add column</button>
    </div>
  );
}

/* ── Element form ───────────────────────────────────────────────────── */
function ElementForm({
  win,
  el,
  theme,
  customFonts = [],
  readOnly,
  dispatch,
  onSelect,
  onPickAsset
}: {
  win: LayoutWindow;
  el: LayoutElement;
  theme?: Theme;
  customFonts?: string[];
  readOnly: boolean;
  dispatch: Dispatch<EditorAction>;
  onSelect: (s: Selection) => void;
  onPickAsset?: () => void;
}) {
  const patch = (p: Partial<LayoutElement>) =>
    dispatch({ type: 'update-element', windowId: win.id, elementId: el.id, patch: p });
  const positioned = typeof el.x === 'number';
  return (
    <div className="pform">
      <button className="linkish" onClick={() => onSelect({ kind: 'window', windowId: win.id })}>
        ← Window {win.id}
      </button>
      <h4>
        Element <span className="mono">{el.id}</span> · {el.type}
      </h4>
      {el.type === 'TEXT' || el.type === 'PAGE_NUMBER' || el.type === 'CALLOUT' || el.type === 'WATERMARK' ? (
        <Row label="Text"><Txt value={el.text} disabled={readOnly} onChange={(v) => patch({ text: v })} /></Row>
      ) : null}
      {!NO_BINDING_TYPES.includes(el.type) && (
        <Row label="Binding"><Txt value={el.binding} disabled={readOnly} mono placeholder="customer.name" onChange={(v) => patch({ binding: v })} /></Row>
      )}
      {el.type === 'IMAGE' && (
        <>
          <Row label="Asset">
            <span className="color-field">
              <span className="mono" style={{ fontSize: 10 }}>{el.assetId ? el.assetId.slice(0, 8) + '…' : '—'}</span>
              {onPickAsset && <button className="linkish" disabled={readOnly} onClick={onPickAsset}>choose…</button>}
              {el.assetId && <button className="linkish" disabled={readOnly} onClick={() => patch({ assetId: undefined })}>clear</button>}
            </span>
          </Row>
          <Row label="URL"><Txt value={el.url} disabled={readOnly} mono placeholder="https://… (or use an asset)" onChange={(v) => patch({ url: v })} /></Row>
          <Row label="Fit">
            <select value={el.fit ?? 'auto'} disabled={readOnly} onChange={(e) => patch({ fit: e.target.value === 'auto' ? undefined : (e.target.value as LayoutElement['fit']) })}>
              <option value="auto">stretch to box</option>
              <option value="contain">contain</option>
              <option value="cover">cover</option>
            </select>
          </Row>
          <div className="prow2">
            <Row label="W (cm)">
              <Num value={el.width !== undefined ? Math.round((el.width / 28.3465) * 100) / 100 : undefined} disabled={readOnly}
                onChange={(v) => v !== undefined && patch({ width: Math.max(6, Math.round(v * 28.3465)) })} />
            </Row>
            <Row label="H (cm)">
              <Num value={el.height !== undefined ? Math.round((el.height / 28.3465) * 100) / 100 : undefined} disabled={readOnly}
                onChange={(v) => v !== undefined && patch({ height: Math.max(6, Math.round(v * 28.3465)) })} />
            </Row>
          </div>
          <Row label="Size">
            <button className="linkish" disabled={readOnly || !el.assetId} onClick={() => {
              const img = new Image();
              img.onload = () => {
                const PT = 72 / 96;
                let w = img.naturalWidth * PT, h = img.naturalHeight * PT;
                if (!w || !h) return;
                const maxW = win.width - (el.x ?? 0), maxH = win.height - (el.y ?? 0);
                const k = Math.min(1, maxW / w, maxH / h);
                patch({ width: Math.max(6, Math.round(w * k)), height: Math.max(6, Math.round(h * k)) });
              };
              img.src = `/api/v1/assets/${el.assetId}`;
            }}>↺ original size{' '}(fit window)</button>
          </Row>
        </>
      )}
      {el.type === 'BARCODE' && (
        <>
          <Row label="Symbology">
            <select value={el.symbology ?? 'code128'} disabled={readOnly} onChange={(e) => patch({ symbology: e.target.value === 'code128' ? undefined : e.target.value })}>
              {BARCODE_SYMBOLOGIES.map((b) => <option key={b}>{b}</option>)}
            </select>
          </Row>
          <Row label="Show text">
            <input type="checkbox" checked={el.showText !== false} disabled={readOnly} onChange={(e) => patch({ showText: e.target.checked ? undefined : false })} />
          </Row>
        </>
      )}
      {el.type === 'CHECKBOX' && (
        <Row label="Checked">
          <input type="checkbox" checked={!!el.checked} disabled={readOnly} onChange={(e) => patch({ checked: e.target.checked || undefined })} />
          <span className="muted" style={{ fontSize: 11 }}>default when no binding</span>
        </Row>
      )}
      {SHAPE_STYLE_TYPES.includes(el.type) && (
        <>
          <FillEditor value={el.fill} theme={theme} readOnly={readOnly} onChange={(v) => patch({ fill: v })} />
          {el.type !== 'BACKGROUND' && (
            <>
              <div className="prow2">
                <Row label="Border pt"><Num value={el.borderWidth ?? (el.type === 'RECTANGLE' ? 1 : 0)} disabled={readOnly} onChange={(v) => patch({ borderWidth: v })} /></Row>
                {(el.type === 'RECTANGLE' || el.type === 'CALLOUT') ? (
                  <Row label="Radius"><Num value={el.cornerRadius} disabled={readOnly} onChange={(v) => patch({ cornerRadius: v })} /></Row>
                ) : <span />}
              </div>
              <Row label="Border color">
                <ColorPicker value={el.borderColor} theme={theme} disabled={readOnly} onChange={(v) => patch({ borderColor: v })} />
              </Row>
              <Row label="Border style">
                <select value={el.borderStyle ?? 'solid'} disabled={readOnly} onChange={(e) => patch({ borderStyle: e.target.value === 'solid' ? undefined : (e.target.value as LayoutElement['borderStyle']) })}>
                  <option>solid</option><option>dashed</option><option>dotted</option>
                </select>
              </Row>
            </>
          )}
        </>
      )}
      {(el.type === 'TRIANGLE' || el.type === 'ARROW') && (
        <Row label="Direction">
          <select value={el.direction ?? (el.type === 'ARROW' ? 'right' : 'up')} disabled={readOnly} onChange={(e) => patch({ direction: e.target.value as LayoutElement['direction'] })}>
            <option>up</option><option>down</option><option>left</option><option>right</option>
          </select>
        </Row>
      )}
      {el.type === 'POLYGON' && (
        <div className="prow2">
          <Row label="Sides"><Num value={el.sides ?? 6} disabled={readOnly} min={3} onChange={(v) => patch({ sides: v })} /></Row>
          <Row label="Rotate°"><Num value={el.rotation} disabled={readOnly} onChange={(v) => patch({ rotation: v })} /></Row>
        </div>
      )}
      {el.type === 'ARROW' && (
        <div className="prow2">
          <Row label="Shaft pt"><Num value={el.thickness} disabled={readOnly} onChange={(v) => patch({ thickness: v })} /></Row>
          <Row label="Head pt"><Num value={el.headSize} disabled={readOnly} onChange={(v) => patch({ headSize: v })} /></Row>
        </div>
      )}
      {el.type === 'DIVIDER' && (
        <>
          <div className="prow2">
            <Row label="Line pt"><Num value={el.thickness ?? 1} disabled={readOnly} onChange={(v) => patch({ thickness: v })} /></Row>
            <Row label="Style">
              <select value={el.lineStyle ?? 'solid'} disabled={readOnly} onChange={(e) => patch({ lineStyle: e.target.value === 'solid' ? undefined : (e.target.value as LayoutElement['lineStyle']) })}>
                <option>solid</option><option>dashed</option><option>dotted</option><option>double</option>
              </select>
            </Row>
          </div>
          <Row label="Label bg">
            <ColorPicker value={el.labelBackground} theme={theme} disabled={readOnly} clearLabel="paper" onChange={(v) => patch({ labelBackground: v })} />
          </Row>
        </>
      )}
      {el.type === 'CALLOUT' && (
        <div className="prow2">
          <Row label="Accent">
            <ColorPicker value={el.accentColor} theme={theme} disabled={readOnly} onChange={(v) => patch({ accentColor: v })} />
          </Row>
          <Row label="Pad pt"><Num value={el.padding ?? 8} disabled={readOnly} onChange={(v) => patch({ padding: v })} /></Row>
        </div>
      )}
      {el.type === 'WATERMARK' && (
        <div className="prow2">
          <Row label="Angle°"><Num value={el.angle ?? -30} disabled={readOnly} onChange={(v) => patch({ angle: v })} /></Row>
          <Row label="Full page">
            <input type="checkbox" checked={!!el.fullPage} disabled={readOnly} onChange={(e) => patch({ fullPage: e.target.checked || undefined })} />
          </Row>
        </div>
      )}
      {el.type === 'SIGNATURE' && (
        <>
          <div className="prow2">
            <Row label="Date line">
              <input type="checkbox" checked={!!el.showDate} disabled={readOnly} onChange={(e) => patch({ showDate: e.target.checked || undefined })} />
            </Row>
            <Row label="Date label"><Txt value={el.dateLabel} disabled={readOnly} placeholder="Date" onChange={(v) => patch({ dateLabel: v })} /></Row>
          </div>
          <Row label="Label color">
            <ColorPicker value={el.labelColor} theme={theme} disabled={readOnly} onChange={(v) => patch({ labelColor: v })} />
          </Row>
        </>
      )}
      {['ACTION_BUTTON', 'ACTION_QR', 'ACTION_LINK'].includes(el.type) && (
        <>
          <Row label="Action">
            <select value={el.actionType ?? 'approve'} disabled={readOnly}
              onChange={(e) => patch({ actionType: e.target.value as LayoutElement['actionType'] })}>
              <option value="approve">approve</option>
              <option value="reject">reject</option>
              <option value="submit">submit data</option>
              <option value="webhook">call webhook</option>
              <option value="open-url">open a URL (no hosted page)</option>
            </select>
          </Row>
          {el.actionType === 'webhook' && (
            <Row label="Webhook URL">
              <Txt value={el.webhookUrl} disabled={readOnly} mono placeholder="https://…" onChange={(v) => patch({ webhookUrl: v })} />
            </Row>
          )}
          {el.actionType === 'open-url' ? (
            <Row label="Link URL">
              <Txt value={el.href} disabled={readOnly} mono placeholder="https://portal.example.com/…" onChange={(v) => patch({ href: v })} />
            </Row>
          ) : (
            <>
              <Row label="Explain">
                <Txt value={el.description} disabled={readOnly} placeholder="What happens when they act (shown on the page)" onChange={(v) => patch({ description: v })} />
              </Row>
              <div className="prow2">
                <Row label="Button text"><Txt value={el.confirmLabel} disabled={readOnly} placeholder="e.g. Release order" onChange={(v) => patch({ confirmLabel: v })} /></Row>
                <Row label="Success msg"><Txt value={el.successMessage} disabled={readOnly} placeholder="e.g. Order released!" onChange={(v) => patch({ successMessage: v })} /></Row>
              </div>
            </>
          )}
          <div className="prow2">
            <Row label="Expires (d)"><Num value={el.expiresInDays ?? 30} disabled={readOnly} min={1} onChange={(v) => patch({ expiresInDays: v })} /></Row>
            <Row label="One-time">
              <input type="checkbox" checked={el.oneTime !== false} disabled={readOnly}
                onChange={(e) => patch({ oneTime: e.target.checked ? undefined : false })} />
            </Row>
          </div>
          <p className="palette-hint" style={{ margin: '2px 0 6px' }}>
            On generate, this mints a signed hosted URL. The recipient opens it (tap/scan) and the action executes with full audit logging.
          </p>
          {el.type === 'ACTION_BUTTON' && (
            <FillEditor value={el.fill} theme={theme} readOnly={readOnly} onChange={(v) => patch({ fill: v })} />
          )}
        </>
      )}
      {el.type === 'PAGE_BORDER' && (
        <>
          <div className="prow2">
            <Row label="Inset pt"><Num value={el.inset ?? 12} disabled={readOnly} onChange={(v) => patch({ inset: v })} /></Row>
            <Row label="Border pt"><Num value={el.borderWidth ?? 1} disabled={readOnly} onChange={(v) => patch({ borderWidth: v })} /></Row>
          </div>
          <Row label="Border color">
            <ColorPicker value={el.borderColor} theme={theme} disabled={readOnly} onChange={(v) => patch({ borderColor: v })} />
          </Row>
          <div className="prow2">
            <Row label="Style">
              <select value={el.borderStyle ?? 'solid'} disabled={readOnly} onChange={(e) => patch({ borderStyle: e.target.value === 'solid' ? undefined : (e.target.value as LayoutElement['borderStyle']) })}>
                <option>solid</option><option>dashed</option><option>dotted</option><option>double</option>
              </select>
            </Row>
            <Row label="Radius"><Num value={el.cornerRadius} disabled={readOnly} onChange={(v) => patch({ cornerRadius: v })} /></Row>
          </div>
        </>
      )}
      {(SHAPE_STYLE_TYPES.includes(el.type) || el.type === 'ARROW' || el.type === 'WATERMARK' || el.type === 'IMAGE') && (
        <Row label="Opacity">
          <input type="range" min={0} max={1} step={0.05} value={el.opacity ?? 1} disabled={readOnly}
            onChange={(e) => patch({ opacity: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })} />
          <span className="muted" style={{ fontSize: 11 }}>{Math.round((el.opacity ?? 1) * 100)}%</span>
        </Row>
      )}
      <Row label="Label"><Txt value={el.label} disabled={readOnly} onChange={(v) => patch({ label: v })} /></Row>
      {!['RECTANGLE', 'CHECKBOX', 'LINE', 'IMAGE', ...NO_TEXTSTYLE_TYPES, 'SIGNATURE'].includes(el.type) && (
        <Row label="Format">
          <select value={el.format ?? 'text'} disabled={readOnly} onChange={(e) => patch({ format: e.target.value === 'text' ? undefined : e.target.value })}>
            {FORMATS.map((f) => <option key={f}>{f}</option>)}
          </select>
        </Row>
      )}
      {['TEXT', 'PAGE_NUMBER', 'CHECKBOX', 'CURRENT_DATE'].includes(el.type) && (
        <Row label="Font">
          <select value={el.fontFamily ?? 'Helvetica'} disabled={readOnly} onChange={(e) => patch({ fontFamily: e.target.value === 'Helvetica' ? undefined : e.target.value })}>
            {FONT_FAMILIES.map((f) => <option key={f}>{f}</option>)}
            {customFonts.map((f) => <option key={f} value={f}>{f} (custom)</option>)}
          </select>
        </Row>
      )}
      <div className="prow2">
        <Row label="Font pt"><Num value={el.fontSize} disabled={readOnly} min={5} onChange={(v) => patch({ fontSize: v })} /></Row>
        <Row label="Align">
          <select value={el.alignment ?? 'left'} disabled={readOnly} onChange={(e) => patch({ alignment: e.target.value === 'left' ? undefined : (e.target.value as LayoutElement['alignment']) })}>
            <option>left</option>
            <option>center</option>
            <option>right</option>
          </select>
        </Row>
      </div>
      <div className="prow2">
        <Row label="Bold">
          <input type="checkbox" checked={!!el.bold} disabled={readOnly} onChange={(e) => patch({ bold: e.target.checked || undefined })} />
        </Row>
        <Row label="Italic">
          <input type="checkbox" checked={!!el.italic} disabled={readOnly} onChange={(e) => patch({ italic: e.target.checked || undefined })} />
        </Row>
      </div>
      {el.type !== 'BACKGROUND' && (
        <Row label="Color">
          <ColorPicker value={el.color} theme={theme} disabled={readOnly} clearLabel="default" onChange={(v) => patch({ color: v })} />
        </Row>
      )}
      {el.type === 'LINE' && (
        <>
          <div className="prow2">
            <Row label="Line style">
              <select value={el.lineStyle ?? el.borderStyle ?? 'solid'} disabled={readOnly}
                onChange={(e) => patch({ lineStyle: e.target.value === 'solid' ? undefined : (e.target.value as LayoutElement['lineStyle']), borderStyle: undefined })}>
                <option>solid</option><option>dashed</option><option>dotted</option><option>double</option>
              </select>
            </Row>
            <Row label="Direction">
              <select value={el.orientation ?? 'horizontal'} disabled={readOnly}
                onChange={(e) => patch({ orientation: e.target.value === 'horizontal' ? undefined : 'vertical' })}>
                <option>horizontal</option><option>vertical</option>
              </select>
            </Row>
          </div>
          <Row label="Line pt"><Num value={el.thickness ?? el.height ?? 1} disabled={readOnly} onChange={(v) => patch({ thickness: v })} /></Row>
        </>
      )}
      <Row label="Position">
        <select
          value={positioned ? 'absolute' : 'stacked'}
          disabled={readOnly}
          onChange={(e) =>
            e.target.value === 'stacked'
              ? patch({ x: undefined, y: undefined, width: undefined, height: undefined })
              : patch({ x: 0, y: 0 })
          }
        >
          <option value="stacked">stacked (top to bottom)</option>
          <option value="absolute">absolute (x/y in pt)</option>
        </select>
      </Row>
      {positioned && (
        <>
          <div className="prow2">
            <Row label="x"><Num value={el.x} disabled={readOnly} onChange={(v) => patch({ x: v ?? 0 })} /></Row>
            <Row label="y"><Num value={el.y} disabled={readOnly} onChange={(v) => patch({ y: v ?? 0 })} /></Row>
          </div>
          <div className="prow2">
            <Row label="Width"><Num value={el.width} disabled={readOnly} onChange={(v) => patch({ width: v })} /></Row>
            <Row label="Height"><Num value={el.height} disabled={readOnly} onChange={(v) => patch({ height: v })} /></Row>
          </div>
        </>
      )}
      <Row label="Visible if">
        <Txt value={el.visibleIf} disabled={readOnly} mono placeholder="discount > 0" onChange={(v) => patch({ visibleIf: v })} />
      </Row>
      {!readOnly && <ConditionBuilder onApply={(expr) => patch({ visibleIf: expr })} />}
      {positioned && (
        <Row label="Align">
          <span className="align-row">
            <button title="Align left" disabled={readOnly} onClick={() => patch({ x: 0 })}>⇤</button>
            <button title="Center horizontally" disabled={readOnly} onClick={() => patch({ x: Math.max(0, Math.round((win.width - (el.width ?? 0)) / 2)) })}>↔</button>
            <button title="Align right" disabled={readOnly} onClick={() => patch({ x: Math.max(0, Math.round(win.width - (el.width ?? 0))) })}>⇥</button>
            <button title="Align top" disabled={readOnly} onClick={() => patch({ y: 0 })}>⤒</button>
            <button title="Center vertically" disabled={readOnly} onClick={() => patch({ y: Math.max(0, Math.round((win.height - (el.height ?? (el.fontSize ?? 10) * 1.2)) / 2)) })}>↕</button>
            <button title="Align bottom" disabled={readOnly} onClick={() => patch({ y: Math.max(0, Math.round(win.height - (el.height ?? (el.fontSize ?? 10) * 1.2))) })}>⤓</button>
          </span>
        </Row>
      )}
      <Row label="Arrange">
        <span className="align-row">
          <button title="Send backward (Ctrl+[)" disabled={readOnly} onClick={() => dispatch({ type: 'reorder-element', windowId: win.id, elementId: el.id, direction: -1 })}>▼ Back</button>
          <button title="Bring forward (Ctrl+])" disabled={readOnly} onClick={() => dispatch({ type: 'reorder-element', windowId: win.id, elementId: el.id, direction: 1 })}>▲ Front</button>
        </span>
      </Row>
      <div className="btn-row">
        <button
          disabled={readOnly}
          onClick={() => {
            const newId = nextElementId(win, el.type);
            dispatch({ type: 'duplicate-element', windowId: win.id, elementId: el.id, newId });
            onSelect({ kind: 'element', windowId: win.id, elementId: newId });
          }}
        >
          Duplicate
        </button>
        <button
          className="danger"
          disabled={readOnly}
          onClick={() => {
            dispatch({ type: 'remove-element', windowId: win.id, elementId: el.id });
            onSelect({ kind: 'window', windowId: win.id });
          }}
        >
          Delete element
        </button>
      </div>
    </div>
  );
}

/* ── Window form ────────────────────────────────────────────────────── */
function WindowForm({
  layout,
  win,
  readOnly,
  dispatch,
  onSelect,
  onSaveBlock
}: {
  layout: Layout;
  win: LayoutWindow;
  readOnly: boolean;
  dispatch: Dispatch<EditorAction>;
  onSelect: (s: Selection) => void;
  onSaveBlock?: (name: string, windowJson: string) => void;
}) {
  const pageDimsOf = (l: Layout) => {
    const f = l.page?.format === 'LETTER' ? { width: 612, height: 792 } : { width: 595, height: 842 };
    return l.page?.orientation === 'landscape' ? { width: f.height, height: f.width } : f;
  };
  const pd = pageDimsOf(layout);
  const patch = (p: Partial<LayoutWindow>) => dispatch({ type: 'update-window', id: win.id, patch: p });
  return (
    <div className="pform">
      <h4>
        Window <span className="mono">{win.id}</span>
      </h4>
      <Row label="Name"><Txt value={win.name} disabled={readOnly} onChange={(v) => patch({ name: v })} /></Row>
      <Row label="Type">
        <select value={win.type} disabled={readOnly} onChange={(e) => patch({ type: e.target.value as LayoutWindow['type'] })}>
          {WINDOW_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </Row>
      <div className="prow2">
        <Row label="x"><Num value={win.x} disabled={readOnly} onChange={(v) => patch({ x: v ?? 0 })} /></Row>
        <Row label="y"><Num value={win.y} disabled={readOnly} onChange={(v) => patch({ y: v ?? 0 })} /></Row>
      </div>
      <div className="prow2">
        <Row label="Width"><Num value={win.width} disabled={readOnly} min={10} onChange={(v) => patch({ width: v ?? 10 })} /></Row>
        <Row label="Height"><Num value={win.height} disabled={readOnly} min={10} onChange={(v) => patch({ height: v ?? 10 })} /></Row>
      </div>
      <div className="prow2">
        <Row label="Page">
          <select
            value={win.repeatOnEveryPage ? 'all' : String(win.page ?? 1)}
            disabled={readOnly}
            onChange={(e) => {
              if (e.target.value === 'all') patch({ repeatOnEveryPage: true, page: undefined });
              else patch({ repeatOnEveryPage: undefined, page: Number(e.target.value) === 1 ? undefined : Number(e.target.value) });
            }}
          >
            {Array.from({ length: layoutPages(layout) }, (_, i) => (
              <option key={i + 1} value={String(i + 1)}>{i + 1}</option>
            ))}
            <option value="all">every page</option>
          </select>
        </Row>
        <Row label="Locked">
          <input type="checkbox" checked={!!win.locked} disabled={readOnly} onChange={(e) => patch({ locked: e.target.checked || undefined })} />
        </Row>
      </div>
      {!readOnly && (
        <Row label="Align">
          <span className="align-btns">
            <button title="Left" onClick={() => patch({ x: 0 })}>⇤</button>
            <button title="Center" onClick={() => patch({ x: Math.round((pd.width - win.width) / 2) })}>⇹</button>
            <button title="Right" onClick={() => patch({ x: pd.width - win.width })}>⇥</button>
            <button title="Top" onClick={() => patch({ y: 0 })}>⤒</button>
            <button title="Middle" onClick={() => patch({ y: Math.round((pd.height - win.height) / 2) })}>⇳</button>
            <button title="Bottom" onClick={() => patch({ y: pd.height - win.height })}>⤓</button>
          </span>
        </Row>
      )}
      <Row label="Visible if">
        <Txt value={win.visibleIf} disabled={readOnly} mono placeholder="status == 'paid'" onChange={(v) => patch({ visibleIf: v })} />
      </Row>
      <Row label="Background">
        <span className="color-field">
          <ColorPicker value={win.background} theme={layout.theme} disabled={readOnly} onChange={(v) => patch({ background: v })} />
          {win.background && <button className="linkish" disabled={readOnly} onClick={() => patch({ background: undefined })}>none</button>}
        </span>
      </Row>
      <div className="prow2">
        <Row label="Border pt"><Num value={win.borderWidth} disabled={readOnly} onChange={(v) => patch({ borderWidth: v || undefined })} /></Row>
        <Row label="Padding"><Num value={win.padding} disabled={readOnly} onChange={(v) => patch({ padding: v || undefined })} /></Row>
      </div>
      {win.borderWidth ? (
        <Row label="Border color">
          <span className="color-field">
            <ColorPicker value={win.borderColor} theme={layout.theme} disabled={readOnly} onChange={(v) => patch({ borderColor: v })} />
          </span>
        </Row>
      ) : null}

      {win.type === 'TABLE' ? (
        <>
          <Row label="Rows binding"><Txt value={win.binding} disabled={readOnly} mono placeholder="items" onChange={(v) => patch({ binding: v })} /></Row>
          <div className="prow2">
            <Row label="Grow">
              <input type="checkbox" checked={!!win.grow} disabled={readOnly} title="Flow rows onto continuation pages" onChange={(e) => patch({ grow: e.target.checked || undefined })} />
            </Row>
            <Row label="Row pt"><Num value={win.rowHeight} disabled={readOnly} min={5} onChange={(v) => patch({ rowHeight: v || undefined })} /></Row>
          </div>
          <Row label="Repeat header">
            <input type="checkbox" checked={!!win.repeatHeader} disabled={readOnly} onChange={(e) => patch({ repeatHeader: e.target.checked || undefined })} />
          </Row>
          <ColumnsEditor win={win} readOnly={readOnly} dispatch={dispatch} />
        </>
      ) : (
        <div className="el-list">
          <div className="cols-head"><span>Elements</span></div>
          {(win.elements ?? []).map((el) => (
            <button key={el.id} className="el-item" onClick={() => onSelect({ kind: 'element', windowId: win.id, elementId: el.id })}>
              <span className="mono">{el.id}</span>
              <span className="muted">{el.type}{el.binding ? ` · {${el.binding}}` : ''}</span>
            </button>
          ))}
          {!readOnly && (
            <div className="el-add">
              {ELEMENT_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    const binding = t === 'LINE' || t === 'PAGE_NUMBER' ? undefined : nextBinding(layout, { type: t });
                    const el: LayoutElement = {
                      id: nextElementId(win, t),
                      type: t,
                      ...(binding ? { binding } : {}),
                      ...(t === 'TEXT' ? { fontSize: 10 } : {}),
                      ...(t === 'LINE' ? { width: Math.min(120, win.width), height: 1 } : {}),
                      ...(t === 'PAGE_NUMBER' ? { text: 'Page {{page}} of {{pages}}' } : {})
                    };
                    dispatch({ type: 'add-element', windowId: win.id, element: el });
                    onSelect({ kind: 'element', windowId: win.id, elementId: el.id });
                  }}
                >
                  + {t.toLowerCase().replace('_', ' ')}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="btn-row">
        <button
          disabled={readOnly}
          onClick={() => {
            const newId = nextWindowId(layout);
            dispatch({ type: 'duplicate-window', id: win.id, newId });
            onSelect({ kind: 'window', windowId: newId });
          }}
        >
          Duplicate
        </button>
        {onSaveBlock && (
          <button
            onClick={() => {
              const name = window.prompt('Block name:', win.name || win.type);
              if (name) onSaveBlock(name, JSON.stringify({ ...win, id: 'BLOCK', page: undefined }));
            }}
            title="Save this window as a reusable block"
          >
            Save as block
          </button>
        )}
        <button
          className="danger"
          disabled={readOnly}
          onClick={() => {
            dispatch({ type: 'remove-window', id: win.id });
            onSelect(null);
          }}
        >
          Delete window
        </button>
      </div>
    </div>
  );
}

/* ── Panel ──────────────────────────────────────────────────────────── */
export function PropertiesPanel({
  layout,
  selection,
  readOnly,
  dispatch,
  onSelect,
  onSaveBlock,
  onPickAsset
}: {
  layout: Layout;
  selection: Selection;
  readOnly: boolean;
  dispatch: Dispatch<EditorAction>;
  onSelect: (s: Selection) => void;
  onSaveBlock?: (name: string, windowJson: string) => void;
  onPickAsset?: () => void;
}) {
  const win = selection ? layout.windows.find((w) => w.id === selection.windowId) : undefined;
  const el =
    selection?.kind === 'element' && win
      ? win.elements?.find((e) => e.id === selection.elementId)
      : undefined;

  if (el && win) return <ElementForm win={win} el={el} theme={layout.theme} customFonts={(layout.fonts ?? []).map((f) => f.name)} readOnly={readOnly} dispatch={dispatch} onSelect={onSelect} onPickAsset={onPickAsset} />;
  if (win) return <WindowForm layout={layout} win={win} readOnly={readOnly} dispatch={dispatch} onSelect={onSelect} onSaveBlock={onSaveBlock} />;

  return (
    <div className="pform">
      <h4>Page</h4>
      <Row label="Format">
        <select
          value={layout.page.format}
          disabled={readOnly}
          onChange={(e) => dispatch({ type: 'set-page', page: { ...layout.page, format: e.target.value as Layout['page']['format'] } })}
        >
          <option>A4</option>
          <option>LETTER</option>
        </select>
      </Row>
      <Row label="Orientation">
        <select
          value={layout.page.orientation ?? 'portrait'}
          disabled={readOnly}
          onChange={(e) => dispatch({ type: 'set-page', page: { ...layout.page, orientation: e.target.value as 'portrait' | 'landscape' } })}
        >
          <option>portrait</option>
          <option>landscape</option>
        </select>
      </Row>
      <Row label="Translations">
        <span />
      </Row>
      <textarea
        className="mono i18n-edit"
        spellCheck={false}
        disabled={readOnly}
        placeholder={'{ "de": { "Invoice": "Rechnung" } }'}
        value={JSON.stringify(layout.i18n ?? {}, null, 2)}
        onChange={(e) => {
          try {
            const i18n = JSON.parse(e.target.value);
            dispatch({ type: 'set-page', page: layout.page });
            dispatch({ type: 'set-i18n', i18n });
          } catch {
            /* only commit valid JSON */
          }
        }}
      />
      <p className="panel-hint">
        Labels and static text matching a key here are translated when the API call passes that
        locale. Select a window on the sheet to edit its contents, or drag one in from the palette.
      </p>
    </div>
  );
}