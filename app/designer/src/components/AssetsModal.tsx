import { useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { AssetMeta } from '../types';

/** Asset library: upload logos/images once, reference them anywhere by ID. */
export function AssetsModal({
  onClose,
  onPick
}: {
  onClose: () => void;
  onPick?: (asset: AssetMeta) => void; // present = picker mode
}) {
  const [assets, setAssets] = useState<AssetMeta[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement | null>(null);

  const refresh = () => api.listAssets().then(setAssets).catch((e) => setErr(e.message));
  useEffect(() => { void refresh(); }, []);

  const upload = async (f: File) => {
    setBusy(true);
    setErr(null);
    try {
      const b64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = () => rej(new Error('read failed'));
        r.readAsDataURL(f);
      });
      await api.uploadAsset(f.name, f.type || 'application/octet-stream', b64);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{onPick ? 'Choose an image' : 'Asset library'}</h3>
        <p className="muted">Upload logos and images once and reuse them across all templates. Swapping an asset updates every document that references it.</p>
        <button disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Uploading…' : 'Upload image'}</button>
        <input ref={file} type="file" accept="image/*" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        {err && <p className="issue error">{err}</p>}
        <div className="asset-grid">
          {assets.map((a) => (
            <button key={a.ID} className="asset-card" onClick={() => onPick?.(a)} title={onPick ? 'Use this image' : a.ID}>
              <img src={api.assetUrl(a.ID)} alt={a.fileName} />
              <span>{a.fileName}</span>
              <span className="muted">{(a.size / 1024).toFixed(0)} KB</span>
            </button>
          ))}
          {!assets.length && <p className="muted">No assets yet.</p>}
        </div>
        <button className="dialog-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
