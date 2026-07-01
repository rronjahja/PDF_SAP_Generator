/** StatsView — usage & monitoring dashboard fed by GenerationLogs. */
import { useEffect, useState } from 'react';

interface LogRow { ID: string; status: string; durationMs?: number | null; createdAt?: string; errorCode?: string | null }

async function fetchLogs(): Promise<LogRow[]> {
    const res = await fetch(
        `/odata/v4/log/GenerationLogs?$select=ID,status,durationMs,createdAt,errorCode&$orderby=createdAt desc&$top=500`,
        { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()).value ?? [];
}

export function StatsView({ onBack, notify }: { onBack: () => void; notify: (k: 'error' | 'success' | 'info', t: string, d?: string) => void }) {
    const [rows, setRows] = useState<LogRow[] | null>(null);

    useEffect(() => {
        fetchLogs().then(setRows).catch((e) => { notify('error', 'Could not load stats', (e as Error).message); setRows([]); });
    }, [notify]);

    if (rows === null) return <div className="page"><button onClick={onBack}>←</button><p className="muted">Loading…</p></div>;

    const total = rows.length;
    const ok = rows.filter((r) => r.status === 'SUCCESS').length;
    const failed = total - ok;
    const durations = rows.map((r) => r.durationMs ?? 0).filter((d) => d > 0).sort((a, b) => a - b);
    const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const p95 = durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))] : 0;

    const days: { label: string; ok: number; failed: number }[] = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const dayRows = rows.filter((r) => (r.createdAt ?? '').startsWith(key));
        days.push({ label: key.slice(5), ok: dayRows.filter((r) => r.status === 'SUCCESS').length, failed: dayRows.filter((r) => r.status !== 'SUCCESS').length });
    }
    const max = Math.max(1, ...days.map((d) => d.ok + d.failed));

    const errorCounts = new Map<string, number>();
    rows.filter((r) => r.status !== 'SUCCESS').forEach((r) => {
        const k = r.errorCode || 'UNKNOWN';
        errorCounts.set(k, (errorCounts.get(k) ?? 0) + 1);
    });
    const topErrors = [...errorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    return (
        <div className="page">
            <div className="page-head">
                <button onClick={onBack}>←</button>
                <h2>Usage &amp; monitoring</h2>
                <span className="muted" style={{ fontSize: 11 }}>last {total} generations</span>
            </div>
            <div className="stat-cards">
                <div className="stat-card"><span className="stat-num">{total}</span><span className="stat-label">generations</span></div>
                <div className="stat-card"><span className="stat-num" style={{ color: '#0a7a3d' }}>{total ? Math.round((ok / total) * 100) : 100}%</span><span className="stat-label">success rate</span></div>
                <div className="stat-card"><span className="stat-num" style={{ color: failed ? '#c0392b' : undefined }}>{failed}</span><span className="stat-label">failures</span></div>
                <div className="stat-card"><span className="stat-num">{avg} ms</span><span className="stat-label">avg render</span></div>
                <div className="stat-card"><span className="stat-num">{p95} ms</span><span className="stat-label">p95 render</span></div>
            </div>
            <h3 style={{ marginTop: 18 }}>Last 7 days</h3>
            <div className="stat-chart">
                {days.map((d) => (
                    <div className="stat-col" key={d.label} title={`${d.label}: ${d.ok} ok, ${d.failed} failed`}>
                        <div className="stat-bars">
                            {d.failed > 0 && <div className="stat-bar bad" style={{ height: `${(d.failed / max) * 100}%` }} />}
                            <div className="stat-bar" style={{ height: `${(d.ok / max) * 100}%` }} />
                        </div>
                        <span className="stat-x">{d.label}</span>
                    </div>
                ))}
            </div>
            {topErrors.length > 0 && (
                <>
                    <h3 style={{ marginTop: 18 }}>Top errors</h3>
                    <table className="stat-errors">
                        <tbody>
                            {topErrors.map(([code, n]) => (
                                <tr key={code}><td className="mono">{code}</td><td>{n}×</td></tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}
            {total === 0 && <div className="empty">No generations logged yet — generate a PDF and check back.</div>}
        </div>
    );
}