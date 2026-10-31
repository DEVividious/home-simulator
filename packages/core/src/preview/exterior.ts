// The building from outside, drawn without a browser (ADR 0035): the generated shell (levels, roof, window frames and glass)
// from two opposite corners, so every elevation is seen once. A diagnostic picture of the shape — walls, roof, openings — not a
// rendering of materials. Deterministic.
import { building, type BuildingData } from '../model/building.ts';
import { drawMeshes, fillRect, image, text, textWidth, type DrawMesh, type Image, type RGB } from '../print/raster.ts';
import { shellMeshes } from '../solid/levels.ts';
import type { SolidMesh } from '../solid/mesh.ts';
import { ROLES } from '../solid/tags.ts';
import type { Geometry } from '../solid/wasm.ts';

const WALL: RGB = [228, 224, 214], ROOF: RGB = [176, 92, 74], CHIMNEY: RGB = [150, 150, 146], GLASS: RGB = [150, 186, 222], FRAME: RGB = [246, 246, 244];
const ROOF_ROLES = new Set(['roof', 'roof-flat', 'eaves', 'roof-underside']);

/** a solid mesh split by the colour of its triangles' roles */
function byRole(m: SolidMesh): DrawMesh[] {
  const groups = new Map<RGB, number[]>();
  for (let t = 0; t < m.role.length; t++) {
    const role = ROLES[m.role[t]], c = ROOF_ROLES.has(role) ? ROOF : role === 'chimney' ? CHIMNEY : WALL;
    let g = groups.get(c);
    if (!g) groups.set(c, (g = []));
    g.push(m.index[t * 3], m.index[t * 3 + 1], m.index[t * 3 + 2]);
  }
  return [...groups].map(([color, idx]) => ({ positions: m.positions, index: new Uint32Array(idx), color }));
}

/** two views of the building from outside, side by side, with the title above */
export function exteriorImage(geo: Geometry, data: BuildingData, o: { title: string }): Image {
  const s = shellMeshes(geo, building(data)), W = 1440, H = 600, head = 34, img = image(W, head + H, [250, 250, 248]);
  const meshes: DrawMesh[] = [];
  for (const l of [...s.levels, ...s.roofs]) {
    meshes.push(...byRole(l.solid));
    if (l.frames.index.length) meshes.push({ positions: l.frames.positions, index: l.frames.index, color: FRAME });
    if (l.glass.index.length) meshes.push({ positions: l.glass.positions, index: l.glass.index, color: GLASS });
  }
  drawMeshes(img, 0, head, W / 2, H, meshes, { azimuth: -125, elevation: 24 }, 24);
  drawMeshes(img, W / 2, head, W / 2, H, meshes, { azimuth: 55, elevation: 24 }, 24);
  fillRect(img, W / 2, head + 20, 1, H - 40, [220, 222, 226]);
  let t = o.title;
  while (t.length > 1 && textWidth(t, 2) > W - 16) t = t.slice(0, -1);
  text(img, 8, 8, t, 2, [33, 37, 45]);
  return img;
}
