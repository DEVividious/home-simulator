// Generated building shell from the core's solids (ADR 0024, 0027): per level one closed solid — walls and slabs in one geometry
// with two material groups — plus window frames and panes; per level with roof parts one roof solid (covering, fascias and
// soffits, chimneys) with its roof windows. The solids are built in a worker (three/coreShell.ts); until they arrive nothing is
// drawn, and when the kernel fails the grid shell (ShellLayer) is shown instead. The root is named HOUSE and the level solids
// carry userData.capLevel, like the grid shell, so section caps, the cutaway and architecture raycasts work unchanged. A roof is
// not cut by a section: in the section (and the rooms) of the level it covers, or of a level below, it is hidden — the rooms
// under its slopes stay visible from above, and only the walls are capped.
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { project } from '../../project/active';
import { useStore } from '../store/createStore';
import { ui } from '../store/ui';
import { meshGeometry } from '../three/coreMesh';
import { coreShell, shellStatus, type CoreShell } from '../three/coreShell';
import { SHELL_FRAME, SHELL_GLASS, SHELL_ROOF, SHELL_SLAB, SHELL_WALL } from '../three/shellGeometry';
import { levelIndex } from '../model/rooms';
import { wake } from './renderLoop';
import { lastWasClick } from './sceneApi';
import type { SceneMode } from './sceneMode';
import { ShellLayer } from './ShellLayer';

const SOLID_MATERIALS = [SHELL_WALL, SHELL_SLAB, SHELL_ROOF];
const noRay = () => {};

/** whether the roof over a level is shown: always outside the sections; in a section (or a room) of that level or one below it,
 *  never — it is above the cut or would cover the rooms under its slopes */
export const roofShown = (roofLevel: string, mode: SceneMode): boolean => mode.cutZ === null || levelIndex(roofLevel) < levelIndex(mode.level);

function CoreShellMeshes({ shell, mode }: { shell: CoreShell; mode: SceneMode }) {
  const section = mode.cutZ !== null;
  const { levels, roofs, mainMs } = useMemo(() => {
    const t0 = performance.now(), geos = (l: CoreShell['levels'][number]) => ({ level: l.level, solid: meshGeometry(l.solid), frames: l.frames && meshGeometry(l.frames), glass: l.glass && meshGeometry(l.glass) });
    const out = shell.levels.map(geos), roofs = shell.roofs.map(geos);
    return { levels: out, roofs, mainMs: performance.now() - t0 };
  }, [shell]);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    shellStatus.set({ status: 'ready', triangles: shell.triangles, ms: Math.round(shell.ms), loadMs: Math.round(shell.loadMs), mainMs: Math.round(mainMs * 10) / 10, roofs: shell.roofs.length });
    // the solids arrive after the first frames: the shadow map (updated only on scene changes) must see them
    gl.shadowMap.needsUpdate = true;
    wake();
    return () => { for (const l of [...levels, ...roofs]) for (const g of [l.solid, l.frames, l.glass]) g?.dispose(); };
  }, [shell, levels, roofs, mainMs, gl]);
  // section: the inside of cut solids is visible (like the file model)
  useEffect(() => { for (const m of SOLID_MATERIALS) { m.side = section ? THREE.DoubleSide : THREE.FrontSide; m.needsUpdate = true; } wake(); }, [section]);
  return (
    <group name="HOUSE" onClick={(e) => { if (!lastWasClick()) return; e.stopPropagation(); ui.set({ selection: null }); }}>
      {levels.map((l) => (
        <group key={l.level} name={`SHELL_${l.level}`}>
          <mesh name={`SOLID_${l.level}`} geometry={l.solid} material={SOLID_MATERIALS} userData={{ capLevel: l.level }} castShadow receiveShadow />
          {l.frames && <mesh name={`WINDOW_FRAMES_${l.level}`} geometry={l.frames} material={SHELL_FRAME} castShadow receiveShadow />}
          {l.glass && <mesh name={`WINDOW_GLASS_${l.level}`} geometry={l.glass} material={SHELL_GLASS} raycast={noRay} />}
        </group>
      ))}
      {roofs.map((r) => (
        <group key={`roof-${r.level}`} name={`ROOF_${r.level}`} visible={roofShown(r.level, mode)} userData={{ roofLevel: r.level }}>
          <mesh name={`ROOF_SOLID_${r.level}`} geometry={r.solid} material={SOLID_MATERIALS} castShadow receiveShadow />
          {r.frames && <mesh name={`ROOF_WINDOW_FRAMES_${r.level}`} geometry={r.frames} material={SHELL_FRAME} castShadow receiveShadow />}
          {r.glass && <mesh name={`ROOF_WINDOW_GLASS_${r.level}`} geometry={r.glass} material={SHELL_GLASS} raycast={noRay} />}
        </group>
      ))}
    </group>
  );
}

/** building shell computed by the core from the rooms — all levels; clicking the shell clears the selection */
export function CoreShellLayer({ mode }: { mode: SceneMode }) {
  const data = project().building, rebuilds = useStore(shellStatus, (s) => s.rebuilds);
  const [shell, setShell] = useState<CoreShell | 'error' | null>(null);
  useEffect(() => {
    let on = true;
    shellStatus.set({ kind: 'core', status: 'loading', error: null });
    coreShell(rebuilds ? structuredClone(data) : data).then(
      (s) => { if (on) setShell(s); },
      (e: Error) => {
        console.warn(`generated shell: the solid kernel failed (${e.message}) — showing the grid shell`);
        shellStatus.set({ kind: 'grid', status: 'error', error: e.message });
        if (on) setShell('error');
      },
    );
    return () => { on = false; };
  }, [data, rebuilds]);
  if (shell === 'error') return <ShellLayer mode={mode} />;
  return shell ? <CoreShellMeshes shell={shell} mode={mode} /> : null;
}
