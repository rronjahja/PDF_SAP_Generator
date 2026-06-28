import { useEffect, useState } from 'react';
import * as api from '../api';
import type { Template, TemplateVersion, VersionEvent } from '../types';

export function HistoryModal({ versionId, onClose }: { versionId: string; onClose: () => void }) {
  const [events, setEvents] = useState<VersionEvent[] | null>(null);
  useEffect(() => { api.listEvents(versionId).then(setEvents).catch(() => setEvents([])); }, [versionId]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Version history</h3>
        {events === null && <p className="muted">Loading…</p>}
        {events?.length === 0 && <p className="muted">No lifecycle events recorded for this version yet.</p>}
        {events?.map((e) => (
          <div key={e.ID} className="event-row">
            <span className={`chip ${e.action === 'PUBLISHED' || e.action === 'APPROVED' ? 'PUBLISHED' : e.action === 'REJECTED' ? 'ARCHIVED' : 'DRAFT'}`}>{e.action}</span>
            <span className="mono">{new Date(e.createdAt).toLocaleString()}</span>
            <span className="muted">{e.createdBy}</span>
            {e.comment && <span className="event-comment">“{e.comment}”</span>}
          </div>
        ))}
        <button className="dialog-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

/** Side-by-side visual comparison of any two versions. */
export function DiffModal({ template, onClose }: { template: Template; onClose: () => void }) {
  const versions = template.versions ?? [];
  const [leftId, setLeftId] = useState(versions[1]?.ID ?? versions[0]?.ID ?? '');
  const [rightId, setRightId] = useState(versions[0]?.ID ?? '');
  const [html, setHtml] = useState<{ left: string; right: string }>({ left: '', right: '' });

  useEffect(() => {
    const render = async (v?: TemplateVersion) => {
      if (!v?.layoutJson) return '<p style="font-family:sans-serif;color:#888;padding:20px">No layout</p>';
      try {
        const r = await api.renderHtml(JSON.parse(v.layoutJson), JSON.parse(v.sampleDataJson || '{}'));
        return r.html;
      } catch (e) {
        return `<p style="font-family:sans-serif;color:#b00;padding:20px">${(e as Error).message}</p>`;
      }
    };
    void (async () => {
      const [l, r] = await Promise.all([
        render(versions.find((v) => v.ID === leftId)),
        render(versions.find((v) => v.ID === rightId))
      ]);
      setHtml({ left: l, right: r });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftId, rightId]);

  const sel = (value: string, set: (v: string) => void) => (
    <select value={value} onChange={(e) => set(e.target.value)}>
      {versions.map((v) => (
        <option key={v.ID} value={v.ID}>v{v.version} · {v.status}</option>
      ))}
    </select>
  );

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog diff-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Compare versions</h3>
        <div className="diff-cols">
          <div>
            {sel(leftId, setLeftId)}
            <iframe title="left" srcDoc={html.left} sandbox="allow-same-origin" />
          </div>
          <div>
            {sel(rightId, setRightId)}
            <iframe title="right" srcDoc={html.right} sandbox="allow-same-origin" />
          </div>
        </div>
        <button className="dialog-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
