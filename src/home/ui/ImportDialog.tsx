// Import of a custom furniture model (GLB / glTF): pick a file → analysis (dimensions, units, triangles, warnings) → name,
// category, file units, front direction → save the file on the server and a "My models" entry in the project (one history entry).
import { useEffect, useState } from 'react';
import { FURNITURE_CATEGORIES } from '../catalog/furniture';
import { newId } from '../model/interiors';
import { commit } from '../store/design';
import { toast } from '../store/ui';
import { analyze, makeAsset, MAX_BYTES, normalize, parseModel, renderThumbnail, upload, warningsFor, type GlbAnalysis } from '../three/importGlb';
import { Seg } from './controls';
import { Icon } from './icons';
import { modalKeys } from './modalKeys';
import { fmtNum, t } from '../../i18n';

/** [scale, label] — computed at render time (UI language) */
const units = (): [number, string][] => [[1, t('importUi.metres')], [0.01, t('importUi.centimetres')], [0.001, t('importUi.millimetres')]];

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [a, setA] = useState<GlbAnalysis | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [cat, setCat] = useState('decor');
  const [scale, setScale] = useState(1);
  const [rot, setRot] = useState(180);
  const [thumb, setThumb] = useState<string | null>(null);

  const pick = async (f: File) => {
    setErr(null); setA(null); setThumb(null); setFile(f);
    if (f.size > MAX_BYTES) { setErr(t('importUi.tooLarge', { size: fmtNum(f.size / 1048576, 1) })); return; }
    if (!/\.(glb|gltf)$/i.test(f.name)) { setErr(t('importUi.formats')); return; }
    setBusy(true);
    try {
      const an = analyze(await parseModel(await f.arrayBuffer()));
      setA(an); setScale(an.unit.scale); setName(f.name.replace(/\.(glb|gltf)$/i, '').replace(/[_-]+/g, ' '));
    } catch (e) { setErr(t('importUi.readFailed', { error: (e as Error).message })); }
    setBusy(false);
  };
  useEffect(() => { if (a) { try { setThumb(renderThumbnail(a, scale, rot)); } catch { setThumb(null); } } }, [a, scale, rot]);

  const n = a ? normalize(a, scale, rot) : null;
  const warns = a && n && file ? warningsFor(a, n.dims, file.size) : [];
  const save = async () => {
    if (!a || !file) return;
    setBusy(true);
    const id = newId('m').replace(/[^a-z0-9-]/gi, '');
    const ext = file.name.toLowerCase().endsWith('.gltf') ? 'gltf' : 'glb';
    const up = await upload('model', `${id}.${ext}`, file);
    if (!up.ok) { setErr(t('importUi.saveFailed', { error: up.error ?? '' })); setBusy(false); return; }
    let thumbFile: string | null = null;
    if (thumb) { const tu = await upload('thumb', `${id}.png`, await (await fetch(thumb)).blob()); if (tu.ok) thumbFile = `${id}.png`; }
    const asset = makeAsset(id, name, cat, up.file!, file.size, a, scale, rot, thumbFile);
    commit(t('importUi.historyImport', { name: asset.name }), (d) => ({ ...d, importedAssets: [...(d.importedAssets ?? []), asset] }));
    toast(up.offline ? t('importUi.addedOffline', { name: asset.name }) : t('importUi.added', { name: asset.name }));
    setBusy(false);
    onClose();
  };

  return (
    <div className="hm-modal-bg" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="hm-modal" role="dialog" aria-label={t('importUi.dialogAria')} data-testid="import-dialog" onKeyDown={modalKeys(onClose)}>
        <header><h2>{t('importUi.title')}</h2><button className="hm-icon-btn" onClick={onClose} aria-label={t('importUi.close')}><Icon name="close" /></button></header>
        <label className="hm-drop">
          <input type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} data-testid="import-file" />
          <Icon name="upload" size={26} />
          <b>{file ? file.name : t('importUi.pickFile')}</b>
          <small>{file ? `${fmtNum(file.size / 1048576, 2)} MB` : t('importUi.pickFileHint')}</small>
        </label>
        {busy && <p className="hm-muted">{t('importUi.processing')}</p>}
        {err && <div className="hm-warn err">{err}</div>}
        {a && n && (
          <div className="hm-import-body" data-testid="import-analysis">
            <div className="hm-import-preview">{thumb ? <img src={thumb} alt={t('importUi.preview')} /> : <Icon name="cube" size={48} />}</div>
            <div className="hm-import-form">
              <label className="hm-field"><span>{t('importUi.name')}</span><input value={name} onChange={(e) => setName(e.target.value)} data-testid="import-name" /></label>
              <label className="hm-field"><span>{t('importUi.category')}</span>
                <select value={cat} onChange={(e) => setCat(e.target.value)}>{FURNITURE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </label>
              <div className="hm-field"><span>{t('importUi.fileUnits')}</span><Seg value={scale} options={units().map(([v, l]) => [v, l])} onChange={setScale} testid="import-units" /><small className="hm-muted">{a.unit.reason}</small></div>
              <div className="hm-field"><span>{t('importUi.front')}</span><Seg value={rot} options={[[180, t('importUi.frontStandard')], [0, t('importUi.frontReversed')], [90, '90°'], [270, '270°']]} onChange={setRot} /></div>
              <dl className="hm-kv">
                <dt>{t('importUi.dims')}</dt><dd data-testid="import-dims">{Math.round(n.dims.w * 100)} × {Math.round(n.dims.d * 100)} × {Math.round(n.dims.h * 100)} cm</dd>
                <dt>{t('importUi.triangles')}</dt><dd>{fmtNum(a.triangles, 0)}</dd>
                <dt>{t('importUi.meshesMaterials')}</dt><dd>{a.meshes} / {a.materials}{a.textures ? ` · ${t('importUi.textures', { n: a.textures })}` : ''}</dd>
              </dl>
              {warns.map((w) => <div key={w} className="hm-warn"><Icon name="warn" size={14} /> {w}</div>)}
            </div>
          </div>
        )}
        <footer>
          <button className="hm-btn ghost" onClick={onClose}>{t('importUi.cancel')}</button>
          <button className="hm-btn primary" disabled={!a || busy || !name.trim()} onClick={save} data-testid="import-save">{t('importUi.addToCatalog')}</button>
        </footer>
      </div>
    </div>
  );
}
