/** DataSourceWizard — connect SAP OData / CDS / API / JSON / CPI and generate a bindable sample payload. */
import { useState } from 'react';

type Kind = 'odata' | 'api' | 'paste';

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/v1/datasource', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
  return j;
}

export function DataSourceWizard({ onApply, onClose }: {
  onApply: (sampleJson: string, sourceLabel: string) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>('odata');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pasted, setPasted] = useState('');
  interface NavCol { name: string; target: string; fields: number; fieldNames: string[] }
  interface Ent { name: string; fields: number; fieldNames?: string[]; collections: NavCol[] }
  const [entities, setEntities] = useState<Ent[] | null>(null);
  const [detail, setDetail] = useState<Ent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const fail = (e: unknown) => setError((e as Error).message);

  const loadEntities = async () => {
    setBusy(true); setError(''); setEntities(null); setDetail(null);
    try {
      const j = await post({ mode: 'entities', url, username: username || undefined, password: password || undefined });
      setEntities(j.entities ?? []);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const pickEntity = async (entity: string) => {
    setBusy(true); setError('');
    try {
      const j = await post({ mode: 'sample', url, entity, username: username || undefined, password: password || undefined });
      onApply(JSON.stringify(j.sample, null, 2), `${entity} @ OData`);
    } catch (e) { fail(e); setBusy(false); }
  };

  const fetchApi = async () => {
    setBusy(true); setError('');
    try {
      const j = await post({ mode: 'fetch', url, username: username || undefined, password: password || undefined });
      onApply(JSON.stringify(j.sample, null, 2), 'API endpoint');
    } catch (e) { fail(e); setBusy(false); }
  };

  const applyPasted = () => {
    setError('');
    try {
      let data = JSON.parse(pasted);
      if (data && data.d && Array.isArray(data.d.results)) data = data.d.results[0] ?? data.d; // OData v2 / CPI envelope
      else if (data && Array.isArray(data.value)) data = data.value[0] ?? data;               // OData v4 envelope
      else if (Array.isArray(data)) data = data[0] ?? {};
      onApply(JSON.stringify(data, null, 2), 'pasted payload');
    } catch { setError('That is not valid JSON. For CPI XML payloads, convert to JSON first (Content Modifier → JSON).'); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal dsw" onClick={(e) => e.stopPropagation()}>
        <div className="tp-head dsw-head">
          <strong>⚡ Connect a data source</strong>
          <span className="info" tabIndex={0} data-tip="Generates a sample payload from your source. The field tree then shows every path (e.g. BuyerName, Items[].Material) — click fields to bind them to texts, QR codes and tables, or use them in conditions.">ⓘ</span>
          <span className="spacer" />
          <button onClick={onClose} title="Close">×</button>
        </div>
        <div className="dsw-kinds">
          {([['odata', 'SAP OData / CDS'], ['api', 'API endpoint (JSON)'], ['paste', 'Paste / CPI payload']] as [Kind, string][]) 
            .map(([k, label]) => (
              <button key={k} className={kind === k ? 'active-tool' : ''} onClick={() => { setKind(k); setEntities(null); setError(''); }}>
                {label}
              </button>
            ))}
        </div>

        {kind !== 'paste' && (
          <>
            <div className="tp-row">
              <span className="tp-name">URL</span>
              <input className="mono" style={{ flex: 1 }} value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder={kind === 'odata'
                  ? 'https://…/sap/opu/odata/sap/API_SALES_ORDER_SRV  (service root or CDS service URL)'
                  : 'https://api.example.com/orders/4711'} />
            </div>
            <div className="tp-row">
              <span className="tp-name">Login</span>
              <input style={{ flex: 1 }} placeholder="username (optional)" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
              <input style={{ flex: 1 }} type="password" placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="tp-row">
              {kind === 'odata'
                ? <button className="primary" disabled={busy || !url.trim()} onClick={loadEntities}>{busy ? 'Reading $metadata…' : '1 · Read service metadata'}</button>
                : <button className="primary" disabled={busy || !url.trim()} onClick={fetchApi}>{busy ? 'Fetching…' : 'Fetch JSON & use as sample'}</button>}
            </div>
            {entities && !detail && (
              <>
                <div className="tp-head"><strong>2 · Pick the entity to design against</strong></div>
                <div className="dsw-entities">
                  {entities.map((en) => (
                    <button key={en.name} disabled={busy} onClick={() => setDetail(en)} title={`${en.fields} fields`}>
                      <b>{en.name}</b>
                      <span>
                        {en.fields} fields
                        {en.collections.length > 0 && (
                          <> · ⛓ {en.collections.map((c) => `${c.name} → ${c.target}`).join(' · ')}</>
                        )}
                      </span>
                    </button>
                  ))}
                  {entities.length === 0 && <p className="muted">No entity types found in this service.</p>}
                </div>
              </>
            )}
            {detail && (
              <div className="dsw-detail">
                <div className="tp-head">
                  <button className="linkish" onClick={() => setDetail(null)}>← entities</button>
                  <strong>{detail.name}</strong>
                  <span className="muted" style={{ fontSize: 11 }}>{detail.fields} fields</span>
                </div>
                {detail.fieldNames && detail.fieldNames.length > 0 && (
                  <div className="dsw-fields">
                    {detail.fieldNames.map((f) => <span key={f} className="chip mono">{f}</span>)}
                    {detail.fields > detail.fieldNames.length && <span className="chip more">+{detail.fields - detail.fieldNames.length}</span>}
                  </div>
                )}
                {detail.collections.length > 0 ? (
                  <>
                    <div className="cols-head sub" style={{ marginTop: 10 }}>
                      <span>1 : n relations (bind these to TABLE windows)</span>
                      <span className="info" tabIndex={0} data-tip="Each relation becomes an array in the sample (e.g. Items[]). In the Data panel, select your TABLE window and click the array — its rows then come from these fields.">ⓘ</span>
                    </div>
                    {detail.collections.map((c) => (
                      <div className="dsw-rel" key={c.name}>
                        <div className="dsw-rel-head">
                          <span className="mono rel-path">{c.name}[]</span>
                          <span className="rel-arrow">→</span>
                          <b>{c.target}</b>
                          <span className="muted" style={{ fontSize: 10 }}>{c.fields} fields</span>
                        </div>
                        <div className="dsw-fields">
                          {c.fieldNames.map((f) => <span key={f} className="chip mono">{c.name}[].{f}</span>)}
                          {c.fields > c.fieldNames.length && <span className="chip more">+{c.fields - c.fieldNames.length}</span>}
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: 11 }}>No 1:n relations on this entity — it has only flat fields.</p>
                )}
                <div className="tp-row" style={{ marginTop: 12 }}>
                  <button className="primary" disabled={busy} onClick={() => pickEntity(detail.name)}>
                    {busy ? 'Generating sample…' : `Use ${detail.name}${detail.collections.length ? ` (with ${detail.collections.map((c) => c.name).join(', ')} rows)` : ''}`}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {kind === 'paste' && (
          <>
            <div className="cols-head sub"><span>Payload</span><span className="info" tabIndex={0} data-tip="Paste any JSON — a plain payload, an OData response, or a CPI message body. Envelopes (d.results, value) are unwrapped automatically.">ⓘ</span></div>
            <textarea className="mono dsw-paste" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder='{ "SalesOrder": "4711", "BuyerName": "…", "Items": [ { "Material": "…" } ] }' />
            <div className="tp-row">
              <button className="primary" disabled={!pasted.trim()} onClick={applyPasted}>Use as sample payload</button>
              <label className="btn-file">
                Upload .json
                <input type="file" accept=".json,application/json" style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    const r = new FileReader();
                    r.onload = () => setPasted(String(r.result ?? ''));
                    r.readAsText(f);
                  }} />
              </label>
            </div>
          </>
        )}

        {error && <p className="dsw-error">⚠ {error}</p>}
      </div>
    </div>
  );
}