/** ThemePanel — edit template theme tokens and apply one-click presets. */
import { useState } from 'react';
import type { Theme } from '../theme';
import { THEME_PRESETS } from '../theme';
import { ColorPicker } from './ColorPicker';

export function ThemePanel({
  theme,
  readOnly,
  onChange,
  onClose
}: {
  theme?: Theme;
  readOnly: boolean;
  onChange: (t: Theme | undefined) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState('');
  const colors = theme?.colors ?? {};
  const entries = Object.entries(colors);

  const setColors = (next: Record<string, string>) =>
    onChange(Object.keys(next).length ? { ...theme, colors: next } : undefined);

  return (
    <div className="theme-panel" role="dialog" aria-label="Template theme">
      <div className="tp-head">
        <strong>Theme colors</strong>
        <span className="spacer" />
        <button onClick={onClose} title="Close">×</button>
      </div>
      <p className="palette-hint">
        Reference tokens anywhere a color goes by typing <span className="mono">@name</span> (e.g.{' '}
        <span className="mono">@primary</span>). Re-theming the tokens restyles every element that uses them.
      </p>
      {entries.length === 0 && <p className="muted">No tokens yet — apply a preset below or add your own.</p>}
      {entries.map(([name, value]) => (
        <div className="tp-row" key={name}>
          <span className="mono tp-name">@{name}</span>
          <ColorPicker
            value={value}
            disabled={readOnly}
            allowClear={false}
            onChange={(v) => v && setColors({ ...colors, [name]: v })}
          />
          <button
            className="icon danger"
            title="Remove token"
            disabled={readOnly}
            onClick={() => {
              const next = { ...colors };
              delete next[name];
              setColors(next);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <div className="tp-row">
        <input
          placeholder="new token name"
          value={newName}
          disabled={readOnly}
          onChange={(e) => setNewName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName && !colors[newName]) {
              setColors({ ...colors, [newName]: '#0a6ed1' });
              setNewName('');
            }
          }}
        />
        <button
          disabled={readOnly || !newName || !!colors[newName]}
          onClick={() => {
            setColors({ ...colors, [newName]: '#0a6ed1' });
            setNewName('');
          }}
        >
          Add
        </button>
      </div>
      <div className="tp-head" style={{ marginTop: 10 }}>
        <strong>Presets</strong>
        <span className="muted" style={{ fontSize: 11 }}>&nbsp;one-click re-theme</span>
      </div>
      <div className="tp-presets">
        {THEME_PRESETS.map((p) => (
          <button
            key={p.name}
            className="preset-card"
            disabled={readOnly}
            title={`Apply ${p.name}`}
            onClick={() => setColors({ ...colors, ...p.colors })}
          >
            <span className="preset-dots">
              {Object.values(p.colors).map((c, i) => (
                <i key={i} style={{ background: c }} />
              ))}
            </span>
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}