import { useDraggable } from '@dnd-kit/core';
import type { Block } from '../types';
import { ELEMENT_TYPES, WINDOW_TYPES } from '../types';

function PaletteItem({ id, label, el }: { id: string; label: string; el?: boolean }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id });
  return (
    <div className="palette-item" ref={setNodeRef} {...listeners} {...attributes}>
      <span className={`glyph${el ? ' elglyph' : ''}`} aria-hidden="true" />
      {label}
    </div>
  );
}

const pretty = (s: string) =>
  s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

export function Palette({
  readOnly,
  blocks = [],
  onDeleteBlock
}: {
  readOnly: boolean;
  blocks?: Block[];
  onDeleteBlock?: (id: string) => void;
}) {
  if (readOnly) {
    return (
      <aside className="palette">
        <h3>Windows</h3>
        <p className="palette-hint">
          This version is published and locked. Create a new draft version to edit the layout.
        </p>
      </aside>
    );
  }
  return (
    <aside className="palette">
      <h3>Windows</h3>
      {WINDOW_TYPES.map((t) => (
        <PaletteItem key={t} id={`new-window:${t}`} label={pretty(t)} />
      ))}
      <h3>Elements</h3>
      {ELEMENT_TYPES.map((t) => (
        <PaletteItem key={t} id={`new-el:${t}`} label={pretty(t)} el />
      ))}
      {blocks.length > 0 && (
        <>
          <h3>Blocks</h3>
          {blocks.map((b) => (
            <div className="block-item" key={b.ID}>
              <PaletteItem id={`new-block:${b.ID}`} label={b.name} />
              {onDeleteBlock && (
                <button className="icon danger" title="Delete block" onClick={() => onDeleteBlock(b.ID)}>×</button>
              )}
            </div>
          ))}
        </>
      )}
      <p className="palette-hint">
        Drag a window onto the sheet, then drop elements into it. Save any window as a reusable
        block from its properties.
      </p>
    </aside>
  );
}
