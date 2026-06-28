import type { Dispatch } from 'react';
import type { EditorAction } from '../state';
import type { Layout, Selection } from '../types';

/** Window list for the current page — selection, z-order, and locking at a glance. */
export function LayersPanel({
  layout,
  currentPage,
  selection,
  readOnly,
  dispatch,
  onSelect
}: {
  layout: Layout;
  currentPage: number;
  selection: Selection;
  readOnly: boolean;
  dispatch: Dispatch<EditorAction>;
  onSelect: (s: Selection) => void;
}) {
  const visible = layout.windows.filter((w) => w.repeatOnEveryPage || (w.page || 1) === currentPage);
  return (
    <div className="layers">
      <h3>Windows on this page</h3>
      {visible.length === 0 && <p className="palette-hint">Nothing here yet — drag a window in.</p>}
      {visible.map((w) => {
        const idx = layout.windows.findIndex((x) => x.id === w.id);
        const sel = selection?.windowId === w.id;
        return (
          <div key={w.id} className={`layer-row${sel ? ' sel' : ''}`}>
            <button className="layer-name" onClick={() => onSelect({ kind: 'window', windowId: w.id })} title={w.type}>
              <span className="mono">{w.id}</span> {w.name || w.type}
              {w.repeatOnEveryPage && <span className="badge" title="Repeats on every page">∀</span>}
            </button>
            {!readOnly && (
              <span className="layer-btns">
                <button
                  className="icon"
                  title={w.locked ? 'Unlock' : 'Lock (prevents dragging)'}
                  onClick={() => dispatch({ type: 'update-window', id: w.id, patch: { locked: !w.locked || undefined } })}
                >
                  {w.locked ? '🔒' : '🔓'}
                </button>
                <button
                  className="icon"
                  title="Bring forward"
                  disabled={idx >= layout.windows.length - 1}
                  onClick={() => dispatch({ type: 'reorder-window', id: w.id, direction: 1 })}
                >
                  ▲
                </button>
                <button
                  className="icon"
                  title="Send backward"
                  disabled={idx <= 0}
                  onClick={() => dispatch({ type: 'reorder-window', id: w.id, direction: -1 })}
                >
                  ▼
                </button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
