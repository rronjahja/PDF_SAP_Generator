import { useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { Layout } from '../types';

/** Split-screen live preview: re-renders the unsaved layout as you edit. */
export function PreviewPane({
  layout,
  sampleData,
  locale
}: {
  layout: Layout;
  sampleData: string;
  locale: string;
}) {
  const [html, setHtml] = useState('');
  const [zoom, setZoom] = useState(34);
  const [fit, setFit] = useState(true);
  const frameRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!fit || !frameRef.current) return;
    const el = frameRef.current;
    const compute = () => setZoom(Math.max(15, Math.min(200, Math.floor(((el.clientWidth - 20) / 595) * 100))));
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const seq = useRef(0);

  useEffect(() => {
    setPending(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const mySeq = ++seq.current;
      try {
        let data: unknown = {};
        try {
          data = sampleData.trim() ? JSON.parse(sampleData) : {};
        } catch {
          /* render with empty data while the JSON is mid-edit */
        }
        const r = await api.renderHtml(layout, data, locale);
        if (mySeq !== seq.current) return; // stale
        // scale the A4 page down to the pane width (sandboxed iframe: CSS only)
        const zoomCss = `<style>html{zoom:${zoom / 100};background:#9a9a9a}.page{margin:6px auto;box-shadow:0 2px 14px rgba(0,0,0,0.35)}</style>`;
        setHtml(r.html.replace('</head>', zoomCss + '</head>'));
        setPages(r.pages);
        setError(null);
      } catch (e) {
        if (mySeq === seq.current) setError((e as Error).message);
      } finally {
        if (mySeq === seq.current) setPending(false);
      }
    }, 700);
    return () => clearTimeout(timer.current);
  }, [layout, sampleData, locale, zoom]);

  return (
    <div className="preview-pane">
      <div className="cols-head">
        <span>Live preview{pages ? ` · ${pages} page${pages === 1 ? '' : 's'}` : ''}</span>
        <span className="spacer" />
        <span className="zoom-ctl">
          <button title="Zoom out" onClick={() => { setFit(false); setZoom((z) => Math.max(15, z - 15)); }}>−</button>
          <button title={fit ? 'Fitted to the panel — resize it and the PDF follows' : 'Click to fit the panel width'} className={fit ? 'active-tool' : ''} onClick={() => setFit(true)}>{fit ? `fit · ${zoom}%` : `${zoom}%`}</button>
          <button title="Zoom in" onClick={() => { setFit(false); setZoom((z) => Math.min(200, z + 15)); }}>+</button>
        </span>
        <span className={`live-dot${pending ? ' busy' : ''}`} title={pending ? 'Rendering…' : 'Up to date'} />
      </div>
      {error && <p className="issue error">{error}</p>}
      <div className="preview-scroll" ref={frameRef}>
        <iframe title="preview" className="preview-frame" srcDoc={html} sandbox="allow-same-origin" />
      </div>
      <p className="panel-hint">Updates ~1s after each change. QR codes, barcodes, growing tables, and translations all render here exactly as in the PDF.</p>
    </div>
  );
}