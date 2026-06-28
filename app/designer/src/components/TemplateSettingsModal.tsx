import { useEffect, useState } from 'react';
import type { Notify } from '../App';
import * as api from '../api';
import type { DeliveryDestination, Template } from '../types';

export function TemplateSettingsModal({
  template,
  onClose,
  notify
}: {
  template: Template & { fileNamePattern?: string | null; defaultDestinations?: string | null; defaultLocale?: string | null };
  onClose: (changed: boolean) => void;
  notify: Notify;
}) {
  const [pattern, setPattern] = useState(template.fileNamePattern ?? '');
  const [locale, setLocale] = useState(template.defaultLocale ?? '');
  const [selected, setSelected] = useState<string[]>(() => {
    try { return JSON.parse(template.defaultDestinations || '[]'); } catch { return []; }
  });
  const [dests, setDests] = useState<DeliveryDestination[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.listDestinations().then(setDests).catch(() => setDests([])); }, []);

  const toggle = (name: string) =>
    setSelected((s) => (s.includes(name) ? s.filter((x) => x !== name) : [...s, name]));

  const save = async () => {
    setBusy(true);
    try {
      await api.updateTemplateSettings(template.ID, {
        fileNamePattern: pattern.trim() || null,
        defaultDestinations: selected.length ? JSON.stringify(selected) : null,
        defaultLocale: locale.trim() || null
      });
      notify('success', `Settings for "${template.name}" saved`);
      onClose(true);
    } catch (e) {
      notify('error', 'Save failed', (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={() => onClose(false)}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Template settings — {template.name}</h3>

        <div className="prow">
          <label>File name pattern</label>
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="invoice-{invoice.number}-{date}.pdf" />
        </div>
        <p className="muted">
          Placeholders: any data path like <span className="mono">{'{invoice.number}'}</span>, plus{' '}
          <span className="mono">{'{date}'}</span>, <span className="mono">{'{time}'}</span>,{' '}
          <span className="mono">{'{template}'}</span>, <span className="mono">{'{version}'}</span>. Empty = automatic name.
        </p>

        <div className="prow">
          <label>Default locale</label>
          <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            <option value="">— request decides —</option>
            <option>de-DE</option><option>en-US</option><option>fr-FR</option><option>it-IT</option><option>es-ES</option>
          </select>
        </div>

        <div className="prow"><label>Default destinations</label><span /></div>
        {dests.length === 0 && <p className="muted">No destinations configured yet — add some under "Destinations" on the start page.</p>}
        <div className="dest-picker">
          {dests.map((d) => (
            <label key={d.ID} className="dest-check">
              <input type="checkbox" checked={selected.includes(d.name)} onChange={() => toggle(d.name)} />
              <span className={`chip ${d.type === 'PRINTER' ? 'REVIEW' : 'PUBLISHED'}`}>{d.type}</span> {d.name}
            </label>
          ))}
        </div>
        <p className="muted">Applied when a generate request doesn't pass its own <span className="mono">"destinations"</span> array.</p>

        <div className="btn-row">
          <button className="primary" disabled={busy} onClick={save}>Save settings</button>
          <button onClick={() => onClose(false)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
