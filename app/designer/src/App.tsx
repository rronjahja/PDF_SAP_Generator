import { useCallback, useEffect, useState } from 'react';
import { createTemplate, deleteTemplate, duplicateTemplate, importTemplatePdf, listTemplates } from './api';
import { StatsView } from './components/StatsView';
import { RulesView } from './components/RulesView';
import type { Template } from './types';
import { Designer } from './components/Designer';
import { DestinationsView } from './components/DestinationsView';
import { DocumentsView } from './components/DocumentsView';
import { TemplateSettingsModal } from './components/TemplateSettingsModal';

/* ── Toasts ─────────────────────────────────────────────────────────── */
export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
  detail?: string;
}
let toastSeq = 0;

export type Notify = (kind: Toast['kind'], text: string, detail?: string) => void;

function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
          {t.detail && <div className="toast-detail">{t.detail}</div>}
        </div>
      ))}
    </div>
  );
}

/* ── Template list ──────────────────────────────────────────────────── */
function TemplateList({
  onOpen,
  notify
}: {
  onOpen: (id: string) => void;
  notify: Notify;
}) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [name, setName] = useState('');
  const [docType, setDocType] = useState('INVOICE');
  const [busy, setBusy] = useState(false);
  const [settingsFor, setSettingsFor] = useState<Template | null>(null);

  const reload = useCallback(() => {
    listTemplates()
      .then(setTemplates)
      .catch((e) => notify('error', 'Could not load templates', e.message));
  }, [notify]);

  useEffect(reload, [reload]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const t = await createTemplate(name.trim(), docType);
      notify('success', `Template "${t.name}" created`);
      onOpen(t.ID);
    } catch (e) {
      notify('error', 'Create failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (id: string) => {
    try {
      const copy = await duplicateTemplate(id);
      notify('success', `Duplicated as "${copy.name}"`);
      reload();
    } catch (e) {
      notify('error', 'Duplicate failed', (e as Error).message);
    }
  };

  const remove = async (t: Template) => {
    if (!window.confirm(`Delete template "${t.name}" and all its versions?`)) return;
    try {
      await deleteTemplate(t.ID);
      notify('success', `Template "${t.name}" deleted`);
      reload();
    } catch (e) {
      notify('error', 'Delete failed', (e as Error).message);
    }
  };

  return (
    <div className="list-page">
      <div className="list-head">
        <div style={{ flex: 1 }}>
          <h1>Templates</h1>
          <p className="sub">Design once — bind SAP data, apply business rules, generate &amp; deliver signed, interactive PDFs.</p>
        </div>
      </div>

      <div className="new-form">
        <input
          placeholder="New template name, e.g. invoice-standard"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          style={{ flex: 1 }}
        />
        <select value={docType} onChange={(e) => setDocType(e.target.value)}>
          {['INVOICE', 'PURCHASE_ORDER', 'DELIVERY_NOTE', 'QUOTATION', 'REPORT', 'CERTIFICATE'].map(
            (t) => (
              <option key={t}>{t}</option>
            )
          )}
        </select>
        <button className="primary" onClick={create} disabled={busy || !name.trim()}>
          Create template
        </button>
        <label className={`btn-file${busy ? ' disabled' : ''}`} title="Upload an example PDF — the template is extracted automatically (logo, shapes, colors, text) and opens as a draft for review.">
          ⇪ Import PDF
          <input
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            disabled={busy}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setBusy(true);
              try {
                const tName = (name.trim() || f.name.replace(/\.pdf$/i, '')).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
                const r = await importTemplatePdf(f, tName);
                const s = r.stats ?? {};
                notify('success', `Imported "${r.name}"`, `${s.textRuns ?? 0} texts, ${s.rects ?? 0} shapes, ${s.lines ?? 0} lines, ${s.images ?? 0} images auto-detected — review the draft.`);
                onOpen(r.templateId);
              } catch (err) {
                notify('error', 'PDF import failed', (err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      </div>

      {templates === null && <p className="muted">Loading…</p>}
      {templates && templates.length === 0 && (
        <div className="empty">No templates yet. Create your first one above.</div>
      )}
      {templates?.map((t) => {
        const versions = t.versions ?? [];
        const published = versions.find((v) => v.status === 'PUBLISHED');
        return (
          <div className="tpl-card" key={t.ID}>
            <div className="tpl-thumb" aria-hidden="true" />
            <div className="tpl-main">
              <div className="tpl-name">{t.name}</div>
              <div className="tpl-meta">
                {t.documentType ?? '—'} · {versions.length} version{versions.length === 1 ? '' : 's'}
                {published ? ` · v${published.version} published` : ' · nothing published yet'}
              </div>
            </div>
            <span className={`chip ${t.status}`}>{t.status}</span>
            <div className="tpl-actions">
              <button className="primary" onClick={() => onOpen(t.ID)}>
                Open designer
              </button>
              <button onClick={() => setSettingsFor(t)} title="File name pattern, delivery, locale">⚙ Settings</button>
              <button onClick={() => duplicate(t.ID)}>Duplicate</button>
              <button className="danger" onClick={() => remove(t)}>
                Delete
              </button>
            </div>
          </div>
        );
      })}
      {settingsFor && (
        <TemplateSettingsModal
          template={settingsFor}
          notify={notify}
          onClose={(changed) => {
            setSettingsFor(null);
            if (changed) reload();
          }}
        />
      )}
    </div>
  );
}

/* ── App shell ──────────────────────────────────────────────────────── */
export default function App() {
  const [view, setView] = useState<
    { page: 'list' } | { page: 'designer'; id: string } | { page: 'destinations' } | { page: 'documents' } | { page: 'stats' } | { page: 'rules' }
  >({ page: 'list' });
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify: Notify = useCallback((kind, text, detail) => {
    const id = ++toastSeq;
    setToasts((ts) => [...ts, { id, kind, text, detail }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 5200);
  }, []);

  return (
    <div className="shell">
      {view.page === 'list' ? (
        <>
          <div className="toolbar">
            <span className="brand">
              <span className="brand-mark">▤</span> Formalize <span className="pt">PDF document studio</span>
            </span>
            <span className="spacer" />
            <button onClick={() => setView({ page: 'documents' })}>Documents</button>
            <button onClick={() => setView({ page: 'stats' })}>Stats</button>
            <button onClick={() => setView({ page: 'rules' })}>Rules</button>
            <button onClick={() => setView({ page: 'destinations' })}>Destinations</button>
          </div>
          <TemplateList onOpen={(id) => setView({ page: 'designer', id })} notify={notify} />
        </>
      ) : view.page === 'rules' ? (
        <RulesView onBack={() => setView({ page: 'list' })} notify={notify} />
      ) : view.page === 'stats' ? (
        <StatsView onBack={() => setView({ page: 'list' })} notify={notify} />
      ) : view.page === 'destinations' ? (
        <DestinationsView onBack={() => setView({ page: 'list' })} notify={notify} />
      ) : view.page === 'documents' ? (
        <DocumentsView onBack={() => setView({ page: 'list' })} notify={notify} />
      ) : (
        <Designer
          templateId={view.id}
          onBack={() => setView({ page: 'list' })}
          notify={notify}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}