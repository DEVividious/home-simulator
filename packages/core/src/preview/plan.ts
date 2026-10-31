// Plan previews drawn without a browser (ADR 0035): the plan of a level as read — rooms with id, name and area, the wall mass
// between them, door gaps with leaves and swing arcs, windows, stairs, the 140 / 220 cm height lines under the roof and roof
// windows, on a 1 m grid — and the roof plan: the planes of the covering shaded by their slope, ridges and hips, valleys, eaves,
// dormers, chimneys, roof windows and the walls below. The same pictures as the repository's browser previews
// (scripts/project/preview.mjs), so an agent compares them with the source drawing wherever it runs. Shapes are drawn at twice
// the size and averaged down; texts are drawn afterwards at the final size (5×7 font, capitals). Deterministic.
import { building, type BuildingData } from '../model/building.ts';
import { contourOf, planeZ, regionBox, regionPolygon, surfaceAt, surfaceFacets, type Plane, type Surface } from '../model/roof.ts';
import { doorLeaves, swingArcs } from '../model/doors.ts';
import { stairDrawing } from '../model/stairs.ts';
import type { LevelId, Vec2 } from '../package/types.ts';
import { fillPolygon, fillRect, image, line, polyline, shrink, text, textWidth, type Image, type RGB } from '../print/raster.ts';

export interface PlanLabels {
  /** "{name} · {level} ({id}) · 1 grid = 1 m · +X right, +Y up" */
  planTitle: string;
  /** "{name} · roof plan · top of the covering {top} m · red: ridges and hips, blue: valleys · 1 grid = 1 m" */
  roofTitle: string;
  /** "plan {area}" — the area printed on the drawing, next to the area of the outline */
  printed: string;
  up: string;
  down: string;
}

export const PLAN_LABELS: PlanLabels = {
  planTitle: '{name} · {level} ({id}) · 1 grid = 1 m · +X right, +Y up',
  roofTitle: '{name} · roof plan · top {top} m · red: ridges and hips, blue: valleys · 1 grid = 1 m',
  printed: 'plan {area}',
  up: 'up',
  down: 'down',
};

const SS = 2, HEAD = 34;
const BG: RGB = [249, 250, 251], GRID: RGB = [229, 231, 235], GRID_TEXT: RGB = [156, 163, 175], INK: RGB = [17, 24, 39], WALL: RGB = [55, 65, 81];
const WHITE: RGB = [255, 255, 255], MUTED: RGB = [55, 65, 81], DOOR: RGB = [220, 38, 38], DOOR_TEXT: RGB = [185, 28, 28];
const GLASS: RGB = [191, 219, 254], GLASS_DOOR: RGB = [147, 197, 253], BLUE: RGB = [37, 99, 235], BLUE_TEXT: RGB = [29, 78, 216];
const STAIR: RGB = [254, 243, 199], STAIR_LINE: RGB = [217, 119, 6], STAIR_EDGE: RGB = [180, 83, 9], STAIR_TEXT: RGB = [146, 64, 14];
const HEIGHT_LINE: RGB = [124, 58, 237], HEIGHT_TEXT: RGB = [109, 40, 217];
const sub = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));
const fmt2 = (x: number) => (Math.round(x * 100) / 100).toString();

interface Label { x: number; y: number; s: string; scale: number; c: RGB; anchor: 'start' | 'middle'; box?: boolean }

/** a drawing in metres (x right, y up) on an image: shapes at SS×, labels queued for the final size */
class Sheet {
  readonly big: Image;
  readonly labels: Label[] = [];
  readonly W: number;
  readonly H: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly S: number;
  constructor(x0: number, y0: number, x1: number, y1: number, S: number) {
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1; this.S = S;
    this.W = Math.round((x1 - x0) * S);
    this.H = Math.round((y1 - y0) * S) + HEAD;
    this.big = image(this.W * SS, this.H * SS, BG);
  }
  /** final-image pixel of a plan point */
  px = (p: Vec2): [number, number] => [(p[0] - this.x0) * this.S, (this.y1 - p[1]) * this.S + HEAD];
  private big2 = (p: Vec2): number[] => { const q = this.px(p); return [q[0] * SS, q[1] * SS]; };
  poly(pts: Vec2[], c: RGB, alpha = 1): void { fillPolygon(this.big, [pts.map(this.big2)], c, alpha); }
  polys(rings: Vec2[][], c: RGB): void { fillPolygon(this.big, rings.map((r) => r.map(this.big2)), c); }
  /** a line `w` final pixels wide */
  seg(a: Vec2, b: Vec2, c: RGB, w = 1, dash?: [number, number]): void {
    const p = this.big2(a), q = this.big2(b);
    line(this.big, p[0], p[1], q[0], q[1], c, w * SS, dash && [dash[0] * SS, dash[1] * SS]);
  }
  outline(pts: Vec2[], c: RGB, w = 1, dash?: [number, number]): void { polyline(this.big, pts.map(this.big2), c, w * SS, true, dash && [dash[0] * SS, dash[1] * SS]); }
  label(p: Vec2, s: string, scale: number, c: RGB, anchor: Label['anchor'] = 'middle', dx = 0, dy = 0, box = false): void {
    const [x, y] = this.px(p);
    this.labels.push({ x: x + dx, y: y + dy, s, scale, c, anchor, box });
  }
  /** the 1 m grid with its coordinates on the top and left margins */
  grid(): void {
    for (let x = Math.ceil(this.x0); x <= this.x1; x++) { this.seg([x, this.y0], [x, this.y1], GRID); this.label([x, this.y1], String(x), 1, GRID_TEXT, 'middle', 0, 3); }
    for (let y = Math.ceil(this.y0); y <= this.y1; y++) { this.seg([this.x0, y], [this.x1, y], GRID); this.label([this.x0, y], String(y), 1, GRID_TEXT, 'start', 3, -12); }
  }
  finish(title: string): Image {
    const img = shrink(this.big, SS);
    fillRect(img, 0, 0, img.width, HEAD - 6, BG);
    for (const l of this.labels) {
      const w = textWidth(l.s, l.scale), x = Math.round(l.anchor === 'middle' ? l.x - w / 2 : l.x), y = Math.round(l.y);
      if (l.box) fillRect(img, x - 3, y - 2, w + 4, 11 * l.scale + 2, WHITE);
      text(img, x, y, l.s, l.scale, l.c);
    }
    text(img, 8, 8, fit(title, img.width - 16, 2), 2, INK);
    return img;
  }
}

function fit(s: string, width: number, scale: number): string {
  if (textWidth(s, scale) <= width) return s;
  let t = s;
  while (t.length > 1 && textWidth(`${t}...`, scale) > width) t = t.slice(0, -1);
  return `${t}...`;
}

/** scale [px per m] so that the drawing is at most 1600 × 1200 px */
const scaleFor = (w: number, h: number) => Math.min(1600 / w, 1200 / h);

/** orthogonal outline grown outwards by d — each vertex moves along both adjacent edge normals */
function grow(poly: Vec2[], d: number): Vec2[] {
  const n = poly.length, area2 = poly.reduce((s, a, i) => { const b = poly[(i + 1) % n]; return s + a[0] * b[1] - b[0] * a[1]; }, 0), k = area2 >= 0 ? 1 : -1;
  const normal = (a: Vec2, b: Vec2): Vec2 => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [(k * dy) / l, (-k * dx) / l]; };
  return poly.map((p, i) => { const n0 = normal(poly[(i - 1 + n) % n], p), n1 = normal(p, poly[(i + 1) % n]); return [p[0] + d * (n0[0] + n1[0]), p[1] + d * (n0[1] + n1[1])] as Vec2; });
}
const inside = (p: Vec2, poly: Vec2[]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
/** a label point inside the room: centre of the widest rectangle of its outline grid (the centroid may fall outside an L) */
function labelPoint(poly: Vec2[]): Vec2 {
  const xs = [...new Set(poly.map((p) => p[0]))].sort((a, b) => a - b), ys = [...new Set(poly.map((p) => p[1]))].sort((a, b) => a - b);
  let best: { size: number; p: Vec2 } | null = null;
  for (let i = 0; i < xs.length - 1; i++) for (let j = i + 1; j < xs.length; j++) for (let u = 0; u < ys.length - 1; u++) for (let v = u + 1; v < ys.length; v++) {
    const size = Math.min(xs[j] - xs[i], ys[v] - ys[u]);
    if (best && size <= best.size) continue;
    let ok = true;
    for (let a = i; a < j && ok; a++) for (let b = u; b < v && ok; b++) ok = inside([(xs[a] + xs[a + 1]) / 2, (ys[b] + ys[b + 1]) / 2], poly);
    if (ok) best = { size, p: [(xs[i] + xs[j]) / 2, (ys[u] + ys[v]) / 2] };
  }
  return best?.p ?? poly[0];
}
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** the plan of one level */
export function planImage(data: BuildingData, levelId: LevelId, o: { name: string; labels?: Partial<PlanLabels> }): Image {
  const L = { ...PLAN_LABELS, ...o.labels }, B = building(data);
  const rooms = data.rooms.rooms.filter((r) => r.level === levelId);
  const polys = rooms.map((r) => r.polygon.map((p) => [p[0], p[1]] as Vec2));
  const xs = polys.flat().map((p) => p[0]), ys = polys.flat().map((p) => p[1]);
  const ext = B.shell.exteriorWall, m = ext + 0.8;
  if (!xs.length) xs.push(0, 1), ys.push(0, 1);
  const x0 = Math.min(...xs) - m, y0 = Math.min(...ys) - m, x1 = Math.max(...xs) + m, y1 = Math.max(...ys) + m;
  const sh = new Sheet(x0, y0, x1, y1, scaleFor(x1 - x0, y1 - y0));
  sh.grid();
  // wall mass: every room grown by the exterior wall thickness (fills the walls between rooms too), then the rooms on top
  for (const p of polys) sh.poly(grow(p, ext), WALL);
  for (const p of polys) { sh.poly(p, WHITE); sh.outline(p, INK); }
  // door gaps (cut through the wall mass) and windows
  for (const r of rooms) {
    for (const d of r.doors) {
      const [a, b] = d.across;
      sh.poly(d.along === 'X' ? rect(d.from_, Math.min(a, b), d.to, Math.max(a, b)) : rect(Math.min(a, b), d.from_, Math.max(a, b), d.to), WHITE);
    }
    for (const w of r.openings) {
      const t = 0.18, inner = w.inner, out = r.polygon.some((p) => (w.plane_axis === 'Y' ? p[1] : p[0]) > inner + 0.01) ? -1 : 1;
      const lo = Math.min(w.from_, w.to), hi = Math.max(w.from_, w.to), e = inner + out * t;
      const poly = w.plane_axis === 'Y' ? rect(lo, Math.min(inner, e), hi, Math.max(inner, e)) : rect(Math.min(inner, e), lo, Math.max(inner, e), hi);
      sh.poly(poly, (w.sill_z ?? 0) < 0.05 ? GLASS_DOOR : GLASS);
      sh.outline(poly, BLUE);
      const at: Vec2 = w.plane_axis === 'Y' ? [(lo + hi) / 2, inner] : [inner, (lo + hi) / 2];
      sh.label(at, w.id, 1, BLUE_TEXT, 'middle', 0, out > 0 ? -14 : 4);
    }
  }
  // stairs: the outline, tread lines, the partition of a U-turn and the walking line with its arrow (model/stairs.ts)
  for (const s of B.stairs) if (s.fromLevel === levelId || s.toLevel === levelId) {
    const d = stairDrawing(s);
    sh.poly(d.outline, STAIR); sh.outline(d.outline, STAIR_EDGE);
    for (const [a, b] of d.treads) sh.seg(a, b, STAIR_LINE);
    for (const [a, b] of d.edges) sh.seg(a, b, STAIR_EDGE);
    for (let i = 1; i < d.path.length; i++) sh.seg(d.path[i - 1], d.path[i], STAIR_TEXT, 2);
    sh.poly(d.head, STAIR_TEXT);
    sh.label(d.label, `${s.id} ${s.fromLevel === levelId ? L.up : L.down}`, 1, STAIR_TEXT, 'middle', 0, -5, true);
  }
  // ceilings under the roof: the 1.40 m and 2.20 m height lines (as attic plans draw them); roof windows
  for (const r of rooms) {
    const c = B.roomById.get(r.id)?.ceiling;
    if (c && c.kind !== 'flat') for (const h of [1.4, 2.2]) {
      let at: Vec2 | null = null;
      for (const f of c.facets()) {
        const seg = contourOf(f, r.floor_z + h);
        if (!seg) continue;
        sh.seg(seg[0], seg[1], HEIGHT_LINE, 1, [6, 4]);
        at ??= seg[0];
      }
      if (at) sh.label(at, String(Math.round(h * 100)), 1, HEIGHT_TEXT, 'start', 3, -13);
    }
    for (const w of r.roof_windows ?? []) {
      const [a, b, cx, d] = w.plan_rect, box = rect(a, b, cx, d);
      sh.poly(box, [219, 234, 254]); sh.outline(box, BLUE, 1, [3, 2]);
      sh.label([(a + cx) / 2, (b + d) / 2], w.id, 1, BLUE_TEXT, 'middle', 0, -5);
    }
  }
  // doors: leaves (open) and swing arcs, every leaf of a double door, a bifold folded; sliding leaves
  for (const d of B.doors.filter((x) => x.level === levelId)) {
    const leaves = doorLeaves(d, 1);
    if (d.hinge && leaves.length) {
      for (const l of leaves) sh.seg(l.a, l.b, DOOR, 2);
      for (const arc of swingArcs(d, 16)) for (let i = 0; i < arc.length - 1; i += 2) sh.seg(arc[i], arc[i + 1], DOOR);
      sh.label(leaves[0].b, d.id, 1, DOOR_TEXT, 'start', 4, -5);
    } else if (d.slide) {
      const s = d.slide.origin, e: Vec2 = [s[0] + d.slide.dir[0] * d.leafWidth, s[1] + d.slide.dir[1] * d.leafWidth];
      sh.seg(s, e, DOOR, 3);
      sh.label(e, `${d.id} ↔`, 1, DOOR_TEXT, 'start', 4, -5);
    }
  }
  for (const r of rooms) {
    const p = labelPoint(r.polygon.map((q) => [q[0], q[1]] as Vec2));
    sh.label(p, r.id, 2, INK, 'middle', 0, -20, true);
    sh.label(p, `${r.name} · ${fmt2(r.area)} m²${r.area_data !== r.area ? ` (${sub(L.printed, { area: fmt2(r.area_data) })})` : ''}`, 1, MUTED, 'middle', 0, 6, true);
  }
  const level = data.rooms.levels[levelId]?.name ?? levelId;
  return sh.finish(sub(L.planTitle, { name: o.name, level, id: levelId }));
}

/** the roof plan, or null for a building without a roof */
export function roofImage(data: BuildingData, o: { name: string; labels?: Partial<PlanLabels> }): Image | null {
  const L = { ...PLAN_LABELS, ...o.labels }, B = building(data), roof = B.roof;
  if (!roof?.pieces.length) return null;
  const boxes = roof.pieces.map((p) => regionBox(p.cover)), m = 1;
  const x0 = Math.min(...boxes.map((b) => b[0])) - m, y0 = Math.min(...boxes.map((b) => b[1])) - m, x1 = Math.max(...boxes.map((b) => b[2])) + m, y1 = Math.max(...boxes.map((b) => b[3])) + m;
  const sh = new Sheet(x0, y0, x1, y1, scaleFor(x1 - x0, y1 - y0));
  sh.grid();
  const same = (a: Plane, b: Plane) => Math.abs(a.gx - b.gx) < 1e-9 && Math.abs(a.gy - b.gy) < 1e-9 && Math.abs(a.z0 - b.z0) < 1e-6;
  const levels = [...roof.levels].sort((a, b) => B.levelById.get(a)!.floorZ - B.levelById.get(b)!.floorZ), lines: [Vec2, Vec2, RGB, number][] = [];
  let top = -Infinity;
  for (const level of levels) {
    const s: Surface = { pieces: roof.byLevel(level), which: 'cover', lift: roof.thickness };
    for (const f of surfaceFacets(s, rect(x0, y0, x1, y1))) {
      const p = f.plane, l = Math.hypot(p.gx, p.gy, 1), light = Math.max(0, (p.gx * 0.45 + p.gy * 0.45 + 0.77) / l), flat = Math.hypot(p.gx, p.gy) < 0.09;
      const c = flat ? [150, 150, 146] : [140, 82, 70], k = 0.55 + 0.6 * light;
      sh.poly(f.polygon, c.map((v) => Math.min(255, Math.round(v * k))) as RGB);
      for (const q of f.polygon) top = Math.max(top, planeZ(p, q[0], q[1]));
      // edges: the eaves (nothing beyond), a crease (another plane beyond) — convex: ridge or hip, concave: valley
      for (let i = 0; i < f.polygon.length; i++) {
        const a = f.polygon[i], b = f.polygon[(i + 1) % f.polygon.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-6) continue;
        const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], n = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len], q: Vec2 = [mid[0] + n[0] * 1e-3, mid[1] + n[1] * 1e-3], other = surfaceAt(s, q[0], q[1]);
        // a step down to another plane (the eaves of a dormer over the roof) is drawn like the eaves
        if (!other || Math.abs(planeZ(p, mid[0], mid[1]) - planeZ(other.plane, mid[0], mid[1])) > 0.01) lines.push([a, b, [31, 41, 55], 2]);
        else if (!same(other.plane, p)) lines.push([a, b, planeZ(p, q[0], q[1]) > other.z + 1e-6 ? [127, 29, 29] : [29, 78, 216], 2]);
      }
    }
  }
  for (const [a, b, c, w] of lines) sh.seg(a, b, c, w);
  // the walls below (outer faces of every level) dashed
  for (const r of data.rooms.rooms) sh.outline(grow(r.polygon.map((p) => [p[0], p[1]] as Vec2), B.shell.exteriorWall), [107, 114, 128], 1, [4, 4]);
  for (const d of roof.json.dormers ?? []) {
    sh.outline(rect(d.rect[0], d.rect[1], d.rect[2], d.rect[3]), [245, 158, 11], 2);
    sh.label([(d.rect[0] + d.rect[2]) / 2, (d.rect[1] + d.rect[3]) / 2], `${d.id} (${d.type}, ${d.front})`, 1, STAIR_TEXT, 'middle', 0, -5, true);
  }
  for (const c of roof.json.chimneys ?? []) {
    const box = rect(c.rect[0], c.rect[1], c.rect[2], c.rect[3]);
    sh.poly(box, [107, 114, 128]); sh.outline(box, INK);
    sh.label([c.rect[2], c.rect[3]], `${c.id} ${c.top} m`, 1, INK, 'start', 4, -5, true);
  }
  for (const r of data.rooms.rooms) for (const w of r.roof_windows ?? []) {
    const [a, b, c, d] = w.plan_rect, box = rect(a, b, c, d);
    sh.poly(box, GLASS); sh.outline(box, BLUE);
    sh.label([(a + c) / 2, (b + d) / 2], w.id, 1, BLUE_TEXT, 'middle', 0, -5);
  }
  for (const p of roof.json.parts) {
    const poly = p.polygon ?? regionPolygon(p.rect as [number, number, number, number]), cx = poly.reduce((u, q) => u + q[0], 0) / poly.length, cy = poly.reduce((u, q) => u + q[1], 0) / poly.length;
    sh.label([cx, cy], `${p.id}: ${p.type}${p.pitch !== undefined ? ` ${p.pitch}°` : ''} (${p.level})`, 2, INK, 'middle', 0, -11, true);
  }
  return sh.finish(sub(L.roofTitle, { name: o.name, top: top.toFixed(2) }));
}
