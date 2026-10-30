// The preview of a print (ADR 0035): one PNG with the assembled model, the parts lifted apart, and every part on the printer bed
// as it is printed, with its size and the share of the bed it uses. The texts come from the caller (the CLI takes them from the
// i18n dictionaries); the defaults are English.
import type { Bed } from './printers.ts';
import type { PrintModel } from './model.ts';
import { drawMeshes, fillRect, image, strokeRect, text, textWidth, type DrawMesh, type Image, type RGB } from './raster.ts';
import { scaleLabel } from './scale.ts';

export interface PreviewLabels {
  assembled: string;
  exploded: string;
  onBed: string;
  roof: string;
  /** "{n} overhang(s) need supports" */
  supports: string;
  upsideDown: string;
  rotated: string;
  notWritten: string;
}

export const PREVIEW_LABELS: PreviewLabels = {
  assembled: 'Assembled', exploded: 'Parts', onBed: 'On the bed', roof: 'Roof', supports: '{n} overhang(s) need supports',
  upsideDown: 'upside down', rotated: 'turned 90°', notWritten: 'not written: {problem}',
};

const LEVEL: RGB[] = [[226, 222, 212], [214, 220, 228], [222, 214, 226], [214, 226, 216]], ROOF: RGB = [176, 92, 74];
const INK: RGB = [33, 37, 45], MUTED: RGB = [96, 104, 116], WARN: RGB = [180, 60, 40];
const BED: RGB = [196, 206, 218], BED_FREE: RGB = [214, 222, 232];
const fmt = (x: number) => (Math.round(x * 10) / 10).toString();
const sub = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));

/** text shortened with "…" to fit a width (in font pixels at the scale) */
function fit(s: string, width: number, scale: number): string {
  if (textWidth(s, scale) <= width) return s;
  let t = s;
  while (t.length > 1 && textWidth(`${t}...`, scale) > width) t = t.slice(0, -1);
  return `${t}...`;
}

/** the preview of a built print (needs at least one part) */
export function printPreview(m: PrintModel, o: { bed: Bed; margin: number; title: string; labels?: Partial<PreviewLabels> }): Image {
  const L = { ...PREVIEW_LABELS, ...o.labels }, W = 1440, head = 44, row1 = 520, cellW = 480, cellH = 380, perRow = 3;
  const rows2 = Math.max(1, Math.ceil(m.parts.length / perRow)), img = image(W, head + row1 + rows2 * cellH + 12, [250, 250, 248]);
  const colorOf = (i: number) => (m.parts[i].kind === 'roof' ? ROOF : LEVEL[i % LEVEL.length]);
  const bedText = `${o.bed.name ? `${o.bed.name} ` : ''}${o.bed.x} x ${o.bed.y}${o.bed.z ? ` x ${o.bed.z}` : ''} mm`;
  text(img, 16, 14, fit(`${o.title} · ${m.n ? scaleLabel(m.n) : '-'} · ${bedText}`, W - 32, 2), 2, INK);
  fillRect(img, 0, head - 2, W, 1, [220, 222, 226]);
  // assembled, and lifted apart
  const view = { azimuth: -125, elevation: 28 };
  const meshes = m.parts.map((p, i): DrawMesh => ({ positions: p.model.positions, index: p.model.index, color: colorOf(i) }));
  drawMeshes(img, 0, head, W / 2, row1, meshes, view, 30);
  text(img, 16, head + 10, L.assembled, 2, MUTED);
  let lift = 0;
  const height = (p: Float32Array) => { let a = Infinity, b = -Infinity; for (let i = 2; i < p.length; i += 3) { a = Math.min(a, p[i]); b = Math.max(b, p[i]); } return [a, b]; };
  const gap = Math.max(...m.parts.map((p) => { const [a, b] = height(p.model.positions); return b - a; })) * 0.45;
  const lifted = m.parts.map((p, i): DrawMesh => {
    const q = new Float32Array(p.model.positions), dz = lift;
    for (let j = 2; j < q.length; j += 3) q[j] += dz;
    lift += gap;
    return { positions: q, index: p.model.index, color: colorOf(i) };
  });
  drawMeshes(img, W / 2, head, W / 2, row1, lifted, view, 30);
  text(img, W / 2 + 16, head + 10, L.exploded, 2, MUTED);
  fillRect(img, 0, head + row1, W, 1, [220, 222, 226]);
  // each part on the bed: the bed plate, the area inside the margin, the part as it lies in its STL
  m.parts.forEach((p, i) => {
    const cx = (i % perRow) * cellW, cy = head + row1 + Math.floor(i / perRow) * cellH, bx = o.bed.x, by = o.bed.y, mg = o.margin;
    const plate = (x0: number, y0: number, x1: number, y1: number, z: number, color: RGB): DrawMesh => ({ positions: new Float32Array([x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z]), index: new Uint32Array([0, 1, 2, 0, 2, 3]), color });
    drawMeshes(img, cx, cy + 34, cellW, cellH - 80, [plate(0, 0, bx, by, -0.6, BED), plate(mg, mg, bx - mg, by - mg, -0.3, BED_FREE), { positions: p.placed.positions, index: p.placed.index, color: colorOf(i) }], { azimuth: -110, elevation: 50 }, 10);
    const name = p.kind === 'roof' ? L.roof : `${p.id} ${p.title}`;
    text(img, cx + 14, cy + 12, fit(`${L.onBed}: ${name}`, cellW - 28, 2), 2, INK);
    const facts = [`${p.sizeMm.map(fmt).join(' x ')} mm`, `${Math.max(...p.fit.usage)} %`, ...(p.flipped ? [L.upsideDown] : []), ...(p.fit.rotated ? [L.rotated] : [])].join(' · ');
    text(img, cx + 14, cy + cellH - 42, fit(facts, cellW - 28, 2), 2, MUTED);
    const warn = !p.ok ? sub(L.notWritten, { problem: p.problems[0] ?? '' }) : p.overhangs.supports.length ? sub(L.supports, { n: p.overhangs.supports.length }) : '';
    if (warn) text(img, cx + 14, cy + cellH - 20, fit(warn, cellW - 28, 2), 2, WARN);
    strokeRect(img, cx + 4, cy + 4, cellW - 8, cellH - 8, [228, 230, 234]);
  });
  return img;
}
