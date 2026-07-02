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
    const [entities, setEntities] = useState<{ name: string; fields: number; collections: string[] }[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const fail = (e: unknown) => setError((e as Error).message);

    const loadEntities = async () => {
        setBusy(true); setError(''); setEntities(null);
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
                <div className="tp-head">
                    <strong>⚡ Connect a data source</strong>
                    <span className="spacer" />
                    <button onClick={onClose} title="Close">×</button>
                </div>
                <p className="palette-hint">
                    Generates a sample payload from your source. Afterwards the field tree in the Data panel shows every path
                    (e.g. <span className="mono">BuyerName</span>, <span className="mono">Items[].Material</span>) —
                    click fields to bind them to texts, QR codes and tables, and use them in visibility conditions.
                </p>
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
                        {entities && (
                            <>
                                <div className="tp-head"><strong>2 · Pick the entity to design against</strong></div>
                                <div className="dsw-entities">
                                    {entities.map((en) => (
                                        <button key={en.name} disabled={busy} onClick={() => pickEntity(en.name)} title={`${en.fields} fields`}>
                                            <b>{en.name}</b>
                                            <span>{en.fields} fields{en.collections.length ? ` · tables: ${en.collections.join(', ')}` : ''}</span>
                                        </button>
                                    ))}
                                    {entities.length === 0 && <p className="muted">No entity types found in this service.</p>}
                                </div>
                            </>
                        )}
                    </>
                )}

                {kind === 'paste' && (
                    <>
                        <p className="palette-hint">Paste any JSON — a plain payload, an OData response, or a CPI message body. Envelopes (<span className="mono">d.results</span>, <span className="mono">value</span>) are unwrapped automatically.</p>
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