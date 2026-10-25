// ELECTRICAL PLAN EXPORT TO PDF. Two steps:
//  1. pdfModel() — a PURE description of the document: plan pages (each level and the site) for the selected layers, scale
//     chosen for the paper format, legend of the symbols used, point table pages (tested without a browser);
//  2. renderPdf() — drawing the pages with jsPDF: vectors only (lines, polygons, circles) and text in an embedded font
//     covering Latin scripts (DejaVu Sans, subset) — no raster images. jsPDF is loaded only when exporting.
// Format: A4 or A3 landscape. Every page carries a note that the plan is conceptual.
// Every drawn text goes through pdfSafe() (a character outside the font does not vanish without a trace — pdf/pdfText.ts); a
// table row taller than the page is split, legend names are wrapped, and the explanation block gives way to the legend when it
// does not fit above the footer.
import {
  EL_DISCLAIMER, EL_LAYERS, EL_TYPES, layerOf, PDF_GROUPS, planRows, TABLE_COLUMNS, tableCells, type ElectricalPlan, type ElLayer, type ElPdfGroup, type ElPoint, type ElType,
} from '../model/electrical';
import type { LevelId, Vec2 } from '../model/types';
import { buildPlan, fitScale, isSitePoint, planViewName, planViews, pointsOfView, symbolPrims, viewBounds, type PlanDrawing, type PlanView, type Prim } from '../plan/elPlan';
import { base64Bytes, fontCodePoints, pdfSafe } from './pdfText';
import { t } from '../../i18n';

export type PdfGroup = ElPdfGroup | 'all';
export interface PdfOptions {
  format: 'a4' | 'a3';
  groups: PdfGroup[];
  project: string;
  /** print date (text) */
  date: string;
  /** plan scope: shared / variant */
  scope: string;
  furniture?: Partial<Record<LevelId, Vec2[][]>>;
  table?: boolean;
}
export interface PdfPlanPage { kind: 'plan'; title: string; group: PdfGroup; view: PlanView; den: number; drawing: PlanDrawing; origin: Vec2; count: number }
export interface PdfTablePage { kind: 'table'; title: string; rows: string[][] }
export type PdfPage = PdfPlanPage | PdfTablePage;
export interface PdfLayout { w: number; h: number; m: number; col: number; head: number; foot: number; area: [number, number, number, number]; k: number }

export const PAGE = { a4: [297, 210], a3: [420, 297] } as const;
/** page layout [mm]: margin, legend column on the right, header, footer with the disclaimer, drawing field */
export function pageLayout(format: 'a4' | 'a3'): PdfLayout {
  const [w, h] = PAGE[format], k = format === 'a3' ? 1.3 : 1, m = 10, col = 66 * k, head = 13 * k, foot = 15 * k;
  return { w, h, m, col, head, foot, k, area: [m, m + head, w - m - col - 4, h - m - foot] };
}
const groupLayers = (g: PdfGroup): ElLayer[] => PDF_GROUPS[g].layers;

/** document description: plan pages for each selected layer + point table */
export function pdfModel(plan: ElectricalPlan, o: PdfOptions): PdfPage[] {
  const L = pageLayout(o.format), pages: PdfPage[] = [], aw = L.area[2] - L.area[0], ah = L.area[3] - L.area[1];
  const groups = o.groups.length ? o.groups : (['all'] as PdfGroup[]);
  for (const g of groups) {
    const layers = groupLayers(g);
    for (const view of planViews()) {
      const pts = pointsOfView(plan, view, layers);
      // level plans always for "All"; for a single layer — when it has points there (distribution boards are only a reference)
      const own = pts.filter((p) => g === 'all' || layerOf(p.type) !== 'boards' || g === 'power').length;
      if (view === 'SITE' ? !pts.some(isSitePoint) : g !== 'all' && own === 0) continue;
      const bounds = viewBounds(view, pts), den = fitScale(bounds, aw, ah);
      const drawing = buildPlan({ view, plan, layers, den, dims: 'auto', furniture: view === 'SITE' ? undefined : o.furniture?.[view as LevelId] });
      const dw = ((bounds[2] - bounds[0]) * 1000) / den, dh = ((bounds[3] - bounds[1]) * 1000) / den;
      pages.push({ kind: 'plan', title: t('pdf.planTitle', { view: planViewName(view), group: PDF_GROUPS[g].name }), group: g, view, den, drawing, origin: [L.area[0] + (aw - dw) / 2, L.area[1] + (ah - dh) / 2], count: pts.length });
    }
  }
  if (o.table !== false) {
    const all = groups.includes('all'), ids = new Set<string>();
    const rows = (all ? planRows(plan) : groups.flatMap((g) => planRows(plan, g as ElPdfGroup))).filter((r) => (ids.has(r.id) ? false : (ids.add(r.id), true)));
    pages.push({ kind: 'table', title: t('pdf.tableTitle', { layers: all ? t('pdf.allLayers') : groups.map((g) => PDF_GROUPS[g].name).join(', ') }), rows: rows.map(tableCells) });
  }
  return pages;
}

/** table column widths [mm] for the usable page width */
export function tableWidths(usable: number): number[] {
  const rel = [11, 34, 38, 20, 36, 16, 10, 38, 22, 14, 38], sum = rel.reduce((a, b) => a + b, 0);
  return rel.map((v) => (v * usable) / sum);
}
/** "how to find a point on site" block in the legend column: pre-wrapped lines, a line ending with ':' is a heading */
export const howToRead = (): string[] => t('pdf.howToRead').split('\n');
/** lazy view of howToRead() (array-like; translations are not available at module load) */
export const HOW_TO_READ: readonly string[] = new Proxy([] as string[], {
  get: (_, k) => { const a = howToRead(); const v = Reflect.get(a, k); return typeof v === 'function' ? v.bind(a) : v; },
  has: (_, k) => Reflect.has(howToRead(), k),
  ownKeys: () => Reflect.ownKeys(howToRead()),
  getOwnPropertyDescriptor: (_, k) => { const d = Reflect.getOwnPropertyDescriptor(howToRead(), k); if (d && k !== 'length') d.configurable = true; return d; },
});

/** font embedded in the PDF: TTF files in base64 form */
export interface PdfFonts { regular: string; bold: string }
/** character set of the embedded font — in BOTH weights (from the cmap tables of the TTF files) */
export function pdfCharSet(fonts: PdfFonts): (cp: number) => boolean {
  const regular = fontCodePoints(base64Bytes(fonts.regular)), bold = fontCodePoints(base64Bytes(fonts.bold));
  return (cp) => regular.has(cp) && bold.has(cp);
}
/** document texts — each once (the header not for every page): for the report of characters replaced in the PDF (pdfText.ts → pdfReplaced) */
export function pdfTexts(pages: PdfPage[], o: PdfOptions): string[] {
  const out = [o.project, o.scope, o.date];
  for (const pg of pages) {
    out.push(pg.title);
    if (pg.kind === 'table') for (const r of pg.rows) out.push(...r);
    else for (const p of [...pg.drawing.prims, ...pg.drawing.symbols]) if (p.k === 'text') out.push(p.text);
  }
  return out;
}
/**
 * A table row taller than the page (a very long note): parts of at most `cap` text lines — each fits on a page, nothing is
 * lost; the following parts have "ID (cont.)" in the first column. Otherwise such a row would run over the footer and off the page.
 */
export function splitTallRow(cells: string[][], cap: number): string[][][] {
  const n = Math.max(1, ...cells.map((c) => c.length));
  if (n <= cap) return [cells];
  const out: string[][][] = [];
  for (let k = 0; k * cap < n; k++) out.push(cells.map((c, i) => (i === 0 && k > 0 ? [cells[0][0] ?? '', t('pdf.continued')] : c.slice(k * cap, (k + 1) * cap))));
  return out;
}
/** line spacing of a legend name [mm, for A4] */
const LEGEND_LINE = 2.9;
export interface LegendLayout {
  /** position of each entry [mm]: centre of the symbol and the name (a multi-line name is centred around it) */
  ys: number[];
  /** start of the explanation block — below the "left wall corner + wall number" row */
  end: number;
  /** whether the "How to find a point on site" block fits above the footer */
  howTo: boolean;
}
/**
 * Legend layout in the page column: `lines` — number of name lines of each entry (names are wrapped), top — first entry,
 * bottom — lower limit above the footer. Entry pitch 6.4 mm; when there are more entries than the column holds — smaller, so
 * the legend does not run into the footer. The explanation block is drawn only when it fits below the legend (the legend matters more).
 */
export function legendLayout(lines: number[], k: number, top: number, bottom: number, howToLines: number): LegendLayout {
  const lp = LEGEND_LINE * k, tail = 7 * k, extra = lines.reduce((t, n) => t + (n - 1) * lp, 0);
  const pitch = Math.min(6.4 * k, (bottom - top - extra - tail) / Math.max(1, lines.length));
  const ys: number[] = [];
  let y = top;
  lines.forEach((n, i) => { y += i ? pitch + ((lines[i - 1] - 1 + (n - 1)) * lp) / 2 : ((n - 1) * lp) / 2; ys.push(y); });
  const end = (lines.length ? y + ((lines[lines.length - 1] - 1) * lp) / 2 + pitch : top) + tail;
  return { ys, end, howTo: end + (howToLines - 1) * 3.25 * k <= bottom };
}
const rgb = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const PT = 2.8346;

/** draws the document (jsPDF): returns the PDF bytes */
export async function renderPdf(pages: PdfPage[], o: PdfOptions, fonts: PdfFonts): Promise<ArrayBuffer> {
  const { jsPDF } = await import('jspdf');
  const L = pageLayout(o.format), doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: o.format, compress: true });
  doc.addFileToVFS('DejaVuSans.ttf', fonts.regular); doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', fonts.bold); doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  doc.setProperties({ title: t('pdf.docTitle', { project: o.project }), subject: t('pdf.docSubject'), creator: 'Home Simulator 3D' });
  // jsPDF silently drops a character without a glyph — only text made of the embedded font's characters is drawn
  const has = pdfCharSet(fonts), safe = (s: string) => pdfSafe(s, has).text;
  const text = (s: string, x: number, y: number, mmSize: number, opt: { bold?: boolean; color?: string; align?: 'left' | 'center' | 'right' } = {}) => {
    doc.setFont('DejaVu', opt.bold ? 'bold' : 'normal'); doc.setFontSize(mmSize * PT); doc.setTextColor(...rgb(opt.color ?? '#111111'));
    doc.text(safe(s), x, y, { align: opt.align ?? 'left' });
  };
  const draw = (prims: Prim[], T: (p: Vec2) => Vec2, s: number) => {
    for (const p of prims) {
      if (p.k === 'text') {
        const at = T(p.at), size = p.size * s;
        if (p.halo) { doc.setFont('DejaVu', p.bold ? 'bold' : 'normal'); doc.setFontSize(size * PT); const w = doc.getTextWidth(safe(p.text)) + size * 0.35, x0 = p.anchor === 'middle' ? at[0] - w / 2 : p.anchor === 'end' ? at[0] - w : at[0]; doc.setFillColor(255, 255, 255); doc.rect(x0, at[1] - size * 0.82, w, size * 1.1, 'F'); }
        text(p.text, at[0], at[1], size, { bold: p.bold, color: p.color, align: p.anchor === 'middle' ? 'center' : p.anchor === 'end' ? 'right' : 'left' });
        continue;
      }
      const style = p.fill && p.stroke ? 'FD' : p.fill ? 'F' : 'S';
      if (p.fill) doc.setFillColor(...rgb(p.fill));
      if (p.stroke) { doc.setDrawColor(...rgb(p.stroke)); doc.setLineWidth(Math.max(0.05, (p.lw ?? 0.0002) * s)); }
      if (p.k === 'circle') { const c = T(p.c); doc.circle(c[0], c[1], p.r * s, style); continue; }
      if (p.pts.length < 2) continue;
      doc.setLineDashPattern(p.dash ? [p.dash[0] * s, p.dash[1] * s] : [], 0);
      const q = p.pts.map(T), d = q.slice(1).map((v, i) => [v[0] - q[i][0], v[1] - q[i][1]]);
      doc.lines(d, q[0][0], q[0][1], [1, 1], style, !!p.close);
      if (p.dash) doc.setLineDashPattern([], 0);
    }
  };
  const frame = (title: string, n: number, right: string) => {
    doc.setDrawColor(40, 44, 52); doc.setLineWidth(0.25); doc.rect(L.m, L.m, L.w - 2 * L.m, L.h - 2 * L.m, 'S');
    doc.line(L.m, L.m + L.head, L.w - L.m, L.m + L.head); doc.line(L.m, L.h - L.m - L.foot, L.w - L.m, L.h - L.m - L.foot);
    text(title, L.m + 3, L.m + L.head * 0.62, 4.4 * L.k, { bold: true });
    text(right, L.w - L.m - 3, L.m + L.head * 0.42, 2.5 * L.k, { align: 'right' });
    text(`${o.project} · ${o.scope} · ${o.date}`, L.w - L.m - 3, L.m + L.head * 0.8, 2.5 * L.k, { align: 'right', color: '#444444' });
    const fy = L.h - L.m - L.foot + 4.2 * L.k;
    text(EL_DISCLAIMER[0], L.m + 3, fy, 2.6 * L.k, { bold: true });
    text(EL_DISCLAIMER[1], L.m + 3, fy + 3.4 * L.k, 2.3 * L.k);
    text(EL_DISCLAIMER[2], L.m + 3, fy + 6.6 * L.k, 2.3 * L.k);
    text(t('pdf.pageOf', { n, total }), L.w - L.m - 3, L.h - L.m - 2.5, 2.4 * L.k, { align: 'right', color: '#444444' });
  };
  // table pages: rows split with text wrapping
  const usable = L.w - 2 * L.m - 6, widths = tableWidths(usable), fs = 2.35 * L.k, lh = fs * 1.28;
  doc.setFont('DejaVu', 'normal'); doc.setFontSize(fs * PT);
  const tablePages: { title: string; rows: string[][][] }[] = [];
  for (const pg of pages) {
    if (pg.kind !== 'table') continue;
    const maxY = L.h - L.m - L.foot - 2, top = L.m + L.head + 9 * L.k, cap = Math.max(1, Math.floor((maxY - top - 1.6) / lh));
    let y = top, cur: string[][][] = [];
    for (const r of pg.rows) for (const cells of splitTallRow(r.map((c, i) => doc.splitTextToSize(safe(c || ''), widths[i] - 2) as string[]), cap)) {
      const hgt = Math.max(...cells.map((c) => c.length)) * lh + 1.6;
      if (y + hgt > maxY && cur.length) { tablePages.push({ title: pg.title, rows: cur }); cur = []; y = top; }
      cur.push(cells); y += hgt;
    }
    tablePages.push({ title: pg.title, rows: cur });
  }
  const planPages = pages.filter((p): p is PdfPlanPage => p.kind === 'plan');
  const total = planPages.length + tablePages.length;
  let n = 0;
  for (const pg of planPages) {
    if (n++) doc.addPage(o.format, 'landscape');
    frame(pg.title, n, t('pdf.scaleInfo', { den: pg.den, format: o.format.toUpperCase(), count: pg.count }));
    const s = 1000 / pg.den, b = pg.drawing.bounds, T = (p: Vec2): Vec2 => [pg.origin[0] + (p[0] - b[0]) * s, pg.origin[1] + (b[3] - p[1]) * s];
    // drawing clipped to the drawing field (the site background does not run onto the margin or the legend)
    doc.saveGraphicsState();
    doc.rect(L.m + 0.15, L.m + L.head + 0.15, L.w - 2 * L.m - L.col - 2.3, L.h - 2 * L.m - L.head - L.foot - 0.3, null as unknown as string); doc.clip(); doc.discardPath();
    draw(pg.drawing.prims, T, s); draw(pg.drawing.symbols, T, s);
    doc.restoreGraphicsState();
    // graphic scale bar
    const bx = L.area[0] + 2, by = L.area[3] - 2, seg = pg.den <= 50 ? 1 : pg.den <= 150 ? 2 : pg.den <= 300 ? 5 : 10;
    doc.setDrawColor(20, 20, 20); doc.setLineWidth(0.25); doc.line(bx, by, bx + 2 * seg * s, by);
    for (let i = 0; i <= 2; i++) { doc.line(bx + i * seg * s, by - 1.2, bx + i * seg * s, by); text(`${i * seg}${i === 2 ? ' m' : ''}`, bx + i * seg * s, by - 1.8, 2.1 * L.k, { align: 'center' }); }
    // legend of the symbols used + how to read the plan
    const lx = L.w - L.m - L.col, ly0 = L.m + L.head;
    doc.setDrawColor(40, 44, 52); doc.setLineWidth(0.2); doc.line(lx - 2, ly0, lx - 2, L.h - L.m - L.foot);
    let y = ly0 + 6 * L.k;
    text(t('pdf.legend'), lx + 1, y, 2.9 * L.k, { bold: true });
    // names wrapped to the column width (a long name does not cross the page frame); entry and explanation layout — legendLayout()
    const S = 3.6 * L.k, types = pg.drawing.types;
    doc.setFont('DejaVu', 'normal'); doc.setFontSize(2.25 * L.k * PT);
    const names = types.map((ty) => doc.splitTextToSize(EL_TYPES[ty].name, L.col - 13.5 * L.k - 1.5) as string[]);
    const howTo = howToRead(), lay = legendLayout(names.map((n) => n.length), L.k, y + 4.5 * L.k, L.h - L.m - L.foot - 2, howTo.length);
    types.forEach((ty, i) => {
      const fake = { id: '', type: ty, roomId: '', wallId: 'x', positionAlongWall: 0, heightAFFL: 0, orientation: EL_TYPES[ty].mount === 'ceiling' ? 'ceiling' : 'wall', modules: EL_TYPES[ty].modules, label: '', smartHome: 'none', source: '', status: 'planned', width: 0 } as ElPoint;
      const wallM = EL_TYPES[ty].mount === 'wall';
      const sym = symbolPrims(fake, [0, 0], wallM ? [0, 1] : [0, 0], S, 0.3, EL_LAYERS[layerOf(ty)].color);
      const ox = lx + 6 * L.k, oy = lay.ys[i] + (wallM ? 1.2 * L.k : -0.6 * L.k);
      draw(sym.prims, (p) => [ox + p[0], oy - p[1]], 1);
      names[i].forEach((ln, j) => text(ln, lx + 13.5 * L.k, lay.ys[i] - 0.6 * L.k + (j - (names[i].length - 1) / 2) * LEGEND_LINE * L.k, 2.25 * L.k));
    });
    y = lay.end - 5.5 * L.k;
    doc.setFillColor(17, 17, 17); doc.triangle(lx + 3 * L.k, y - 2 * L.k, lx + 5.2 * L.k, y - 2 * L.k, lx + 3 * L.k, y, 'F');
    text(t('pdf.wallCornerLegend'), lx + 7 * L.k, y - 0.3, 2.2 * L.k); y = lay.end;
    if (lay.howTo) for (const line of howTo) { text(line, lx + 1, y, 2.05 * L.k, { bold: line.endsWith(':'), color: '#222222' }); y += 3.25 * L.k; }
  }
  for (const tp of tablePages) {
    if (n++) doc.addPage(o.format, 'landscape');
    frame(tp.title, n, t('pdf.tableNote'));
    let y = L.m + L.head + 4 * L.k, x = L.m + 3;
    doc.setFillColor(236, 238, 241); doc.rect(L.m + 0.2, y - 3.2 * L.k, L.w - 2 * L.m - 0.4, 5 * L.k, 'F');
    TABLE_COLUMNS.forEach((c, i) => { text(c, x + 1, y, fs, { bold: true }); x += widths[i]; });
    y += 5 * L.k;
    for (const cells of tp.rows) {
      const hgt = Math.max(...cells.map((c) => c.length)) * lh + 1.6;
      x = L.m + 3;
      cells.forEach((c, i) => { c.forEach((line, k) => text(line, x + 1, y + k * lh, fs, { bold: i === 0 })); x += widths[i]; });
      doc.setDrawColor(200, 204, 210); doc.setLineWidth(0.1); doc.line(L.m + 2, y + hgt - lh * 0.75, L.w - L.m - 2, y + hgt - lh * 0.75);
      y += hgt;
    }
  }
  return doc.output('arraybuffer');
}

export const pdfFileName = (date: string) => t('pdf.fileName', { date });
export type { ElType };
