/** ColorPicker — swatches, theme tokens, recent colors, hex/RGB/HSL input, contrast check. */
import { useEffect, useRef, useState } from 'react';
import { PRESET_COLORS } from './PaintBar';
import type { Theme } from '../theme';
import { contrastRatio, hexToRgb, hslToRgb, resolveColor, rgbToHex, rgbToHsl, wcagLevel } from '../theme';

const RECENT_KEY = 'pdfb.recentColors';
function loadRecents(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}
function pushRecent(c: string) {
  if (!c || c.startsWith('@')) return;
  try {
    const r = [c, ...loadRecents().filter((x) => x !== c)].slice(0, 10);
    localStorage.setItem(RECENT_KEY, JSON.stringify(r));
  } catch { /* private mode etc. */ }
}

export function ColorPicker({
  value,
  theme,
  disabled,
  allowClear = true,
  clearLabel = 'none',
  contrastAgainst = '#ffffff',
  onChange
}: {
  value?: string;
  theme?: Theme;
  disabled?: boolean;
  allowClear?: boolean;
  clearLabel?: string;
  contrastAgainst?: string;
  onChange: (v: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState('');
  const root = useRef<HTMLSpanElement | null>(null);

  const resolved = resolveColor(value, theme);
  const rgb = resolved ? hexToRgb(resolved) : null;
  const hsl = rgb ? rgbToHsl(rgb.r, rgb.g, rgb.b) : null;
  const ratio = resolved && hexToRgb(resolved) ? contrastRatio(resolved, contrastAgainst) : null;
  const level = ratio !== null ? wcagLevel(ratio) : null;

  useEffect(() => setHex(resolved ?? ''), [resolved, open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const pick = (v: string | undefined, keepOpen = false) => {
    if (v) pushRecent(resolveColor(v, theme) ?? v);
    onChange(v);
    if (!keepOpen) setOpen(false);
  };

  const tokens = Object.entries(theme?.colors ?? {});
  const recents = loadRecents();

  return (
    <span className="cpicker" ref={root}>
      <button
        type="button"
        className="cp-current"
        disabled={disabled}
        title={value ?? 'no color'}
        onClick={() => setOpen((v) => !v)}
      >
        <i className="cp-swatch" style={{ background: resolved ?? 'transparent' }}>{value ? '' : '⌀'}</i>
        <span className="cp-value">{value ?? clearLabel}</span>
      </button>
      {open && !disabled && (
        <div className="cp-pop" role="dialog">
          {tokens.length > 0 && (
            <>
              <div className="cp-title">Theme</div>
              <div className="cp-tokens">
                {tokens.map(([name, c]) => (
                  <button key={name} type="button" className={`cp-token${value === '@' + name ? ' sel' : ''}`} onClick={() => pick('@' + name)}>
                    <i className="cp-swatch" style={{ background: c }} /> @{name}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="cp-title">Swatches</div>
          <div className="cp-grid">
            {PRESET_COLORS.map((c) => (
              <button key={c} type="button" className={`swatch${resolved === c ? ' sel' : ''}`} style={{ background: c }} title={c} onClick={() => pick(c)} />
            ))}
          </div>
          {recents.length > 0 && (
            <>
              <div className="cp-title">Recent</div>
              <div className="cp-grid">
                {recents.map((c) => (
                  <button key={'r' + c} type="button" className={`swatch${resolved === c ? ' sel' : ''}`} style={{ background: c }} title={c} onClick={() => pick(c)} />
                ))}
              </div>
            </>
          )}
          <div className="cp-row">
            <label>HEX</label>
            <input
              className="mono"
              value={hex}
              placeholder="#0a6ed1"
              onChange={(e) => {
                setHex(e.target.value);
                if (hexToRgb(e.target.value)) pick(e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value, true);
              }}
            />
            <input type="color" value={resolved && hexToRgb(resolved) ? resolved : '#0a6ed1'} onChange={(e) => pick(e.target.value, true)} title="Visual picker" />
          </div>
          <div className="cp-row">
            <label>RGB</label>
            {(['r', 'g', 'b'] as const).map((k) => (
              <input key={k} type="number" min={0} max={255} value={rgb ? rgb[k] : ''} placeholder={k.toUpperCase()}
                onChange={(e) => {
                  const base = rgb ?? { r: 0, g: 0, b: 0 };
                  pick(rgbToHex({ ...base, [k]: Number(e.target.value) }.r, { ...base, [k]: Number(e.target.value) }.g, { ...base, [k]: Number(e.target.value) }.b), true);
                }} />
            ))}
          </div>
          <div className="cp-row">
            <label>HSL</label>
            {(['h', 's', 'l'] as const).map((k) => (
              <input key={k} type="number" min={0} max={k === 'h' ? 360 : 100} value={hsl ? hsl[k] : ''} placeholder={k.toUpperCase()}
                onChange={(e) => {
                  const base = hsl ?? { h: 0, s: 0, l: 50 };
                  const next = { ...base, [k]: Number(e.target.value) };
                  const c = hslToRgb(next.h, next.s, next.l);
                  pick(rgbToHex(c.r, c.g, c.b), true);
                }} />
            ))}
          </div>
          <div className="cp-foot">
            {ratio !== null && level !== null && (
              <span className={`contrast-badge ${level}`} title={`Contrast vs ${contrastAgainst}`}>
                {ratio}:1 {level === 'fail' ? '⚠ low contrast' : level}
              </span>
            )}
            <span className="spacer" />
            {allowClear && value !== undefined && (
              <button type="button" className="linkish" onClick={() => pick(undefined)}>{clearLabel}</button>
            )}
          </div>
        </div>
      )}
    </span>
  );
}