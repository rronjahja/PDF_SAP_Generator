import type { Dispatch } from 'react';
import { useState } from 'react';
import type { ClientIssue, EditorAction } from '../state';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DataSourceWizard } from './DataSourceWizard';

/** Small ⓘ that shows help on hover — keeps the panel clean. */
function Info({ tip }: { tip: string }) {
  return <span className="info" data-tip={tip} tabIndex={0}>ⓘ</span>;
}

/** "Did you mean …?" — closest existing path for a missing binding. */
function suggestFor(missingPath: string, sampleData: string): string | null {
  let data: unknown;
  try { data = JSON.parse(sampleData); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const paths: string[] = [];
  const walk = (v: unknown, p: string, d: number) => {
    if (d > 6 || paths.length > 300) return;
    if (Array.isArray(v)) { if (v.length && typeof v[0] === 'object' && v[0] !== null) walk(v[0], p, d + 1); }
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, p ? `${p}.${k}` : k, d + 1);
    else if (p) paths.push(p);
  };
  walk(data, '', 0);
  const dist = (a: string, b: string) => {
    a = a.toLowerCase(); b = b.toLowerCase();
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) m[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return m[a.length][b.length];
  };
  const leaf = missingPath.split('.').pop() ?? missingPath;
  let best: string | null = null;
  let bestD = 4; // only suggest close matches
  for (const p of paths) {
    const d = Math.min(dist(p, missingPath), dist(p.split('.').pop() ?? p, leaf));
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/* ── Bindable data tree: click a field to bind it to the selection ──── */
function flattenData(value: unknown, path = '', depth = 0, out: { path: string; kind: 'value' | 'array' | 'object'; preview: string; depth: number }[] = []) {
  if (out.length > 200 || depth > 6) return out;
  if (Array.isArray(value)) {
    out.push({ path, kind: 'array', preview: `[${value.length} rows]`, depth });
    if (value.length && typeof value[0] === 'object' && value[0] !== null) flattenData(value[0], path, depth + 1, out);
  } else if (value !== null && typeof value === 'object') {
    if (path) out.push({ path, kind: 'object', preview: '', depth });
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flattenData(v, path ? `${path}.${k}` : k, path ? depth + 1 : 0, out);
    }
  } else {
    out.push({ path, kind: 'value', preview: String(value ?? ''), depth });
  }
  return out;
}

function ConnectSourceButton({ readOnly, dispatch }: { readOnly: boolean; dispatch: Dispatch<EditorAction> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="linkish" disabled={readOnly} title="Connect SAP OData, CDS, an API, or paste a CPI/JSON payload — generates a bindable sample" onClick={() => setOpen(true)}>
        ⚡ Connect source
      </button>
      {open && createPortal(
        <DataSourceWizard
          onClose={() => setOpen(false)}
          onApply={(json) => {
            dispatch({ type: 'set-sample', sampleData: json });
            setOpen(false);
          }}
        />,
        document.body
      )}
    </>
  );
}

function DataTree({ sampleData, bindTarget, boundArray, onBind }: {
  sampleData: string;
  bindTarget: string | null;
  boundArray?: string | null;
  onBind: (path: string, isArray: boolean) => void;
}) {
  let data: unknown = null;
  try { data = sampleData.trim() ? JSON.parse(sampleData) : null; } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const nodes = flattenData(data);
  if (!nodes.length) return null;
  return (
    <div className="data-tree">
      <div className="dt-hint">
        {boundArray
          ? <>Table rows come from <span className="mono">{boundArray}</span> — click a field inside it to <b>map a column</b>.</>
          : bindTarget
            ? <>Click a field to bind it to <span className="mono">{bindTarget}</span></>
            : 'Select an element (or a table window) on the sheet, then click a field here to bind it.'}
      </div>
      {nodes.map((n) => (
        <button
          key={n.path}
          className={`dt-node ${n.kind}${boundArray && (n.path === boundArray || n.path.startsWith(boundArray + '.')) ? ' in-bound' : ''}`}
          style={{ paddingLeft: 8 + n.depth * 12 }}
          disabled={n.kind === 'object'}
          title={n.kind === 'array' ? `Bind table rows to ${n.path}` : n.kind === 'value' ? `Bind to ${n.path}` : undefined}
          onClick={() => n.kind !== 'object' && onBind(n.path, n.kind === 'array')}
        >
          <span className="mono dt-path">{n.path.split('.').pop()}</span>
          {n.kind === 'array' && <span className="dt-badge">table</span>}
          {n.preview && <span className="dt-preview">{n.preview.slice(0, 28)}</span>}
        </button>
      ))}
    </div>
  );
}

export function DataPanel({
  sampleData,
  readOnly,
  issues,
  dispatch,
  datasets,
  activeDataset,
  locale,
  onLocale,
  onDataset,
  onSaveDataset,
  onDeleteDataset,
  onSelectWindow,
  bindTarget,
  boundArray,
  onBind
}: {
  sampleData: string;
  readOnly: boolean;
  issues: ClientIssue[] | null;
  dispatch: Dispatch<EditorAction>;
  datasets: Record<string, string>;
  activeDataset: string;
  locale: string;
  onLocale: (l: string) => void;
  onDataset: (name: string) => void;
  onSaveDataset: (name: string) => void;
  onDeleteDataset: (name: string) => void;
  onSelectWindow: (windowId: string) => void;
  bindTarget?: string | null;
  boundArray?: string | null;
  onBind?: (path: string, isArray: boolean) => void;
}) {
  const names = Array.from(new Set(['default', ...Object.keys(datasets)]));
  // vertical drag-resize for the field tree and the JSON editor (independent heights)
  const [treeH, setTreeH] = useState(190);
  const [jsonH, setJsonH] = useState(150);
  const vDrag = useRef<{ key: 'tree' | 'json'; y: number; h: number } | null>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = vDrag.current;
      if (!d) return;
      const h = Math.max(70, Math.min(window.innerHeight * 0.7, d.h + (e.clientY - d.y)));
      if (d.key === 'tree') setTreeH(h); else setJsonH(h);
    };
    const up = () => { vDrag.current = null; document.body.style.cursor = ''; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);
  const startVDrag = (key: 'tree' | 'json', h: number) => (e: React.PointerEvent) => {
    vDrag.current = { key, y: e.clientY, h };
    document.body.style.cursor = 'row-resize';
    e.preventDefault();
  };
  let jsonOk = true;
  try {
    if (sampleData.trim()) JSON.parse(sampleData);
  } catch {
    jsonOk = false;
  }

  const formatJson = () => {
    try {
      dispatch({ type: 'set-sample', sampleData: JSON.stringify(JSON.parse(sampleData), null, 2) });
    } catch {
      /* leave as typed */
    }
  };

  return (
    <div className="data-panel">
      <div className="cols-head">
        <span>Test dataset</span>
        <Info tip="Keep several payload variants (happy path, edge cases, empty) and switch between them while designing." />
        <span />
      </div>
      <div className="dataset-bar">
        <select value={activeDataset} onChange={(e) => onDataset(e.target.value)}>
          {names.map((n) => <option key={n}>{n}</option>)}
        </select>
        <button className="linkish" disabled={readOnly} onClick={() => {
          const name = window.prompt('Save current data as dataset:', activeDataset === 'default' ? 'edge-case' : activeDataset);
          if (name) onSaveDataset(name);
        }}>save as…</button>
        {activeDataset !== 'default' && (
          <button className="linkish" disabled={readOnly} onClick={() => onDeleteDataset(activeDataset)}>delete</button>
        )}
      </div>
      <div className="cols-head">
        <span>Fields &amp; sample data</span>
        <Info tip="Entries appear automatically when you add bound elements; rename a binding and its entry moves with it. Or connect a real source to generate the payload." />
        <span className="spacer" />
        <ConnectSourceButton readOnly={readOnly} dispatch={dispatch} />
      </div>
      {onBind && (
        <>
          <div style={{ height: treeH, minHeight: 70 }} className="tree-host">
            <DataTree sampleData={sampleData} bindTarget={bindTarget ?? null} boundArray={boundArray ?? null} onBind={onBind} />
          </div>
          <div className="v-resizer" title="Drag to resize the field tree" onPointerDown={startVDrag('tree', treeH)} />
        </>
      )}
      <div className="cols-head sub">
        <span>Raw JSON</span>
        <Info tip="The payload your template renders with. Drag the grip below the box to make it taller." />
        <span className="spacer" />
        <button className="linkish" onClick={formatJson} disabled={readOnly || !jsonOk}>Format</button>
        <button className="linkish" disabled={readOnly || !jsonOk} title="Adds an entry for every bound element that has no value yet" onClick={() => dispatch({ type: 'sync-data' })}>+ missing entries</button>
      </div>
      <textarea
        className={`mono json-edit${jsonOk ? '' : ' invalid'}`}
        style={{ height: jsonH }}
        spellCheck={false}
        value={sampleData}
        readOnly={readOnly}
        onChange={(e) => dispatch({ type: 'set-sample', sampleData: e.target.value })}
      />
      <div className="v-resizer" title="Drag to resize the JSON editor" onPointerDown={startVDrag('json', jsonH)} />
      {!jsonOk && <p className="issue error">Not valid JSON yet.</p>}

      <div className="cols-head"><span>Preview locale</span><Info tip="Formats dates, numbers and currencies in the live preview and picks the matching template translations." /></div>
      <select value={locale} onChange={(e) => onLocale(e.target.value)}>
        <option value="de-DE">de-DE (German)</option>
        <option value="en-US">en-US (English)</option>
        <option value="fr-FR">fr-FR (French)</option>
        <option value="it-IT">it-IT (Italian)</option>
        <option value="es-ES">es-ES (Spanish)</option>
      </select>

      <div className="cols-head"><span>Checks</span><Info tip="▶ Preview & check validates the layout and every binding against this data. Warnings suggest the closest matching field." /></div>
      {issues === null && <p className="muted">No checks run yet — hit ▶ Preview &amp; check in the toolbar.</p>}
      {issues?.length === 0 && <p className="issue ok">All bindings resolve. Layout is valid.</p>}
      {issues?.map((i, n) => {
        const missing = /['"]([A-Za-z0-9_.[\]]+)['"]/.exec(i.text);
        const hint = missing ? suggestFor(missing[1].replace(/\[\]/g, ''), sampleData) : null;
        return (
          <p key={n} className={`issue ${i.level}`}>
            {i.text}
            {hint && hint !== missing?.[1] && <em className="issue-hint"> Did you mean <span className="mono">{hint}</span>?</em>}
            {i.windowId && (
              <button className="linkish" onClick={() => onSelectWindow(i.windowId!)}>
                show
              </button>
            )}
          </p>
        );
      })}
    </div>
  );
}