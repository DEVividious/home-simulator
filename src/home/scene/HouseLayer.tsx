// Building layer of the configurator. Shell: a model file of the project (project assets) or — when the project has none —
// the shell generated from the room outlines: the core's solids (CoreShellLayer), or the grid shell (ShellLayer) with
// ?shell=grid and when the solid kernel fails. Site and surroundings are project modules (manifest → modules),
// mounted only when the project enables them. Home mode: no technical helpers; Expert mode: wireframe, colours by data
// confidence, plot boundary. Picking → UI state.
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { hasModule, project } from '../../project/active';
import type { SceneData } from './sceneData';
import { ShellLayer } from './ShellLayer';
import { CoreShellLayer } from './CoreShellLayer';
import { requestedShell, shellStatus } from '../three/coreShell';
import { enterRoom, ui, useUi, type Selection } from '../store/ui';
import { roomById } from '../model/rooms';
import { orthogonalPlan } from '../model/shell';
import { setSection } from '../three/cutaway';
import { useSides } from '../store/sides';
import { patchTreeMaterials, seeUniforms, setSeeThroughTarget } from '../three/seeThrough';
import { wake } from './renderLoop';
import { FlatGround, FlatGroundMesh, GroundProbe, StairsMesh } from './WalkLayer';
import { ExitSigns } from './ExitSigns';
import { DoorsLayer } from './DoorsLayer';
import { SectionCaps } from './SectionCaps';
import { BoundaryLine, EnvironmentLayer, ModelLayer, SiteLayer, type ModelSettings, type Picked } from './ModelLayers';
import { lastWasClick } from './sceneApi';
import type { SceneMode } from './sceneMode';

/** horizontal architecture section: roof, slab and upper level disappear above the interior (furniture is not clipped) */
function SectionCut({ cutZ }: { cutZ: number | null }) {
  useEffect(() => { setSection(cutZ); }, [cutZ]);
  useEffect(() => () => setSection(null), []);
  return null;
}

/** trees between the camera and the building turn see-through (three/seeThrough.ts): exterior orbit view only — in walk mode
 *  trees stay solid; ?seethrough=off — diagnostics */
const SEE_OFF = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('seethrough') === 'off';
function TreeSeeThrough({ on, bounds }: { on: boolean; bounds: SceneData['bounds'] }) {
  const scene = useThree((s) => s.scene), last = useRef(-1e9);
  useEffect(() => { setSeeThroughTarget(bounds); wake(); }, [bounds]);
  useEffect(() => { seeUniforms.uSeeOn.value = on && !SEE_OFF ? 1 : 0; wake(); return () => { seeUniforms.uSeeOn.value = 0; }; }, [on]);
  useFrame(() => {
    // new tree materials (surroundings mounted) — patched every 0.5 s like the other material patches
    const now = performance.now();
    if (now - last.current < 500) return;
    last.current = now;
    const trees = scene.getObjectByName('ENV_TREES');
    if (trees && patchTreeMaterials(trees)) wake();
  });
  return null;
}

/** the grid shell asked for by the URL (?shell=grid) */
function GridShell({ mode }: { mode: SceneMode }) {
  useEffect(() => { shellStatus.set({ kind: 'grid', status: 'ready', error: null }); }, []);
  return <ShellLayer mode={mode} />;
}

export function HouseLayer({ data, mode }: { data: SceneData; mode: SceneMode }) {
  const { model, site, environment } = data.assets;
  useEffect(() => { if (model) shellStatus.set({ kind: 'model', status: 'ready', error: null }); }, [model]);
  const sides = useSides();
  const isExpert = useUi((s) => s.mode === 'advanced');
  const envEnabled = useUi((s) => s.environment) || mode.environment;
  const ex = useUi((s) => s.expert);
  const selection = useUi((s) => s.selection);
  const wire = isExpert && ex.wireframe;
  const settings = useMemo<ModelSettings>(() => ({ section: mode.cutZ, wireframe: wire, confidence: isExpert && ex.confidence }), [mode.cutZ, wire, isExpert, ex.confidence]);
  const select = (sel: Selection) => ui.set({ selection: sel });
  const onPick = (p: Picked | null) => {
    if (!p || !lastWasClick()) return;
    // level section (Home mode): the shell covering a room floor. The room under the cursor is highlighted (room picks react to
    // the pointer regardless of the shell), so a click must enter it; without a room floor behind the shell — deselect
    if (mode.kind === 'level' && !isExpert) {
      const room = roomById(p.behind.find((o) => o.parent?.name === 'HOME_ROOM_PICKS')?.userData.room as string | undefined);
      if (room) { document.body.style.cursor = ''; enterRoom(room.id, room.level); return; }
    }
    // Home mode: clicking the building shell (walls, roof, terrain next to it) deselects; technical data — Expert only
    if (isExpert) select({ kind: 'house', name: p.name, data: p.userData, point: p.point });
    else select(null);
  };
  const walking = mode.kind === 'walk' || (mode.kind === 'room' && mode.roomView === 'walk');
  const siteData = project().site, siteOn = hasModule('site') && !!siteData;
  return (
    <group name="HOME_HOUSE">
      <SectionCut cutZ={mode.cutZ} />
      {/* architecture (cut away above the room in Room Mode) */}
      <group name="HOME_ARCH">
        {/* shell: the project's model file, or walls, slabs and windows computed from the rooms */}
        {model ? <ModelLayer url={model} settings={settings} onPick={onPick} /> : requestedShell() === 'grid' && orthogonalPlan() ? <GridShell mode={mode} /> : <CoreShellLayer mode={mode} />}
        <StairsMesh config={sides[0].variant.stairs} walking={walking} selected={selection?.kind === 'stairs'} />
        <DoorsLayer mode={mode} />
        {siteOn && <ExitSigns walking={walking} />}
        <SectionCaps mode={mode} />
      </group>
      {/* expert helpers: 1 m grid at the lowest floor, axes at the project origin (glTF: x, y up, −project y) */}
      {isExpert && ex.grid && <gridHelper args={[60, 60, '#8a96a3', '#c9d1d9']} position={[0, 0.002, 0]} raycast={() => null} />}
      {isExpert && ex.axes && <axesHelper args={[2]} raycast={() => null} />}
      {siteOn && (site ? <GroundProbe url={site} /> : <FlatGround />)}
      {siteOn && (site ? <SiteLayer url={site} wireframe={wire} /> : <FlatGroundMesh />)}
      {siteOn && isExpert && mode.kind === 'exterior' && <BoundaryLine boundary={siteData!.boundary} z={siteData!.groundLevel} />}
      {environment && <TreeSeeThrough on={mode.kind === 'exterior' && mode.environment} bounds={data.bounds} />}
      {/* surroundings stay mounted while enabled in the settings — inside only hidden (rebuilding them on every room visit was costly) */}
      {envEnabled && environment && <EnvironmentLayer url={environment} visible={mode.environment} wireframe={wire} />}
    </group>
  );
}
