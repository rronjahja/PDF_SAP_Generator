/** theme.ts — theme tokens, fills, color math and presets (mirrors srv/lib/style.js). */
import type { GradientFill, Layout } from './types';

export type Theme = NonNullable<Layout['theme']>;

/** '@primary' → theme.colors.primary; plain colors pass through. */
export function resolveColor(value: string | undefined, theme?: Theme): string | undefined {
  if (!value) return value;
  if (value.startsWith('@')) return theme?.colors?.[value.slice(1)] ?? '#111111';
  return value;
}

/** Fill (color | gradient) → CSS background value for the canvas preview. */
export function fillToCss(fill: string | GradientFill | undefined, theme?: Theme): string | undefined {
  if (!fill) return undefined;
  if (typeof fill === 'string') return resolveColor(fill, theme);
  if (fill.type === 'linear' && Array.isArray(fill.stops) && fill.stops.length >= 2) {
    const angle = (fill.angle ?? 0) + 90; // pdf angle 0 = left→right; css 90deg = left→right
    const stops = fill.stops
      .map((s) => `${resolveColor(s.color, theme) ?? '#000'} ${Math.round((s.at ?? 0) * 100)}%`)
      .join(', ');
    return `linear-gradient(${angle}deg, ${stops})`;
  }
  return undefined;
}

/* ── color math for the picker ───────────────────────────────────────── */

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360 / 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: Math.round(f(h + 1 / 3) * 255), g: Math.round(f(h) * 255), b: Math.round(f(h - 1 / 3) * 255) };
}

/** WCAG relative-luminance contrast ratio between two hex colors. */
export function contrastRatio(hexA: string, hexB: string): number {
  const lum = (hex: string) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return 1;
    const t = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * t(rgb.r) + 0.7152 * t(rgb.g) + 0.0722 * t(rgb.b);
  };
  const a = lum(hexA) + 0.05, b = lum(hexB) + 0.05;
  return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
}

export function wcagLevel(ratio: number): 'AAA' | 'AA' | 'fail' {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  return 'fail';
}

/* ── curated presets (one-click re-theme) ────────────────────────────── */

export interface ThemePreset { name: string; colors: Record<string, string> }

export const THEME_PRESETS: ThemePreset[] = [
  { name: 'SAP Fiori',  colors: { primary: '#0a6ed1', accent: '#0fa3c2', text: '#1b1d21', muted: '#5b6470', surface: '#eef3fa' } },
  { name: 'Slate',      colors: { primary: '#334155', accent: '#0ea5e9', text: '#0f172a', muted: '#64748b', surface: '#f1f5f9' } },
  { name: 'Forest',     colors: { primary: '#0a7a3d', accent: '#7fbf3f', text: '#14261b', muted: '#5c7266', surface: '#e8f5e9' } },
  { name: 'Bordeaux',   colors: { primary: '#7f1d1d', accent: '#f2994a', text: '#231313', muted: '#7c6262', surface: '#fdecea' } },
  { name: 'Aubergine',  colors: { primary: '#7a4fb3', accent: '#e0427a', text: '#221a2c', muted: '#6f6480', surface: '#f3e8fd' } },
  { name: 'Monochrome', colors: { primary: '#1b1d21', accent: '#9aa3ae', text: '#1b1d21', muted: '#5b6470', surface: '#f4f5f7' } }
];