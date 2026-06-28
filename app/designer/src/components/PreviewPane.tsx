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
        const zoomCss = '<style>html{zoom:0.34;background:#9a9a9a}.page{margin:6px auto;box-shadow:0 2px 14px rgba(0,0,0,0.35)}</style>';
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
  }, [layout, sampleData, locale]);

  return (
    <div className="preview-pane">
      <div className="cols-head">
        <span>Live preview{pages ? ` · ${pages} page${pages === 1 ? '' : 's'}` : ''}</span>
        <span className={`live-dot${pending ? ' busy' : ''}`} title={pending ? 'Rendering…' : 'Up to date'} />
      </div>
      {error && <p className="issue error">{error}</p>}
      <iframe title="preview" className="preview-frame" srcDoc={html} sandbox="allow-same-origin" />
      <p className="panel-hint">Updates ~1s after each change. QR codes, barcodes, growing tables, and translations all render here exactly as in the PDF.</p>
    </div>
  );
}
