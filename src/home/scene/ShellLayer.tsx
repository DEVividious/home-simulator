// Grid shell in the scene (model/shell.ts, three/shellGeometry.ts): walls with openings, floor and ceiling slabs, simple windows
// (frame + glass) — for projects without a building model file when the core's solids are not available (CoreShellLayer falls
// back to it; ?shell=grid forces it; kept for one release, ADR 0026). The root is named HOUSE, like the file model, so section
// caps (SectionCaps), the cutaway of walls hiding the room and architecture raycasts work regardless of the shell source.
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { allLevels } from '../model/rooms';
import { levelShell } from '../model/shell';
import { ui } from '../store/ui';
import { SHELL_FRAME, SHELL_GLASS, SHELL_SLAB, SHELL_WALL, shellGeometry } from '../three/shellGeometry';
import { lastWasClick } from './sceneApi';
import type { SceneMode } from './sceneMode';

function LevelShellMesh({ level, section }: { level: string; section: boolean }) {
  const shell = levelShell(level);
  const geo = useMemo(() => shellGeometry(shell), [shell]);
  useEffect(() => () => { Object.values(geo).forEach((g) => g?.dispose()); }, [geo]);
  // section: the inside of cut solids is visible (like the file model)
  useEffect(() => { for (const m of [SHELL_WALL, SHELL_SLAB]) { m.side = section ? THREE.DoubleSide : THREE.FrontSide; m.needsUpdate = true; } }, [section]);
  return (
    <group name={`SHELL_${level}`}>
      <mesh name={`WALL_${level}`} geometry={geo.walls} material={SHELL_WALL} userData={{ capLevel: level }} castShadow receiveShadow />
      <mesh name={`SLAB_${level}_Floor`} geometry={geo.floor} material={SHELL_SLAB} receiveShadow />
      {geo.top && <mesh name={`SLAB_${level}_Top`} geometry={geo.top} material={SHELL_SLAB} castShadow receiveShadow />}
      {geo.frames && <mesh name={`WINDOW_FRAMES_${level}`} geometry={geo.frames} material={SHELL_FRAME} castShadow receiveShadow />}
      {geo.glass && <mesh name={`WINDOW_GLASS_${level}`} geometry={geo.glass} material={SHELL_GLASS} raycast={() => {}} />}
    </group>
  );
}

/** building shell computed from the rooms — all levels; clicking the shell clears the selection (like the file model in Home mode) */
export function ShellLayer({ mode }: { mode: SceneMode }) {
  const levels = useMemo(() => allLevels().map((l) => l.id), []);
  return (
    <group name="HOUSE" onClick={(e) => { if (!lastWasClick()) return; e.stopPropagation(); ui.set({ selection: null }); }}>
      {levels.map((l) => <LevelShellMesh key={l} level={l} section={mode.cutZ !== null} />)}
    </group>
  );
}
