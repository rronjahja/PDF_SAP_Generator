import type { Dispatch } from 'react';
import type { ClientIssue, EditorAction } from '../state';

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
  onSelectWindow
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
