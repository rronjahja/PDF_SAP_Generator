/**
 * Paint mode: pick a color, then click anything on the sheet to fill it —
 * windows get a background, rectangles a fill, lines and text their color,
 * and the empty page its page background. The ⌀ swatch erases.
 */
export const PRESET_COLORS = [
  '#1b1d21', '#5b6470', '#9aa3ae', '#d6dbe1', '#ffffff',
  '#0a6ed1', '#0fa3c2', '#19b5a3', '#0a7a3d', '#7fbf3f',
  '#f2c94c', '#f2994a', '#e0427a', '#c0392b', '#7a4fb3',
  '#eef3fa', '#e8f5e9', '#fff8e1', '#fdecea', '#f3e8fd'
];

export function PaintBar({
  color,
  recents,
  onColor,
  onClose
}: {
  color: string | null; // null = eraser (clear fill)
  recents: string[];
  onColor: (c: string | null) => void;
  onClose: () => void;
}) {
  return (
    <div className="paintbar">
      <span className="paint-label" title="Click a window, rectangle, line, or text on the sheet to fill it. Click empty paper to paint the page.">
        🖌 Fill
      </span>
      <button
        className={`swatch eraser${color === null ? ' sel' : ''}`}
        title="No fill (erase color)"
        onClick={() => onColor(null)}
      >
        ⌀
      </button>
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          className={`swatch${color === c ? ' sel' : ''}`}
          style={{ background: c }}
          title={c}
          onClick={() => onColor(c)}
        />
      ))}
      <label className="swatch custom" title="Custom color">
        <input type="color" value={color ?? '#0a6ed1'} onChange={(e) => onColor(e.target.value)} />
        +
      </label>
      {recents.length > 0 && <span className="vr" />}
      {recents.map((c) => (
        <button
          key={'r' + c}
          className={`swatch${color === c ? ' sel' : ''}`}
          style={{ background: c }}
          title={c}
          onClick={() => onColor(c)}
        />
      ))}
      <span className="spacer" />
      <span className="paint-current">
        {color === null ? 'erase fills' : <><i className="swatch tiny" style={{ background: color }} /> {color}</>}
      </span>
      <button onClick={onClose} title="Exit paint mode (Esc)">Done</button>
    </div>
  );
}
