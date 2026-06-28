import { useEffect, useState } from 'react';
import type { Notify } from '../App';
import * as api from '../api';
import type { DeliveryDestination } from '../types';

const TYPES = ['LOCAL_DIR', 'FTP', 'SFTP', 'PRINTER', 'WEBHOOK'] as const;
const FIELDS: Record<string, { key: string; label: string; placeholder?: string; secret?: boolean }[]> = {
  LOCAL_DIR: [{ key: 'directory', label: 'Directory', placeholder: '/data/invoices' }],
  FTP: [
    { key: 'host', label: 'Host', placeholder: 'ftp.example.com' },
    { key: 'port', label: 'Port', placeholder: '21' },
    { key: 'user', label: 'User' },
    { key: 'password', label: 'Password', secret: true },
    { key: 'directory', label: 'Remote directory', placeholder: '/inbox' }
  ],
  SFTP: [
    { key: 'host', label: 'Host', placeholder: 'sftp.example.com' },
    { key: 'port', label: 'Port', placeholder: '22' },
    { key: 'user', label: 'User' },
    { key: 'password', label: 'Password', secret: true },
    { key: 'directory', label: 'Remote directory', placeholder: 'upload' }
  ],
  PRINTER: [
    { key: 'printer', label: 'Printer (CUPS queue)', placeholder: 'OfficeLaser' },
    { key: 'server', label: 'CUPS server (optional)', placeholder: 'print-host:631' },
    { key: 'options', label: 'lp options (optional)', placeholder: '-o sides=two-sided-long-edge' }
  ],
  WEBHOOK: [{ key: 'url', label: 'URL', placeholder: 'https://hooks.example.com/pdf' }]
};

const TYPE_HINT: Record<string, string> = {
  LOCAL_DIR: 'Writes the PDF into a folder on the server that runs this app.',
  FTP: 'Uploads via FTP. Use "secure": true in advanced JSON for FTPS.',
  SFTP: 'Uploads via SFTP (SSH). A privateKey can be set in advanced JSON instead of a password.',
  PRINTER: 'Prints via CUPS (the lp command). Works on Linux/macOS hosts or against a remote CUPS server.',
  WEBHOOK: 'POSTs JSON {fileName, contentBase64, …} to your endpoint.'
};

function DestForm({
  initial,
  onDone,
  notify
}: {
  initial: DeliveryDestination | null;
  onDone: (changed: boolean) => void;
  notify: Notify;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<string>(initial?.type ?? 'LOCAL_DIR');
  const [cfg, setCfg] = useState<Record<string, string>>(() => {
    try {
      return initial ? JSON.parse(initial.configJson || '{}') : {};
    } catch {
      return {};
    }
  });
  const [advanced, setAdvanced] = useState(false);
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) return notify('error', 'A destination needs a name');
    let configJson: string;
    if (advanced) {
      try {
        JSON.parse(raw);
        configJson = raw;
      } catch {
        return notify('error', 'Advanced config is not valid JSON');
      }
    } else {
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cfg)) {
        if (v === '' || v === undefined) continue;
        clean[k] = k === 'port' ? Number(v) : v;
      }
      configJson = JSON.stringify(clean);
    }
    setBusy(true);
    try {
      if (initial) await api.updateDestination(initial.ID, { name: name.trim(), type: type as DeliveryDestination['type'], configJson });
      else await api.createDestination({ name: name.trim(), type: type as DeliveryDestination['type'], configJson });
      notify('success', `Destination "${name.trim()}" saved`);
      onDone(true);
    } catch (e) {
      notify('error', 'Save failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dest-form">
      <h3>{initial ? `Edit "${initial.name}"` : 'New destination'}</h3>
      <div className="prow"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="archive" /></div>
      <div className="prow"><label>Type</label>
        <select value={type} onChange={(e) => { setType(e.target.value); setCfg({}); }}>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
      </div>
      <p className="muted">{TYPE_HINT[type]}</p>
      {!advanced ? (
        FIELDS[type].map((f) => (
          <div className="prow" key={f.key}>
            <label>{f.label}</label>
            <input
              type={f.secret ? 'password' : 'text'}
              value={cfg[f.key] ?? ''}
              placeholder={f.placeholder}
              onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.value }))}
            />
          </div>
        ))
      ) : (
        <textarea className="mono" rows={6} value={raw} onChange={(e) => setRaw(e.target.value)} />
      )}
      <button className="linkish" onClick={() => { setAdvanced(!advanced); if (!advanced) setRaw(JSON.stringify(cfg, null, 2)); }}>
        {advanced ? 'simple form' : 'advanced JSON'}
      </button>
      <div className="btn-row">
        <button className="primary" disabled={busy} onClick={save}>{initial ? 'Save changes' : 'Create destination'}</button>
        <button onClick={() => onDone(false)}>Cancel</button>
      </div>
    </div>
  );
}

export function DestinationsView({ onBack, notify }: { onBack: () => void; notify: Notify }) {
  const [items, setItems] = useState<DeliveryDestination[] | null>(null);
  const [editing, setEditing] = useState<DeliveryDestination | null | 'new'>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const reload = () => api.listDestinations().then(setItems).catch((e) => notify('error', 'Load failed', e.message));
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const test = async (d: DeliveryDestination) => {
    setTesting(d.ID);
    try {
      const r = await api.testDestinationById(d.ID);
      notify(r.status === 'SUCCESS' ? 'success' : 'error', `Test ${r.status.toLowerCase()}: ${d.name}`, r.detail);
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="settings-page">
      <div className="toolbar">
        <button onClick={onBack}>←</button>
        <span className="brand">Delivery destinations</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setEditing('new')}>New destination</button>
      </div>
      <div className="settings-body">
        <p className="muted">
          Generated PDFs can be delivered automatically — to a folder, an FTP/SFTP server, a printer, or a
          webhook. Reference destinations by name in the API call (<span className="mono">"destinations": ["archive"]</span>)
          or set defaults per template (⚙ on the template card). Connection credentials are stored in the
          application database; for BTP production use the Credential Store and reference it here.
        </p>
        {items === null && <p className="muted">Loading…</p>}
        {items?.length === 0 && editing === null && <p className="muted">No destinations yet — create the first one.</p>}
        {items?.map((d) => (
          <div className="dest-row" key={d.ID}>
            <span className={`chip ${d.type === 'PRINTER' ? 'REVIEW' : 'PUBLISHED'}`}>{d.type}</span>
            <strong>{d.name}</strong>
            <span className="mono dest-cfg">{d.configJson}</span>
            <span className="spacer" />
            <button disabled={testing === d.ID} onClick={() => test(d)}>{testing === d.ID ? 'Testing…' : 'Test'}</button>
            <button onClick={() => setEditing(d)}>Edit</button>
            <button className="danger" onClick={async () => { await api.deleteDestination(d.ID); reload(); }}>Delete</button>
          </div>
        ))}
        {editing !== null && (
          <DestForm
            initial={editing === 'new' ? null : editing}
            notify={notify}
            onDone={(changed) => { setEditing(null); if (changed) reload(); }}
          />
        )}
      </div>
    </div>
  );
}
