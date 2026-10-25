#!/usr/bin/env node
// npm run project:preview -- projects/<id> [--room <roomId>] [--viewpoint <id>] [--no-3d]
// Preview images of a project package for checking it against its source drawing:
//   projects/<id>/preview/plan-<level>.png  top-down plan drawn from project.json: rooms (id, name, area), wall mass between
//                                           rooms, door gaps with swing arcs, windows, stairs, furniture footprints, 1 m grid,
//                                           attic height lines (140 / 220 cm) and roof windows
//   projects/<id>/preview/3d.png            the app's start view (headless Chrome, generated shell or model)
//   projects/<id>/preview/room-<id>.png     with --room: the room in the app (cut-away from above)
//   projects/<id>/preview/view-<id>.png     with --viewpoint: eye level from a package viewpoint (sloped ceilings, heights)
import fs from 'node:fs';
import path from 'node:path';
import { launch, ROOT, sleep, startServer, waitForApp } from '../verify/browser.mjs';

const args = process.argv.slice(2).filter((a) => a !== '--'), dir = args.find((a) => !a.startsWith('--'));
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
if (!dir) { console.error('usage: npm run project:preview -- projects/<id> [--room <roomId>] [--viewpoint <id>] [--no-3d]'); process.exit(2); }
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
const id = pkg.manifest.projectId, out = path.join(dir, 'preview');
fs.mkdirSync(out, { recursive: true });
const cat = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/furnitureCatalog.json'), 'utf8')).items.map((i) => [i.id, i]));

/** orthogonal outline (counter-clockwise or not) grown outwards by d — each vertex moves along both adjacent edge normals */
function grow(poly, d) {
  const n = poly.length, area2 = poly.reduce((s, a, i) => { const b = poly[(i + 1) % n]; return s + a[0] * b[1] - b[0] * a[1]; }, 0), k = area2 >= 0 ? 1 : -1;
  const normal = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [(k * dy) / l, (-k * dx) / l]; };
  return poly.map((p, i) => { const n0 = normal(poly[(i - 1 + n) % n], p), n1 = normal(p, poly[(i + 1) % n]); return [p[0] + d * (n0[0] + n1[0]), p[1] + d * (n0[1] + n1[1])]; });
}
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
      const [a, b] = d.across;
      const poly = d.along === 'X' ? [[d.from_, a], [d.to, a], [d.to, b], [d.from_, b]] : [[a, d.from_], [b, d.from_], [b, d.to], [a, d.to]];
      g += `<polygon points="${pts(poly)}" fill="#ffffff"/>`;
    }
    for (const w of r.openings) {
      const t = 0.18, inner = w.inner, out = r.polygon.some((p) => (w.plane_axis === 'Y' ? p[1] : p[0]) > inner + 0.01) ? -1 : 1;
      const poly = w.plane_axis === 'Y' ? [[w.from_, inner], [w.to, inner], [w.to, inner + out * t], [w.from_, inner + out * t]] : [[inner, w.from_], [inner, w.to], [inner + out * t, w.to], [inner + out * t, w.from_]];
      g += `<polygon points="${pts(poly)}" fill="${w.sill_z < 0.05 ? '#93c5fd' : '#bfdbfe'}" stroke="#2563eb"/><text x="${X(w.plane_axis === 'Y' ? (w.from_ + w.to) / 2 : inner)}" y="${Y(w.plane_axis === 'Y' ? inner : (w.from_ + w.to) / 2)}" font-size="11" fill="#1d4ed8" text-anchor="middle" dy="${out > 0 ? -4 : 12}">${esc(w.id)}</text>`;
    }
  }
  // stairs: tread lines of both flights and an arrow up the lower flight, drawn in the canonical frame and turned / mirrored
  // onto the plan like src/home/model/stairs.ts stairFrame
  for (const s of pkg.building.stairs ?? []) if (s.fromLevel === levelId || s.toLevel === levelId) {
    const [sx0, sy0, sx1, sy1] = s.bbox, r = s.orient?.rotate ?? 0, mir = !!s.orient?.mirror;
    const [cw, cd] = r % 180 ? [sy1 - sy0, sx1 - sx0] : [sx1 - sx0, sy1 - sy0];
    const W = ([qx, qy]) => { const cx = mir ? cw - (qx - sx0) : qx - sx0, cy = qy - sy0; const [ux, uy] = r === 0 ? [cx, cy] : r === 90 ? [cd - cy, cx] : r === 180 ? [cw - cx, cd - cy] : [cy, cw - cx]; return [sx0 + ux, sy0 + uy]; };
    const line = (a, b, attr) => { const p = W(a), q = W(b); return `<line x1="${X(p[0])}" y1="${Y(p[1])}" x2="${X(q[0])}" y2="${Y(q[1])}" ${attr}/>`; };
    const cx1 = sx0 + cw, cy1 = sy0 + cd, le = s.landingEdge, T = s.tread;
    g += `<rect x="${X(sx0)}" y="${Y(sy1)}" width="${((sx1 - sx0) * S).toFixed(1)}" height="${((sy1 - sy0) * S).toFixed(1)}" fill="#fef3c7" stroke="#b45309"/>`;
    for (let i = 1; i < s.risers; i++) {
      g += line([s.split, cy1 - i * T], [cx1, cy1 - i * T], 'stroke="#d97706" stroke-width="0.7"');
      g += line([sx0, le + (i - 1) * T], [s.split, le + (i - 1) * T], 'stroke="#d97706" stroke-width="0.7"');
    }
    g += line([s.split, le], [s.split, cy1], 'stroke="#b45309"');
    const mid = (s.split + cx1) / 2;
    g += line([mid, cy1 - 0.1], [mid, le + 0.15], 'stroke="#92400e" stroke-width="2"');
    const tip = W([mid, le + 0.05]), l1 = W([mid - 0.12, le + 0.25]), l2 = W([mid + 0.12, le + 0.25]), lab = W([(sx0 + s.split) / 2, (le + cy1) / 2]);
    g += `<polygon points="${pts([tip, l1, l2])}" fill="#92400e"/><text x="${X(lab[0])}" y="${Y(lab[1])}" font-size="12" fill="#92400e" text-anchor="middle">${esc(s.id)} ${s.fromLevel === levelId ? 'up' : 'down'}</text>`;
  }
  // sloped ceilings: the 1.40 m and 2.20 m height lines (as attic plans draw them); roof windows
  for (const r of rooms) {
    const c = r.ceiling, [bx0, by0, bx1, by1] = r.bbox;
    if (c?.kind === 'attic') for (const h of [1.4, 2.2]) {
      // height above the floor: min(flat, z_at_ridge − slope·|d|) − floor → |d| where it equals h
      const d = (c.z_at_ridge - (r.floor_z + h)) / c.slope;
      if (!(d > 0) || r.floor_z + h >= c.flat_z) continue;
      for (const sgn of [-1, 1]) {
        const v = (c.ridge_y ?? c.ridge_x) + sgn * d, alongX = c.ridge_y !== undefined && c.ridge_y !== null;
        if (alongX ? v <= by0 || v >= by1 : v <= bx0 || v >= bx1) continue;
        const [a1, b1] = alongX ? [[bx0, v], [bx1, v]] : [[v, by0], [v, by1]];
        g += `<line x1="${X(a1[0])}" y1="${Y(a1[1])}" x2="${X(b1[0])}" y2="${Y(b1[1])}" stroke="#7c3aed" stroke-dasharray="6 4"/><text x="${X(a1[0])}" y="${Y(a1[1])}" font-size="10" fill="#6d28d9" dx="3" dy="${alongX ? -3 : 12}">${Math.round(h * 100)}</text>`;
      }
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
      const L = d.leafWidth, h = d.hinge, c = [h[0] + d.closedDir[0] * L, h[1] + d.closedDir[1] * L], o = [h[0] + d.openDir[0] * L, h[1] + d.openDir[1] * L];
      const sweep = (d.closedDir[0] * d.openDir[1] - d.closedDir[1] * d.openDir[0]) > 0 ? 0 : 1;
      g += `<line x1="${X(h[0])}" y1="${Y(h[1])}" x2="${X(o[0])}" y2="${Y(o[1])}" stroke="#dc2626" stroke-width="2"/><path d="M ${X(c[0])} ${Y(c[1])} A ${(L * S).toFixed(1)} ${(L * S).toFixed(1)} 0 0 ${sweep} ${X(o[0])} ${Y(o[1])}" fill="none" stroke="#dc2626" stroke-dasharray="4 3"/>`;
      g += `<text x="${X(o[0])}" y="${Y(o[1])}" font-size="11" fill="#b91c1c" dx="4">${esc(d.id)}</text>`;
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
