import { useEffect, useState } from 'react';
import type { Notify } from '../App';
import * as api from '../api';
import type { Delivery, GeneratedDocument } from '../types';

export function DocumentsView({ onBack, notify }: { onBack: () => void; notify: Notify }) {
  const [docs, setDocs] = useState<GeneratedDocument[] | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [preview, setPreview] = useState<GeneratedDocument | null>(null);

  useEffect(() => {
    Promise.all([api.listDocuments(), api.listDeliveries()])
      .then(([d, del]) => { setDocs(d); setDeliveries(del); })
      .catch((e) => notify('error', 'Load failed', e.message));
  }, [notify]);

  // Close the preview on Escape
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const deliveriesFor = (id: string) => deliveries.filter((d) => d.document_ID === id);
  const downloadUrl = (id: string) => api.documentDownloadUrl(id);
  const previewUrl = (id: string) => `${api.documentDownloadUrl(id)}?inline=1`;

  return (
    <div className="settings-page">
      <div className="toolbar">
        <button onClick={onBack}>←</button>
        <span className="brand">Generated documents</span>
        <span className="spacer" />
        <span className="muted">{docs ? `${docs.length} most recent` : ''}</span>
      </div>
      <div className="settings-body">
        {docs === null && <p className="muted">Loading…</p>}
        {docs?.length === 0 && <p className="muted">Nothing generated yet. Call the API or use "Preview PDF" with a published version.</p>}
        {docs?.map((d) => (
          <div className="doc-row" key={d.ID}>
            <div className="doc-main">
              <button className="linklike" onClick={() => setPreview(d)} title="Preview in browser">{d.fileName}</button>
              <span className="muted">
                {new Date(d.generatedAt).toLocaleString()} · {d.generatedBy || 'anonymous'}
                {typeof d.size === 'number' ? ` · ${(d.size / 1024).toFixed(0)} KB` : ''}
              </span>
            </div>
            <span className="doc-deliveries">
              {deliveriesFor(d.ID).map((del) => (
                <span
                  key={del.ID}
                  className={`chip ${del.status === 'SUCCESS' ? 'PUBLISHED' : 'ARCHIVED'}`}
                  title={`${del.type} -> ${del.destination}: ${del.detail ?? ''}`}
                >
                  {del.destination}
                </span>
              ))}
            </span>
            <button className="btnlike" onClick={() => setPreview(d)}>Preview</button>
            <a className="btnlike" href={downloadUrl(d.ID)} download>Download</a>
          </div>
        ))}
      </div>

      {preview && (
        <div className="overlay" onClick={() => setPreview(null)}>
          <div className="dialog dialog-pdf" onClick={(e) => e.stopPropagation()}>
            <div className="pdf-head">
              <span className="pdf-title" title={preview.fileName}>{preview.fileName}</span>
              <span className="spacer" />
              <a className="btnlike" href={downloadUrl(preview.ID)} download>Download</a>
              <button className="btnlike" onClick={() => setPreview(null)}>Close</button>
            </div>
            <iframe
              className="pdf-frame"
              title={preview.fileName}
              src={previewUrl(preview.ID)}
            />
          </div>
        </div>
      )}
    </div>
  );
}