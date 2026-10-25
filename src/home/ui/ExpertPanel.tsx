// Expert mode: geometry helpers (grid, XYZ axes, wireframe, colours by data confidence), camera (project coordinates), raw
// project configuration (JSON, read only), rendering statistics.
import { useEffect, useState } from 'react';
import { geometryCacheStats } from '../three/furnitureGeometry';
import { materialCacheStats } from '../three/materials';
import { perf } from '../scene/HomeCanvas';
import { sceneApi } from '../scene/sceneApi';
import { useStore } from '../store/createStore';
import { exportProject, useDesign, variantOf } from '../store/design';
import { ui, useUi, type UiState } from '../store/ui';
import { cutUniforms } from '../three/cutaway';
import { Block, Seg, Toggle } from './controls';
import { DoorsPanelToggle } from './DoorsToggle';
import { fmtNum, t } from '../../i18n';

type Tab = UiState['expert']['tab'];

function CameraReadout() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const h = window.setInterval(() => setTick((x) => x + 1), 500); return () => window.clearInterval(h); }, []);
  const c = sceneApi.camera, g = sceneApi.target;
  if (!c) return null;
  const f = (v: { x: number; y: number; z: number }) => `${v.x.toFixed(2)} / ${(-v.z).toFixed(2)} / ${v.y.toFixed(2)}`;
  return (
    <dl className="hm-kv" data-tick={tick}>
      <dt>{t('expertUi.camera')}</dt><dd>{f(c.position)}</dd>
      {g && <><dt>{t('expertUi.target')}</dt><dd>{f(g)}</dd></>}
      <dt>{t('expertUi.type')}</dt><dd>{c.type}</dd>
      <dt>{t('expertUi.wallCuts')}</dt><dd>{cutUniforms.uCutCount.value}</dd>
    </dl>
  );
}

function Perf() {
  const p = useStore(perf, (s) => s);
  const [caches, setCaches] = useState({ ...geometryCacheStats(), ...materialCacheStats() });
  useEffect(() => { const h = window.setInterval(() => setCaches({ ...geometryCacheStats(), ...materialCacheStats() }), 1000); return () => window.clearInterval(h); }, []);
  return (
    <dl className="hm-kv" data-testid="perf">
      <dt>{t('expertUi.renderer')}</dt><dd data-testid="perf-backend">{p.backend}</dd><dt>GPU</dt><dd>{p.gpu}</dd>
      <dt>{t('expertUi.qualityProfile')}</dt><dd data-testid="perf-profile">{p.profile}</dd><dt>{t('expertUi.dpr')}</dt><dd>{p.dpr}</dd>
      <dt>{t('expertUi.rendering')}</dt><dd>{p.frameloop === 'demand' ? t('expertUi.onDemand') : t('expertUi.continuous')} · {t('expertUi.frames', { n: p.renderedFrames })}</dd>
      <dt>{t('expertUi.fps')}</dt><dd data-testid="perf-fps">{p.fps}</dd><dt>{t('expertUi.cpuFrameTime')}</dt><dd>{p.frameMs} ms (p95 {p.frameMsP95} ms)</dd>
      <dt>{t('expertUi.drawCalls')}</dt><dd>{p.calls}</dd><dt>{t('expertUi.triangles')}</dt><dd>{fmtNum(p.triangles, 0)}</dd>
      <dt>{t('expertUi.geometries')}</dt><dd>{p.geometries}</dd><dt>{t('expertUi.textures')}</dt><dd>{p.textures}</dd><dt>{t('expertUi.programs')}</dt><dd>{p.programs}</dd>
      <dt>{t('expertUi.furnitureCache')}</dt><dd>{caches.furnitureGeometries}</dd><dt>{t('expertUi.materialCache')}</dt><dd>{caches.materials}</dd>
    </dl>
  );
}

export function ExpertPanel() {
  const ex = useUi((s) => s.expert);
  const interiors = useDesign((s) => variantOf(s).interiors);
  const set = (patch: Partial<UiState['expert']>) => ui.set((s) => ({ expert: { ...s.expert, ...patch } }));
  return (
    <div className="hm-section" data-testid="section-expert">
      <Seg wide value={ex.tab} options={[['layers', t('expertUi.tabLayers')], ['config', t('expertUi.tabConfig')], ['perf', t('expertUi.tabPerf')]] as [Tab, string][]} onChange={(tab) => set({ tab })} testid="expert-tabs" />
      {ex.tab === 'layers' && (
        <Block title={t('expertUi.geometryHelpers')}>
          <DoorsPanelToggle testid="ex-doors" />
          <Toggle on={ex.axes} label={t('expertUi.axes')} onChange={(v) => set({ axes: v })} testid="ex-axes" />
          <Toggle on={ex.grid} label={t('expertUi.grid')} onChange={(v) => set({ grid: v })} testid="ex-grid" />
          <Toggle on={ex.wireframe} label={t('expertUi.wireframe')} onChange={(v) => set({ wireframe: v })} testid="ex-wire" />
          <Toggle on={ex.confidence} label={t('expertUi.confidence')} hint={t('expertUi.confidenceHint')} onChange={(v) => set({ confidence: v })} testid="ex-confidence" />
          <CameraReadout />
          <p className="hm-muted">{t('expertUi.clickHint')}</p>
        </Block>
      )}
      {ex.tab === 'config' && (
        <Block title={t('expertUi.configTitle')}>
          <p className="hm-muted">{t('expertUi.interiorsCount', { n: Object.keys(interiors ?? {}).length })}</p>
          <textarea readOnly className="hm-json" rows={18} value={JSON.stringify(interiors ?? {}, null, 1)} data-testid="raw-interiors" />
          <details><summary>{t('expertUi.wholeDocument')}</summary><textarea readOnly className="hm-json" rows={18} value={exportProject()} /></details>
        </Block>
      )}
      {ex.tab === 'perf' && <Block title={t('expertUi.renderStats')}><Perf /></Block>}
    </div>
  );
}
