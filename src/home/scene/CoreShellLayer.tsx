// Generated building shell from the core's solids (ADR 0024): per level one closed solid — walls and slabs in one geometry with
// two material groups — plus window frames and panes. The solids are built in a worker (three/coreShell.ts); until they arrive
// nothing is drawn, and when the kernel fails the grid shell (ShellLayer) is shown instead. The root is named HOUSE and the level
// solids carry userData.capLevel, like the grid shell, so section caps, the cutaway and architecture raycasts work unchanged.
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { project } from '../../project/active';
import { useStore } from '../store/createStore';
import { ui } from '../store/ui';
import { meshGeometry } from '../three/coreMesh';
import { coreShell, shellStatus, type CoreShell } from '../three/coreShell';
import { SHELL_FRAME, SHELL_GLASS, SHELL_SLAB, SHELL_WALL } from '../three/shellGeometry';
import { wake } from './renderLoop';
import { lastWasClick } from './sceneApi';
import type { SceneMode } from './sceneMode';
import { ShellLayer } from './ShellLayer';

const SOLID_MATERIALS = [SHELL_WALL, SHELL_SLAB];
const noRay = () => {};

function CoreShellMeshes({ shell, section }: { shell: CoreShell; section: boolean }) {
  const { levels, mainMs } = useMemo(() => {
    const t0 = performance.now();
    const out = shell.levels.map((l) => ({ level: l.level, solid: meshGeometry(l.solid), frames: l.frames && meshGeometry(l.frames), glass: l.glass && meshGeometry(l.glass) }));
    return { levels: out, mainMs: performance.now() - t0 };
  }, [shell]);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    shellStatus.set({ status: 'ready', triangles: shell.triangles, ms: Math.round(shell.ms), loadMs: Math.round(shell.loadMs), mainMs: Math.round(mainMs * 10) / 10 });
    // the solids arrive after the first frames: the shadow map (updated only on scene changes) must see them
    gl.shadowMap.needsUpdate = true;
    wake();
    return () => { for (const l of levels) for (const g of [l.solid, l.frames, l.glass]) g?.dispose(); };
  }, [shell, levels, mainMs, gl]);
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
  return shell ? <CoreShellMeshes shell={shell} section={mode.cutZ !== null} /> : null;
}
