/** RulesView — define business rules: IF <condition> THEN <action>. */
import { useEffect, useState } from 'react';

interface Rule {
    ID?: string;
    name: string;
    priority: number;
    condition: string;
    actionType: 'use-template' | 'set-variable' | 'set-asset' | 'deliver' | 'require-approval';
    configJson?: string | null;
    active: boolean;
    stopProcessing: boolean;
}

const ACTION_LABELS: Record<Rule['actionType'], string> = {
    deliver: 'Deliver to destinations (email / print / archive / …)',
    'require-approval': 'Require approval before sending',
    'use-template': 'Use a different template',
    'set-variable': 'Set a data field (e.g. footer text)',
    'set-asset': 'Swap an image (e.g. logo)'
};

const EXAMPLES = [
    ["_meta.documentType == 'INVOICE' && customer.country == 'DE'", 'deliver', '{ "destinations": ["email-standard"] }'],
    ["customer.group == 'PUBLIC_SECTOR'", 'deliver', '{ "destinations": ["archive", "print-queue"] }'],
    ['totals.gross > 10000', 'require-approval', '{ "label": "Approve dispatch" }'],
    ["_meta.language == 'de'", 'use-template', '{ "template": "invoice-de" }'],
    ["company.code == '1000'", 'set-asset', '{ "elementId": "logo", "assetId": "<asset-id>" }'],
    ["sales.org == '2000'", 'set-variable', '{ "path": "company.footerText", "value": "Footer B" }']
];

async function api(method: string, path: string, body?: unknown) {
    const res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
    return j;
}

const EMPTY: Rule = { name: '', priority: 100, condition: '', actionType: 'deliver', active: true, stopProcessing: false };

export function RulesView({ onBack, notify }: { onBack: () => void; notify: (k: 'error' | 'success' | 'info', t: string, d?: string) => void }) {
    const [rules, setRules] = useState<Rule[] | null>(null);
    const [edit, setEdit] = useState<Rule | null>(null);
    const [config, setConfig] = useState('');
    const [busy, setBusy] = useState(false);

    const load = () => api('GET', '/api/v1/rules').then((j) => setRules(j.rules)).catch((e) => { notify('error', 'Could not load rules', (e as Error).message); setRules([]); });
    useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const startEdit = (r: Rule) => { setEdit({ ...r }); setConfig(r.configJson ?? ''); };

    const save = async () => {
        if (!edit) return;
        let cfg: unknown;
        if (config.trim()) {
            try { cfg = JSON.parse(config); } catch { return notify('error', 'Action config is not valid JSON'); }
        }
        setBusy(true);
        try {
            await api('POST', '/api/v1/rules', { ...edit, config: cfg });
            notify('success', `Rule "${edit.name}" saved`);
            setEdit(null);
            load();
        } catch (e) { notify('error', 'Save failed', (e as Error).message); } finally { setBusy(false); }
    };

    const remove = async (r: Rule) => {
        if (!r.ID) return;
        try {
            await api('DELETE', `/api/v1/rules/${r.ID}`);
            notify('success', `Rule "${r.name}" deleted`);
            load();
        } catch (e) { notify('error', 'Delete failed', (e as Error).message); }
    };

    return (
        <div className="page">
            <div className="page-head">
                <button onClick={onBack}>←</button>
                <h2>Business rules</h2>
                <span className="spacer" />
                <button className="primary" onClick={() => startEdit(EMPTY)}>+ New rule</button>
            </div>
            <p className="palette-hint">
                Rules run on every generation, in priority order. Conditions use the same expression language as element
                visibility (<span className="mono">totals.gross &gt; 10000</span>, <span className="mono">customer.country == 'DE'</span>) plus{' '}
                <span className="mono">_meta.documentType</span>, <span className="mono">_meta.templateName</span>, <span className="mono">_meta.language</span>.
                Template/logo/field rules apply before rendering; delivery rules route the finished PDF; an approval rule holds
                all deliveries behind a signed hosted approval link.
            </p>
            {rules === null ? <p className="muted">Loading…</p> : (
                <table className="rules-table">
                    <thead><tr><th>Prio</th><th>Rule</th><th>If</th><th>Then</th><th>Active</th><th /></tr></thead>
                    <tbody>
                        {rules.map((r) => (
                            <tr key={r.ID} className={r.active ? '' : 'inactive'}>
                                <td>{r.priority}</td>
                                <td>{r.name}</td>
                                <td className="mono">{r.condition}</td>
                                <td>{ACTION_LABELS[r.actionType]}{r.configJson ? <div className="mono cfg">{r.configJson}</div> : null}</td>
                                <td>{r.active ? '✓' : '—'}</td>
                                <td>
                                    <button className="linkish" onClick={() => startEdit(r)}>edit</button>{' '}
                                    <button className="linkish danger" onClick={() => remove(r)}>delete</button>
                                </td>
                            </tr>
                        ))}
                        {rules.length === 0 && <tr><td colSpan={6} className="muted">No rules yet — click “+ New rule”, or start from an example below.</td></tr>}
                    </tbody>
                </table>
            )}

            <h3 style={{ marginTop: 18 }}>Examples</h3>
            <table className="rules-table examples">
                <tbody>
                    {EXAMPLES.map(([cond, act, cfg], i) => (
                        <tr key={i}>
                            <td className="mono">{cond}</td>
                            <td>{ACTION_LABELS[act as Rule['actionType']]}</td>
                            <td><button className="linkish" onClick={() => { setEdit({ ...EMPTY, condition: cond, actionType: act as Rule['actionType'] }); setConfig(cfg); }}>use</button></td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {edit && (
                <div className="modal-backdrop" onClick={() => setEdit(null)}>
                    <div className="modal dsw" onClick={(e) => e.stopPropagation()}>
                        <div className="tp-head"><strong>{edit.ID ? 'Edit rule' : 'New rule'}</strong><span className="spacer" /><button onClick={() => setEdit(null)}>×</button></div>
                        <div className="tp-row"><span className="tp-name">Name</span><input style={{ flex: 1 }} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Big amounts need approval" /></div>
                        <div className="tp-row"><span className="tp-name">Priority</span><input type="number" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: Number(e.target.value) })} style={{ width: 80 }} /><span className="muted" style={{ fontSize: 10 }}>lower runs first</span></div>
                        <div className="tp-row"><span className="tp-name">If</span><input className="mono" style={{ flex: 1 }} value={edit.condition} onChange={(e) => setEdit({ ...edit, condition: e.target.value })} placeholder="totals.gross > 10000" /></div>
                        <div className="tp-row"><span className="tp-name">Then</span>
                            <select value={edit.actionType} onChange={(e) => setEdit({ ...edit, actionType: e.target.value as Rule['actionType'] })}>
                                {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                        </div>
                        <div className="tp-row"><span className="tp-name">Config</span>
                            <textarea className="mono" style={{ flex: 1, minHeight: 60 }} value={config} onChange={(e) => setConfig(e.target.value)}
                                placeholder={edit.actionType === 'deliver' ? '{ "destinations": ["email-standard"] }'
                                    : edit.actionType === 'use-template' ? '{ "template": "invoice-de" }'
                                        : edit.actionType === 'set-asset' ? '{ "elementId": "logo", "assetId": "…" }'
                                            : edit.actionType === 'set-variable' ? '{ "path": "company.footerText", "value": "Footer B" }'
                                                : '{ "label": "Approve dispatch", "expiresInDays": 7 }'} />
                        </div>
                        <div className="tp-row">
                            <label><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> active</label>
                            <label><input type="checkbox" checked={edit.stopProcessing} onChange={(e) => setEdit({ ...edit, stopProcessing: e.target.checked })} /> stop after this rule</label>
                            <span className="spacer" />
                            <button className="primary" disabled={busy || !edit.name.trim() || !edit.condition.trim()} onClick={save}>{busy ? 'Saving…' : 'Save rule'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}