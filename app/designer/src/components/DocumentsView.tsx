import { useEffect, useState } from 'react';
import type { Notify } from '../App';
import * as api from '../api';
import type { Delivery, GeneratedDocument } from '../types';

export function DocumentsView({ onBack, notify }: { onBack: () => void; notify: Notify }) {
  const [docs, setDocs] = useState<GeneratedDocument[] | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);

  useEffect(() => {
    Promise.all([api.listDocuments(), api.listDeliveries()])
      .then(([d, del]) => { setDocs(d); setDeliveries(del); })
      .catch((e) => notify('error', 'Load failed', e.message));
  }, [notify]);

  const deliveriesFor = (id: string) => deliveries.filter((d) => d.document_ID === id);

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
              <a href={api.documentDownloadUrl(d.ID)} download>{d.fileName}</a>
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
                  title={`${del.type} → ${del.destination}: ${del.detail ?? ''}`}
                >
                  {del.destination}
                </span>
              ))}
            </span>
            <a className="btnlike" href={api.documentDownloadUrl(d.ID)} download>Download</a>
          </div>
        ))}
      </div>
    </div>
  );
}
