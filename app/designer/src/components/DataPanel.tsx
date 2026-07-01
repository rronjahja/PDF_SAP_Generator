import type { Dispatch } from 'react';
import type { ClientIssue, EditorAction } from '../state';

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

function DataTree({ sampleData, bindTarget, onBind }: {
  sampleData: string;
  bindTarget: string | null;
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
        {bindTarget
          ? <>Click a field to bind it to <span className="mono">{bindTarget}</span></>
          : 'Select an element (or a table window) on the sheet, then click a field here to bind it.'}
      </div>
      {nodes.map((n) => (
        <button
          key={n.path}
          className={`dt-node ${n.kind}`}
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
  onBind?: (path: string, isArray: boolean) => void;
}) {
  const names = Array.from(new Set(['default', ...Object.keys(datasets)]));
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
        <span>Sample data (JSON)</span>
        <button className="linkish" onClick={formatJson} disabled={readOnly || !jsonOk}>
          Format
        </button>
      </div>
      <p className="panel-hint">
        Entries appear here automatically when you add bound elements. Rename a binding in
        Properties and its entry moves with it.
      </p>
      {onBind && <DataTree sampleData={sampleData} bindTarget={bindTarget ?? null} onBind={onBind} />}
      <textarea
        className={`mono${jsonOk ? '' : ' invalid'}`}
        spellCheck={false}
        value={sampleData}
        readOnly={readOnly}
        onChange={(e) => dispatch({ type: 'set-sample', sampleData: e.target.value })}
      />
      {!jsonOk && <p className="issue error">Not valid JSON yet.</p>}
      <button disabled={readOnly || !jsonOk} onClick={() => dispatch({ type: 'sync-data' })}>
        Add missing entries from layout
      </button>

      <div className="cols-head"><span>Preview locale</span></div>
      <select value={locale} onChange={(e) => onLocale(e.target.value)}>
        <option value="de-DE">de-DE (German)</option>
        <option value="en-US">en-US (English)</option>
        <option value="fr-FR">fr-FR (French)</option>
        <option value="it-IT">it-IT (Italian)</option>
        <option value="es-ES">es-ES (Spanish)</option>
      </select>

      <div className="cols-head"><span>Checks</span></div>
      {issues === null && <p className="muted">Run checks to validate the layout and bindings against this data.</p>}
      {issues?.length === 0 && <p className="issue ok">All bindings resolve. Layout is valid.</p>}
      {issues?.map((i, n) => (
        <p key={n} className={`issue ${i.level}`}>
          {i.text}
          {i.windowId && (
            <button className="linkish" onClick={() => onSelectWindow(i.windowId!)}>
              show
            </button>
          )}
        </p>
      ))}
    </div>
  );
}