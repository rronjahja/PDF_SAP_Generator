/** ThemePanel — edit template theme tokens and apply one-click presets. */
import { useState } from 'react';
import type { Theme } from '../theme';
import { THEME_PRESETS } from '../theme';
import { ColorPicker } from './ColorPicker';

export function ThemePanel({
  theme,
  fonts = [],
  readOnly,
  onChange,
  onFontsChange,
  metadata,
  output,
  onOutputChange,
  onClose
}: {
  theme?: Theme;
  fonts?: { name: string; assetId: string }[];
  readOnly: boolean;
  onChange: (t: Theme | undefined) => void;
  onFontsChange?: (f: { name: string; assetId: string }[]) => void;
  metadata?: { title?: string; author?: string; subject?: string; keywords?: string };
  output?: { pdfA?: boolean };
  onOutputChange?: (metadata: { title?: string; author?: string; subject?: string; keywords?: string }, output: { pdfA?: boolean }) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [fontName, setFontName] = useState('');
  const [fontAsset, setFontAsset] = useState('');
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
      {onOutputChange && (
        <>
          <div className="tp-head" style={{ marginTop: 10 }}>
            <strong>PDF output</strong>
          </div>
          {(['title', 'author', 'subject', 'keywords'] as const).map((k) => (
            <div className="tp-row" key={k}>
              <span className="tp-name" style={{ textTransform: 'capitalize' }}>{k}</span>
              <input style={{ flex: 1 }} value={metadata?.[k] ?? ''} disabled={readOnly}
                placeholder={k === 'title' ? 'defaults to template name' : ''}
                onChange={(e) => onOutputChange({ ...metadata, [k]: e.target.value || undefined }, output ?? {})} />
            </div>
          ))}
          <div className="tp-row">
            <span className="tp-name">PDF/A</span>
            <input type="checkbox" checked={!!output?.pdfA} disabled={readOnly}
              onChange={(e) => onOutputChange(metadata ?? {}, { pdfA: e.target.checked || undefined })} />
            <span className="muted" style={{ fontSize: 10 }}>tagged PDF/A-3b for archiving & accessibility</span>
          </div>
        </>
      )}
      {onFontsChange && (
        <>
          <div className="tp-head" style={{ marginTop: 10 }}>
            <strong>Custom fonts</strong>
          </div>
          <p className="palette-hint">
            Upload a <span className="mono">.ttf</span>/<span className="mono">.otf</span> in the Assets dialog, copy its ID here, then pick the font on any text element. The server embeds a subset into the PDF.
          </p>
          {fonts.map((f) => (
            <div className="tp-row" key={f.name}>
              <span className="mono tp-name">{f.name}</span>
              <span className="mono muted" style={{ fontSize: 10, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.assetId}</span>
              <button className="icon danger" title="Remove font" disabled={readOnly}
                onClick={() => onFontsChange(fonts.filter((x) => x.name !== f.name))}>×</button>
            </div>
          ))}
          <div className="tp-row">
            <input placeholder="font name" style={{ width: 90 }} value={fontName} disabled={readOnly}
              onChange={(e) => setFontName(e.target.value.replace(/[^a-zA-Z0-9 _-]/g, ''))} />
            <input placeholder="asset ID (from Assets dialog)" className="mono" style={{ flex: 1 }} value={fontAsset} disabled={readOnly}
              onChange={(e) => setFontAsset(e.target.value.trim())} />
            <button disabled={readOnly || !fontName.trim() || !fontAsset.trim() || fonts.some((x) => x.name === fontName.trim())}
              onClick={() => { onFontsChange([...fonts, { name: fontName.trim(), assetId: fontAsset.trim() }]); setFontName(''); setFontAsset(''); }}>
              Add
            </button>
          </div>
        </>
      )}
      <div className="tp-head" style={{ marginTop: 10 }}>
        <strong>Presets</strong>
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