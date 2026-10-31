#!/usr/bin/env node
// npm run project:preview -- projects/<id> [--room <roomId>] [--viewpoint <id>] [--no-3d]
// Preview images of a project package for checking it against its source drawing:
//   projects/<id>/preview/plan-<level>.png  top-down plan drawn from project.json: rooms (id, name, area), wall mass between
//                                           rooms, door gaps with swing arcs, windows, stairs, furniture footprints, 1 m grid,
//                                           the 140 / 220 cm height lines under the roof and roof windows
//   projects/<id>/preview/roof.png          roof plan: the planes of the roof shaded by their slope, ridges and hips, valleys,
//                                           eaves, dormers, chimneys, roof windows, the walls below (dashed) and the ridge height
//   projects/<id>/preview/3d.png            the app's start view (headless Chrome, generated shell or model)
//   projects/<id>/preview/room-<id>.png     with --room: the room in the app (cut-away from above)
//   projects/<id>/preview/view-<id>.png     with --viewpoint: eye level from a package viewpoint (sloped ceilings, heights)
import fs from 'node:fs';
import path from 'node:path';
import { launch, ROOT, sleep, startServer, waitForApp } from '../verify/browser.mjs';
import { building } from '@home-sim/core/model/building';
import { doorLeaves, swingArcs } from '@home-sim/core/model/doors';
import { stairDrawing } from '@home-sim/core/model/stairs';
import { offsetPolygon } from '@home-sim/core/model/geom2d';
import { gapFrame, lineC, linePt, windowFrame } from '@home-sim/core/model/wallLine';
import { contourOf, planeZ, regionBox, regionPolygon, surfaceAt, surfaceFacets } from '@home-sim/core/model/roof';

const args = process.argv.slice(2).filter((a) => a !== '--'), dir = args.find((a) => !a.startsWith('--'));
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
if (!dir) { console.error('usage: npm run project:preview -- projects/<id> [--room <roomId>] [--viewpoint <id>] [--no-3d]'); process.exit(2); }
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
const id = pkg.manifest.projectId, out = path.join(dir, 'preview');
fs.mkdirSync(out, { recursive: true });
const cat = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/furnitureCatalog.json'), 'utf8')).items.map((i) => [i.id, i]));
const B = building(pkg.building);

/** an outline grown outwards by d (mitred corners, as the generated shell grows the rooms) */
const grow = (poly, d) => offsetPolygon(poly, d);
const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
/** a label point inside the room: centre of the widest rectangle of its outline grid (the centroid may fall outside an L) */
function labelPoint(poly) {
  const xs = [...new Set(poly.map((p) => p[0]))].sort((a, b) => a - b), ys = [...new Set(poly.map((p) => p[1]))].sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i < xs.length - 1; i++) for (let j = i + 1; j < xs.length; j++) for (let u = 0; u < ys.length - 1; u++) for (let v = u + 1; v < ys.length; v++) {
    const r = [xs[i], ys[u], xs[j], ys[v]], size = Math.min(r[2] - r[0], r[3] - r[1]);
    if (best && size <= best.size) continue;
    // every grid cell of the rectangle must be inside the outline
    let ok = true;
    for (let a = i; a < j && ok; a++) for (let b = u; b < v && ok; b++) ok = inside([(xs[a] + xs[a + 1]) / 2, (ys[b] + ys[b + 1]) / 2], poly);
    if (ok) best = { size, p: [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2] };
  }
  return best?.p ?? poly[0];
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function planSvg(levelId) {
  const rooms = pkg.building.rooms.rooms.filter((r) => r.level === levelId);
  const xs = rooms.flatMap((r) => r.polygon.map((p) => p[0])), ys = rooms.flatMap((r) => r.polygon.map((p) => p[1]));
  const ext = pkg.building.shell?.exteriorWall ?? 0.3, m = ext + 0.8;
  const x0 = Math.min(...xs) - m, y0 = Math.min(...ys) - m, x1 = Math.max(...xs) + m, y1 = Math.max(...ys) + m;
  const S = Math.min(1600 / (x1 - x0), 1200 / (y1 - y0)), W = (x1 - x0) * S, H = (y1 - y0) * S;
  const X = (x) => ((x - x0) * S).toFixed(1), Y = (y) => ((y1 - y) * S).toFixed(1);
  const pts = (poly) => poly.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
  let g = '';
  for (let x = Math.ceil(x0); x <= x1; x++) g += `<line x1="${X(x)}" y1="0" x2="${X(x)}" y2="${H}" stroke="#e5e7eb"/><text x="${X(x)}" y="12" font-size="10" fill="#9ca3af" text-anchor="middle">${x}</text>`;
  for (let y = Math.ceil(y0); y <= y1; y++) g += `<line x1="0" y1="${Y(y)}" x2="${W}" y2="${Y(y)}" stroke="#e5e7eb"/><text x="3" y="${Y(y)}" font-size="10" fill="#9ca3af" dy="-2">${y}</text>`;
  // wall mass: every room grown by the exterior wall thickness (fills the walls between rooms too), then the rooms on top
  for (const r of rooms) g += `<polygon points="${pts(grow(r.polygon, ext))}" fill="#374151" stroke="#374151" stroke-width="1"/>`;   // stroke: no anti-aliasing seams between rooms
  for (const r of rooms) g += `<polygon points="${pts(r.polygon)}" fill="#ffffff" stroke="#111827" stroke-width="1"/>`;
  // door gaps (cut through the wall mass) and windows
  for (const r of rooms) {
    for (const d of r.doors) {
      const [a, b] = d.across, f = gapFrame(d);
      g += `<polygon points="${pts([linePt(f, d.from_, a), linePt(f, d.to, a), linePt(f, d.to, b), linePt(f, d.from_, b)])}" fill="#ffffff"/>`;
    }
    for (const w of r.openings) {
      const f = windowFrame(w), t = 0.18, inner = w.inner, out = r.polygon.some((p) => lineC(f, p) > inner + 0.01) ? -1 : 1, at = linePt(f, (w.from_ + w.to) / 2, inner);
      const poly = [linePt(f, w.from_, inner), linePt(f, w.to, inner), linePt(f, w.to, inner + out * t), linePt(f, w.from_, inner + out * t)];
      g += `<polygon points="${pts(poly)}" fill="${w.sill_z < 0.05 ? '#93c5fd' : '#bfdbfe'}" stroke="#2563eb"/><text x="${X(at[0])}" y="${Y(at[1])}" font-size="11" fill="#1d4ed8" text-anchor="middle" dy="${out > 0 ? -4 : 12}">${esc(w.id)}</text>`;
    }
  }
  // walls that bound no room: filled like the walls, openings white, slats dashed
  for (const w of (pkg.building.walls ?? []).filter((x) => x.level === levelId)) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), u = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L], h = w.thickness / 2;
    const at = (s, k) => [w.a[0] + u[0] * s - u[1] * k, w.a[1] + u[1] * s + u[0] * k];
    g += `<polygon points="${pts([at(0, -h), at(L, -h), at(L, h), at(0, h)])}" fill="#374151"/>`;
    for (const o of w.openings) {
      g += `<polygon points="${pts([at(o.t0, -h), at(o.t1, -h), at(o.t1, h), at(o.t0, h)])}" fill="#ffffff"/>`;
      if (o.infill) { const p = at(o.t0, 0), q = at(o.t1, 0); g += `<line x1="${X(p[0])}" y1="${Y(p[1])}" x2="${X(q[0])}" y2="${Y(q[1])}" stroke="#374151" stroke-dasharray="3 3"/>`; }
    }
  }
  // stairs: the outline, tread lines, the partition of a U-turn and the walking line with its arrow (core model/stairs.ts)
  for (const s of pkg.building.stairs ?? []) if (s.fromLevel === levelId || s.toLevel === levelId) {
    const d = stairDrawing(s), line = (p, q, attr) => `<line x1="${X(p[0])}" y1="${Y(p[1])}" x2="${X(q[0])}" y2="${Y(q[1])}" ${attr}/>`;
    g += `<polygon points="${pts(d.outline)}" fill="#fef3c7" stroke="#b45309"/>`;
    for (const [a, b] of d.treads) g += line(a, b, 'stroke="#d97706" stroke-width="0.7"');
    for (const [a, b] of d.edges) g += line(a, b, 'stroke="#b45309"');
    for (let i = 1; i < d.path.length; i++) g += line(d.path[i - 1], d.path[i], 'stroke="#92400e" stroke-width="2"');
    g += `<polygon points="${pts(d.head)}" fill="#92400e"/><text x="${X(d.label[0])}" y="${Y(d.label[1])}" font-size="12" fill="#92400e" text-anchor="middle">${esc(s.id)} ${s.fromLevel === levelId ? 'up' : 'down'}</text>`;
  }
  // ceilings under the roof: the 1.40 m and 2.20 m height lines (as attic plans draw them); roof windows
  for (const r of rooms) {
    const c = B.roomById.get(r.id)?.ceiling;
    if (c && c.kind !== 'flat') for (const h of [1.4, 2.2]) {
      let label = null;
      for (const f of c.facets()) {
        const seg = contourOf(f, r.floor_z + h);
        if (!seg) continue;
        g += `<line x1="${X(seg[0][0])}" y1="${Y(seg[0][1])}" x2="${X(seg[1][0])}" y2="${Y(seg[1][1])}" stroke="#7c3aed" stroke-dasharray="6 4"/>`;
        label ??= seg[0];
      }
      if (label) g += `<text x="${X(label[0])}" y="${Y(label[1])}" font-size="10" fill="#6d28d9" dx="3" dy="-3">${Math.round(h * 100)}</text>`;
    }
    for (const w of r.roof_windows ?? []) {
      const [x0, y0, x1, y1] = w.plan_rect;
      g += `<rect x="${X(x0)}" y="${Y(y1)}" width="${((x1 - x0) * S).toFixed(1)}" height="${((y1 - y0) * S).toFixed(1)}" fill="#dbeafe" stroke="#2563eb" stroke-dasharray="3 2"/><text x="${X((x0 + x1) / 2)}" y="${Y((y0 + y1) / 2)}" font-size="10" fill="#1d4ed8" text-anchor="middle" dy="4">${esc(w.id)}</text>`;
    }
  }
  // furniture footprints
  for (const it of pkg.interiors.items.filter((i) => rooms.some((r) => r.id === i.room))) {
    const c = cat[it.catalogId]; if (!c) continue;
    const v = (c.variants ?? []).find((x) => x.id === it.variant)?.dimensions ?? {}, d = { ...c.dimensions, ...v, ...(it.dims ?? {}) };
    const a = (it.rot * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), hw = d.w / 2, hd = d.d / 2;
    const corner = (u, w) => [it.x + u * ca - w * sa, it.y + u * sa + w * ca];
    g += `<polygon points="${pts([corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)])}" fill="${c.mount === 'wall' || it.elevation ? '#ede9fe' : '#f3f4f6'}" stroke="#6b7280" stroke-width="0.8"/>`;
    const f = corner(0, hd); g += `<circle cx="${X(f[0])}" cy="${Y(f[1])}" r="2" fill="#6b7280"/>`;
  }
  // doors: leaves and swing arcs
  for (const d of pkg.building.doors.filter((x) => x.level === levelId)) {
    if (d.hinge && d.closedDir && d.openDir) {
      // every leaf open (a double door: both, a bifold: folded) and the swing arcs (core model/doors.ts)
      const leaves = doorLeaves(d, 1);
      for (const l of leaves) g += `<line x1="${X(l.a[0])}" y1="${Y(l.a[1])}" x2="${X(l.b[0])}" y2="${Y(l.b[1])}" stroke="#dc2626" stroke-width="2"/>`;
      for (const arc of swingArcs(d, 16)) g += `<polyline points="${pts(arc)}" fill="none" stroke="#dc2626" stroke-dasharray="4 3"/>`;
      g += `<text x="${X(leaves[0].b[0])}" y="${Y(leaves[0].b[1])}" font-size="11" fill="#b91c1c" dx="4">${esc(d.id)}</text>`;
    } else if (d.slide) {
      const o = d.slide.origin, e = [o[0] + d.slide.dir[0] * d.leafWidth, o[1] + d.slide.dir[1] * d.leafWidth];
      g += `<line x1="${X(o[0])}" y1="${Y(o[1])}" x2="${X(e[0])}" y2="${Y(e[1])}" stroke="#dc2626" stroke-width="3"/><text x="${X(e[0])}" y="${Y(e[1])}" font-size="11" fill="#b91c1c" dx="4">${esc(d.id)} ↔</text>`;
    }
  }
  for (const r of rooms) {
    const [cx, cy] = labelPoint(r.polygon);
    g += `<text x="${X(cx)}" y="${Y(cy)}" font-size="15" font-weight="700" fill="#111827" text-anchor="middle">${esc(r.id)}</text><text x="${X(cx)}" y="${Y(cy)}" dy="17" font-size="12" fill="#374151" text-anchor="middle">${esc(r.name)} · ${r.area} m²${r.area_data !== r.area ? ` (plan ${r.area_data})` : ''}</text>`;
  }
  const title = `${pkg.manifest.name} — ${pkg.building.rooms.levels[levelId]?.name ?? levelId} (${levelId}) · 1 grid = 1 m · +X right, +Y up`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${(H + 28).toFixed(0)}" font-family="DejaVu Sans, Arial, sans-serif"><rect width="100%" height="100%" fill="#f9fafb"/><g transform="translate(0,28)">${g}</g><text x="8" y="19" font-size="14" fill="#111827">${esc(title)}</text></svg>`;
}

/** roof plan: per roof level (lowest first) the facets of the top of the covering, shaded by their slope; the lines where two
 *  planes meet — ridges and hips (dark red), valleys (blue) — and the eaves; dormers, chimneys, roof windows; the walls dashed */
function roofSvg() {
  const roof = B.roof;
  if (!roof?.pieces.length) return null;
  const boxes = roof.pieces.map((p) => regionBox(p.cover)), m = 1;
  const x0 = Math.min(...boxes.map((b) => b[0])) - m, y0 = Math.min(...boxes.map((b) => b[1])) - m, x1 = Math.max(...boxes.map((b) => b[2])) + m, y1 = Math.max(...boxes.map((b) => b[3])) + m;
  const S = Math.min(1600 / (x1 - x0), 1200 / (y1 - y0)), W = (x1 - x0) * S, H = (y1 - y0) * S;
  const X = (x) => ((x - x0) * S).toFixed(1), Y = (y) => ((y1 - y) * S).toFixed(1), pts = (poly) => poly.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
  const same = (a, b) => Math.abs(a.gx - b.gx) < 1e-9 && Math.abs(a.gy - b.gy) < 1e-9 && Math.abs(a.z0 - b.z0) < 1e-6;
  let g = '', top = -Infinity;
  for (let x = Math.ceil(x0); x <= x1; x++) g += `<line x1="${X(x)}" y1="0" x2="${X(x)}" y2="${H}" stroke="#e5e7eb"/><text x="${X(x)}" y="12" font-size="10" fill="#9ca3af" text-anchor="middle">${x}</text>`;
  for (let y = Math.ceil(y0); y <= y1; y++) g += `<line x1="0" y1="${Y(y)}" x2="${W}" y2="${Y(y)}" stroke="#e5e7eb"/><text x="3" y="${Y(y)}" font-size="10" fill="#9ca3af" dy="-2">${y}</text>`;
  const levels = [...roof.levels].sort((a, b) => B.levelById.get(a).floorZ - B.levelById.get(b).floorZ), lines = [];
  for (const level of levels) {
    const s = { pieces: roof.byLevel(level), which: 'cover', lift: roof.thickness };
    const area = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    for (const f of surfaceFacets(s, area)) {
      const p = f.plane, l = Math.hypot(p.gx, p.gy, 1), light = Math.max(0, (p.gx * 0.45 + p.gy * 0.45 + 1 * 0.77) / l), flat = Math.hypot(p.gx, p.gy) < 0.09;
      const c = flat ? [150, 150, 146] : [140, 82, 70], k = 0.55 + 0.6 * light;
      const fill = `rgb(${c.map((v) => Math.min(255, Math.round(v * k))).join(',')})`;
      g += `<polygon points="${pts(f.polygon)}" fill="${fill}" stroke="${fill}" stroke-width="0.6"/>`;
      for (const q of f.polygon) top = Math.max(top, planeZ(p, q[0], q[1]));
      // edges: the eaves (nothing beyond), a crease (another plane beyond) — convex: ridge or hip, concave: valley
      for (let i = 0; i < f.polygon.length; i++) {
        const a = f.polygon[i], b = f.polygon[(i + 1) % f.polygon.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-6) continue;
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], n = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len], q = [mid[0] + n[0] * 1e-3, mid[1] + n[1] * 1e-3], o = surfaceAt(s, q[0], q[1]);
        // a step down to another plane (the eaves of a dormer over the roof) is drawn like the eaves
        if (!o || Math.abs(planeZ(p, mid[0], mid[1]) - planeZ(o.plane, mid[0], mid[1])) > 0.01) lines.push([a, b, '#1f2937', 2]);
        else if (!same(o.plane, p)) lines.push([a, b, planeZ(p, q[0], q[1]) > o.z + 1e-6 ? '#7f1d1d' : '#1d4ed8', 2.2]);
      }
    }
  }
  for (const [a, b, colour, w] of lines) g += `<line x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(b[0])}" y2="${Y(b[1])}" stroke="${colour}" stroke-width="${w}" stroke-linecap="round"/>`;
  // the walls below (outer faces of every level) dashed
  const t = pkg.building.shell?.exteriorWall ?? 0.3;
  for (const r of pkg.building.rooms.rooms) g += `<polygon points="${pts(grow(r.polygon, t))}" fill="none" stroke="#111827" stroke-width="0.8" stroke-dasharray="4 4" opacity="0.5"/>`;
  for (const d of roof.json.dormers ?? []) g += `<rect x="${X(d.rect[0])}" y="${Y(d.rect[3])}" width="${((d.rect[2] - d.rect[0]) * S).toFixed(1)}" height="${((d.rect[3] - d.rect[1]) * S).toFixed(1)}" fill="none" stroke="#f59e0b" stroke-width="2"/><text x="${X((d.rect[0] + d.rect[2]) / 2)}" y="${Y((d.rect[1] + d.rect[3]) / 2)}" font-size="12" fill="#92400e" text-anchor="middle">${esc(d.id)} (${d.type}, ${d.front})</text>`;
  for (const c of roof.json.chimneys ?? []) g += `<rect x="${X(c.rect[0])}" y="${Y(c.rect[3])}" width="${((c.rect[2] - c.rect[0]) * S).toFixed(1)}" height="${((c.rect[3] - c.rect[1]) * S).toFixed(1)}" fill="#6b7280" stroke="#111827"/><text x="${X(c.rect[2])}" y="${Y(c.rect[3])}" font-size="11" fill="#111827" dx="4">${esc(c.id)} ${c.top} m</text>`;
  for (const r of pkg.building.rooms.rooms) for (const w of r.roof_windows ?? []) { const [a, b, c, d] = w.plan_rect; g += `<rect x="${X(a)}" y="${Y(d)}" width="${((c - a) * S).toFixed(1)}" height="${((d - b) * S).toFixed(1)}" fill="#bfdbfe" stroke="#2563eb"/><text x="${X((a + c) / 2)}" y="${Y((b + d) / 2)}" font-size="10" fill="#1d4ed8" text-anchor="middle" dy="4">${esc(w.id)}</text>`; }
  for (const p of roof.json.parts) {
    const poly = p.polygon ?? regionPolygon(p.rect), cx = poly.reduce((u, q) => u + q[0], 0) / poly.length, cy = poly.reduce((u, q) => u + q[1], 0) / poly.length;
    g += `<text x="${X(cx)}" y="${Y(cy)}" font-size="14" font-weight="700" fill="#fff" stroke="#111827" stroke-width="0.4" text-anchor="middle">${esc(p.id)}: ${p.type}${p.pitch !== undefined ? ` ${p.pitch}°` : ''} (${esc(p.level)})</text>`;
  }
  const title = `${pkg.manifest.name} — roof plan · top of the covering ${top.toFixed(2)} m · red lines: ridges and hips, blue: valleys · 1 grid = 1 m`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${(H + 28).toFixed(0)}" font-family="DejaVu Sans, Arial, sans-serif"><rect width="100%" height="100%" fill="#f9fafb"/><g transform="translate(0,28)">${g}</g><text x="8" y="19" font-size="14" fill="#111827">${esc(title)}</text></svg>`;
}

const { browser, renderer } = await launch({ viewport: { width: 1400, height: 900 } });
const written = [];
try {
  const page = await browser.newPage();
  for (const l of pkg.manifest.levels) {
    const svg = planSvg(l.id), m = /width="(\d+)" height="(\d+)"/.exec(svg);
    await page.setViewport({ width: Number(m[1]), height: Number(m[2]) });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    const file = path.join(out, `plan-${l.id}.png`);
    await page.screenshot({ path: file });
    written.push(file);
  }
  const roofPlan = roofSvg();
  if (roofPlan) {
    const m = /width="(\d+)" height="(\d+)"/.exec(roofPlan);
    await page.setViewport({ width: Number(m[1]), height: Number(m[2]) });
    await page.setContent(`<html><body style="margin:0">${roofPlan}</body></html>`);
    await page.screenshot({ path: path.join(out, 'roof.png') });
    written.push(path.join(out, 'roof.png'));
  }
  if (!args.includes('--no-3d')) {
    const port = 4390 + Math.floor(Math.random() * 40), tmp = fs.mkdtempSync(path.join(ROOT, 'reports-preview-'));
    const srv = await startServer({ port, userdata: tmp });
    try {
      const p = await browser.newPage();
      await p.setViewport({ width: 1400, height: 900 });
      const errors = [];
      p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(`${srv.url}/?project=${id}&onboarding=off&lang=en`, { waitUntil: 'domcontentloaded' });
      await waitForApp(p).catch(async () => { throw new Error(`the app did not load the project: ${errors.join(' | ') || (await p.evaluate(() => document.body.innerText.slice(0, 300)))}`); });
      await p.evaluate(() => window.__home.ui({ houseView: 'exterior' }));
      await sleep(4000);
      await p.screenshot({ path: path.join(out, '3d.png') }); written.push(path.join(out, '3d.png'));
      const room = opt('--room');
      if (room) {
        const level = pkg.building.rooms.rooms.find((r) => r.id === room)?.level;
        if (!level) throw new Error(`--room ${room}: no such room`);
        await p.evaluate((r, l) => window.__home.ui({ roomId: r, level: l, section: 'interiors' }), room, level);
        await sleep(3000);
        await p.screenshot({ path: path.join(out, `room-${room}.png`) }); written.push(path.join(out, `room-${room}.png`));
      }
      const vp = opt('--viewpoint');
      if (vp) {
        // eye-level view from a viewpoint of the package (walk start) — shows sloped ceilings, which the cut-away hides
        if (!(pkg.viewpoints ?? []).some((v) => v.id === vp)) throw new Error(`--viewpoint ${vp}: not in project.json viewpoints (${(pkg.viewpoints ?? []).map((v) => v.id).join(', ') || 'none'})`);
        await p.evaluate(() => window.__home.ui({ section: 'building' }));
        await sleep(500);
        await p.click(`[data-testid="viewpoints"] [data-testid="${vp}"]`);
        await sleep(4000);
        await p.screenshot({ path: path.join(out, `view-${vp}.png`) }); written.push(path.join(out, `view-${vp}.png`));
      }
    } finally { srv.stop(); fs.rmSync(tmp, { recursive: true, force: true }); }
  }
} finally { await browser.close(); }
console.log(`preview (${renderer}):\n  ${written.join('\n  ')}`);
