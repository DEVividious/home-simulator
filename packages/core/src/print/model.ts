// The print export (ADR 0030–0033): a building block → STL parts of a scale model that fit a printer bed, with the report of
// every check and change. The scale is the largest standard one at which every part fits (each candidate is built with its own
// printability adjustments, since they depend on the scale), or the one given. Each part is checked, oriented (a roof part prints
// upside down when that needs fewer supports and still stands on a flat face), turned by 90° when it fits only that way, centred
// on the bed and written as binary STL; a part that fails a blocking check gets no file. Pure: the caller reads and writes files.
import { building, ceilingAt, roomsOfLevel, type Building, type BuildingData } from '../model/building.ts';
import { pointInPolygon } from '../model/geom2d.ts';
import type { Vec3 } from '../package/types.ts';
import { plainMesh } from '../solid/mesh.ts';
import { scoped } from '../solid/scope.ts';
import type { Geometry } from '../solid/wasm.ts';
import { adjustForPrint, type Adjustment, type Minimums } from './adjust.ts';
import { bedContact, components, overhangs, thinSpots, type Overhang, type Overhangs, type ThinSpot } from './checks.ts';
import { buildParts, type EavesMode, type PrintNote, type Split } from './parts.ts';
import type { Bed } from './printers.ts';
import type { PrintProfile } from './profiles.ts';
import { fitOnBed, mmPerM, SCALES, scaleLabel, scaleTag, type Fit } from './scale.ts';
import { checkStl, splitNeedles, writeStl } from './stl.ts';

export interface PrintOptions {
  bed: Bed;
  profile: PrintProfile;
  /** 1:n; null or absent — the largest standard scale at which every part fits */
  scale?: number | null;
  /** kept free on every side of the bed [mm] (default 10) */
  margin?: number;
  eaves?: EavesMode;
  /** project id: in the file names and the STL headers */
  name: string;
  /** recorded in the report as given (versions, the input's hash) */
  meta?: Record<string, string>;
}

export interface PlainMesh32 { positions: Float32Array; index: Uint32Array }

export interface PrintPart {
  id: string;
  kind: 'level' | 'roof';
  level: string;
  /** the level's name, or "roof" */
  title: string;
  file: string;
  /** size on the print as it lies on the bed [mm] */
  sizeMm: [number, number, number];
  fit: Fit;
  /** printed upside down */
  flipped: boolean;
  volumeMm3: number;
  triangles: number;
  components: number;
  crumbs: number;
  thin: ThinSpot[];
  overhangs: Overhangs;
  /** blocking problems (the part gets no file) */
  problems: string[];
  ok: boolean;
  /** the binary STL (null when a blocking check failed) */
  stl: Uint8Array | null;
  /** the part in model coordinates — the building's, in mm (assembled views) */
  model: PlainMesh32;
  /** the part as it lies on the bed (the STL's coordinates) */
  placed: PlainMesh32;
}

export interface ScaleCandidate { n: number; fits: boolean; parts: { id: string; sizeMm: [number, number, number]; fit: Fit }[] }

export interface PrintModel {
  ok: boolean;
  /** the scale built (1:n); null when no standard scale fits */
  n: number | null;
  auto: boolean;
  candidates: ScaleCandidate[];
  parts: PrintPart[];
  split: Split | null;
  adjustments: Adjustment[];
  notes: PrintNote[];
  minimums: Minimums | null;
  /** what keeps the model from printing, beyond the parts' own problems */
  problems: string[];
  report: PrintReport;
}

const r2 = (x: number) => Math.round(x * 100) / 100 + 0;
const r1 = (x: number) => Math.round(x * 10) / 10 + 0;

/** sizes of the parts at 1:n [mm] (built with that scale's adjustments, no checks) */
export function partSizes(data: BuildingData, geo: Geometry, n: number, o: Pick<PrintOptions, 'profile' | 'eaves' | 'bed' | 'margin'>): ScaleCandidate {
  const k = mmPerM(n), eaves = o.eaves ?? 'keep', margin = o.margin ?? 10;
  const parts = scoped((keep) => buildParts(geo, keep, adjustForPrint(data, n, o.profile, eaves).data, n, o.profile, eaves).parts.map((p) => {
    const bb = p.solid.boundingBox(), sizeMm = [0, 1, 2].map((i) => r2((bb.max[i] - bb.min[i]) * k)) as [number, number, number];
    return { id: p.id, sizeMm, fit: fitOnBed(sizeMm, o.bed, margin) };
  }));
  return { n, fits: parts.length > 0 && parts.every((p) => p.fit.fits), parts };
}

/** the sizes at every standard scale */
export const scaleTable = (data: BuildingData, geo: Geometry, o: Pick<PrintOptions, 'profile' | 'eaves' | 'bed' | 'margin'>): ScaleCandidate[] => SCALES.map((n) => partSizes(data, geo, n, o));

/** mesh positions transformed: p ↦ M·p + t, as float32 */
function transformed(P: Float64Array, f: (x: number, y: number, z: number) => Vec3): Float32Array {
  const out = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) { const q = f(P[i], P[i + 1], P[i + 2]); out[i] = q[0]; out[i + 1] = q[1]; out[i + 2] = q[2]; }
  return out;
}

/** an overhang named after what is there: the head of an opening of the level at its height, or the ceiling of a room */
function describe(b: Building, level: string, at: Vec3): string | null {
  const t = b.shell.exteriorWall + 0.05, near = (z: number) => Math.abs(z - at[2]) < 0.04;
  for (const r of roomsOfLevel(b, level)) for (const w of r.walls) {
    const holes = [...r.windows.filter((x) => x.wallId === w.id).map((x) => ({ id: x.id, t0: x.t0, t1: x.t1, head: r.floorZ + x.head })), ...r.doors.filter((x) => x.wallId === w.id).map((x) => ({ id: x.id ?? 'passage', t0: x.t0, t1: x.t1, head: r.floorZ + (w.holes.find((h) => h.t0 === x.t0)?.z1 ?? 0) }))];
    for (const h of holes) {
      if (!near(h.head)) continue;
      const s = (at[0] - w.a[0]) * w.dir[0] + (at[1] - w.a[1]) * w.dir[1], d = -((at[0] - w.a[0]) * w.inward[0] + (at[1] - w.a[1]) * w.inward[1]);
      if (s > h.t0 - 0.05 && s < h.t1 + 0.05 && d > -0.05 && d < t) return `lintel of ${h.id}`;
    }
  }
  for (const r of roomsOfLevel(b, level)) if (pointInPolygon([at[0], at[1]], r.polygon, 0.01) && near(ceilingAt(r, at[0], at[1]))) return `ceiling of ${r.id}`;
  return null;
}

export function printModel(data: BuildingData, geo: Geometry, o: PrintOptions): PrintModel {
  const margin = o.margin ?? 10, eaves = o.eaves ?? 'keep', profile = o.profile, candidates: ScaleCandidate[] = [];
  let n: number | null = o.scale ?? null;
  const auto = n === null;
  if (auto) for (const s of SCALES) { const c = partSizes(data, geo, s, o); candidates.push(c); if (c.fits) { n = s; break; } }
  if (n === null) {
    const problems = [`no standard scale down to 1:${SCALES[SCALES.length - 1]} fits the bed ${o.bed.x} × ${o.bed.y}${o.bed.z ? ` × ${o.bed.z}` : ''} mm with a ${margin} mm margin`];
    const res: Omit<PrintModel, 'report'> = { ok: false, n: null, auto, candidates, parts: [], split: null, adjustments: [], notes: [], minimums: null, problems };
    return { ...res, report: printReport(res, o) };
  }
  const scale = n, k = mmPerM(scale);
  const adj = adjustForPrint(data, scale, profile, eaves), adjusted = building(adj.data), titles = new Map(adjusted.levels.map((l) => [l.id, l.name]));
  const built = scoped((keep) => {
    const b = buildParts(geo, keep, adj.data, scale, profile, eaves);
    return {
      ...b,
      parts: b.parts.map((p) => {
        const problems: string[] = [];
        const status = p.solid.status();
        if (status !== 'NoError') problems.push(`kernel status ${status}`);
        const one = components(geo, keep, p.solid);
        if (!one.pieces.length) problems.push('empty');
        const volume = one.solid.volume() * k * k * k;
        if (!(volume > 0)) problems.push('no volume');
        const thin = thinSpots(geo, keep, one.solid, p.sections, p.mask, profile, k);
        const mesh = plainMesh(one.solid);
        return { part: p, problems, crumbs: one.crumbs, pieces: one.pieces, volume, thin, mesh };
      }),
    };
  });
  const parts: PrintPart[] = built.parts.map(({ part: p, problems, crumbs, pieces, volume, thin, mesh }) => {
    const model = transformed(mesh.positions, (x, y, z) => [x * k, y * k, z * k]);
    // orientation: upright, or (a roof part) upside down when that needs fewer supports and lies as flat on the bed
    const up = { P: model, over: overhangs(model, mesh.index, profile), contact: bedContact(model, mesh.index), flipped: false };
    let best = up;
    if (p.kind === 'roof') {
      const flipped = transformed(mesh.positions, (x, y, z) => [x * k, -y * k, -z * k]);
      const down = { P: flipped, over: overhangs(flipped, mesh.index, profile), contact: bedContact(flipped, mesh.index), flipped: true };
      const support = (x: Overhangs) => x.supports.reduce((s, q) => s + q.areaMm2, 0);
      if (down.contact >= 0.5 * up.contact && support(down.over) < support(up.over) - 1) best = down;
    }
    // overhangs located in the building (metres) and named after the opening or ceiling they are
    const toBuilding = (q: Vec3): Vec3 => [r2(q[0] / k), r2((best.flipped ? -q[1] : q[1]) / k), r2((best.flipped ? -q[2] : q[2]) / k)];
    const located = (list: Overhang[]) => list.map((x) => { const at = toBuilding(x.at), what = describe(adjusted, p.level, at); return { ...x, at, ...(what ? { what } : {}) }; });
    best.over = { ...best.over, bridges: located(best.over.bridges), supports: located(best.over.supports) };
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < best.P.length; i += 3) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], best.P[i + j]); hi[j] = Math.max(hi[j], best.P[i + j]); }
    // every piece stands on the bed (its lowest point at the part's)
    const lowest = pieces.map((q) => (best.flipped ? -q.max[2] : q.min[2]) * k);
    for (const z of lowest) if (z > lo[2] + 0.01) problems.push(`a separate piece stands ${r2(z - lo[2])} mm above the bed`);
    const size = [0, 1, 2].map((j) => r2(hi[j] - lo[j])) as [number, number, number], fit = fitOnBed(size, o.bed, margin);
    if (!fit.fits) problems.push(`does not fit the bed (${fit.over.join(', ')}): ${size.join(' × ')} mm`);
    // on the bed: turned when it fits only that way, centred, standing on z = 0
    const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2, bx = o.bed.x / 2, by = o.bed.y / 2;
    const placedP = new Float32Array(best.P.length);
    for (let i = 0; i < best.P.length; i += 3) {
      const x = best.P[i] - cx, y = best.P[i + 1] - cy;
      placedP[i] = fit.rotated ? bx - y : bx + x; placedP[i + 1] = fit.rotated ? by + x : by + y; placedP[i + 2] = best.P[i + 2] - lo[2];
    }
    const file = `${o.name}-${p.id}-${scaleTag(scale)}.stl`, index = splitNeedles(placedP, mesh.index, 1e-4);
    const bytes = writeStl(placedP, index, `home-simulator ${o.name} ${p.id} ${scaleLabel(scale)} mm`);
    const back = checkStl(bytes);
    if (!back.ok) problems.push(`STL read back: ${back.problems.join('; ')}`);
    else if (Math.abs(back.volume - volume) > 1e-4 * volume + 1e-3) problems.push(`STL read back: volume ${r1(back.volume)} mm³ instead of ${r1(volume)} mm³`);
    const ok = !problems.length;
    return {
      id: p.id, kind: p.kind, level: p.level, title: p.kind === 'roof' ? 'roof' : titles.get(p.level) ?? p.level, file,
      sizeMm: fit.rotated ? [size[1], size[0], size[2]] : size, fit, flipped: best.flipped, volumeMm3: r1(volume), triangles: index.length / 3, components: pieces.length, crumbs,
      thin, overhangs: best.over, problems, ok, stl: ok ? bytes : null,
      model: { positions: model, index }, placed: { positions: placedP, index },
    };
  });
  const problems = parts.length ? [] : ['the building has no rooms'];
  const res: Omit<PrintModel, 'report'> = {
    ok: !problems.length && parts.every((p) => p.ok), n: scale, auto, candidates, parts, split: built.split, adjustments: adj.changes, notes: built.notes, minimums: adj.minimums, problems,
  };
  return { ...res, report: printReport(res, o) };
}

// ------------------------------------------------------------------ report
export interface PrintReport {
  generator: string;
  meta: Record<string, string>;
  project: string;
  ok: boolean;
  printer: { name: string | null; bedMm: [number, number, number | null]; marginMm: number };
  profile: PrintProfile;
  scale: { n: number | null; label: string | null; mmPerM: number | null; chosen: 'auto' | 'given'; candidates: { scale: string; fits: boolean; parts: { id: string; sizeMm: [number, number, number]; rotated: boolean }[] }[] };
  split: Split | null;
  minimumsMm: Minimums | null;
  parts: {
    id: string; kind: 'level' | 'roof'; level: string; title: string; file: string | null; sizeMm: [number, number, number]; bedUsePct: [number, number]; rotated: boolean; upsideDown: boolean;
    volumeMm3: number; triangles: number; components: number; crumbsDropped: number; thinSpots: ThinSpot[];
    overhangs: { moderateMm2: number; bridges: number; longestBridgeMm: number | null; supports: Overhangs['supports'] };
    supportsNeeded: boolean; problems: string[]; ok: boolean;
  }[];
  adjustments: Adjustment[];
  notes: PrintNote[];
  warnings: string[];
  problems: string[];
}

function printReport(m: Omit<PrintModel, 'report'>, o: PrintOptions): PrintReport {
  const warnings: string[] = [];
  for (const p of m.parts) {
    if (p.thin.length) warnings.push(`${p.id}: ${p.thin.length} spot(s) thinner than ${o.profile.wall} mm (largest ${Math.max(...p.thin.map((t) => t.areaMm2))} mm²)`);
    if (p.overhangs.supports.length) warnings.push(`${p.id}: ${p.overhangs.supports.length} overhang(s) need supports (largest ${p.overhangs.supports[0].areaMm2} mm² at ${p.overhangs.supports[0].heightMm} mm above the bed)`);
  }
  return {
    generator: 'home-simulator print export',
    meta: o.meta ?? {},
    project: o.name,
    ok: m.ok,
    printer: { name: o.bed.name, bedMm: [o.bed.x, o.bed.y, o.bed.z], marginMm: o.margin ?? 10 },
    profile: o.profile,
    scale: {
      n: m.n, label: m.n ? scaleLabel(m.n) : null, mmPerM: m.n ? r2(mmPerM(m.n)) : null, chosen: m.auto ? 'auto' : 'given',
      candidates: m.candidates.map((c) => ({ scale: scaleLabel(c.n), fits: c.fits, parts: c.parts.map((p) => ({ id: p.id, sizeMm: p.sizeMm, rotated: p.fit.rotated })) })),
    },
    split: m.split,
    minimumsMm: m.minimums,
    parts: m.parts.map((p) => ({
      id: p.id, kind: p.kind, level: p.level, title: p.title, file: p.stl ? p.file : null, sizeMm: p.sizeMm, bedUsePct: p.fit.usage, rotated: p.fit.rotated, upsideDown: p.flipped,
      volumeMm3: p.volumeMm3, triangles: p.triangles, components: p.components, crumbsDropped: p.crumbs, thinSpots: p.thin,
      overhangs: { moderateMm2: p.overhangs.moderateMm2, bridges: p.overhangs.bridges.length, longestBridgeMm: p.overhangs.bridges.reduce<number | null>((s, b) => (b.spanMm !== null && (s === null || b.spanMm > s) ? b.spanMm : s), null), supports: p.overhangs.supports },
      supportsNeeded: p.overhangs.supports.length > 0, problems: p.problems, ok: p.ok,
    })),
    adjustments: m.adjustments,
    notes: m.notes,
    warnings,
    problems: [...m.problems, ...m.parts.flatMap((p) => p.problems.map((x) => `${p.id}: ${x}`))],
  };
}
