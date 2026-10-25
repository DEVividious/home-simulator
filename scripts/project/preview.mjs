#!/usr/bin/env node
// npm run project:preview -- projects/<id> [--room <roomId>] [--no-3d]
// Preview images of a project package for checking it against its source drawing (ADR 0015):
//   projects/<id>/preview/plan-<level>.png  top-down plan drawn from project.json: rooms (id, name, area), wall mass between
//                                           rooms, door gaps with swing arcs, windows, stairs, furniture footprints, 1 m grid
//   projects/<id>/preview/3d.png            the app's start view (headless Chrome, generated shell or model)
//   projects/<id>/preview/room-<id>.png     with --room: the room in the app
import fs from 'node:fs';
import path from 'node:path';
import { launch, ROOT, sleep, startServer, waitForApp } from '../verify/browser.mjs';

const args = process.argv.slice(2).filter((a) => a !== '--'), dir = args.find((a) => !a.startsWith('--'));
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
if (!dir) { console.error('usage: npm run project:preview -- projects/<id> [--room <roomId>] [--no-3d]'); process.exit(2); }
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
const id = pkg.manifest.projectId, out = path.join(dir, 'preview');
fs.mkdirSync(out, { recursive: true });
const cat = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/furnitureCatalog.json'), 'utf8')).items.map((i) => [i.id, i]));

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
  // wall mass: bounding box of the level minus rooms (exterior wall thickness around)
  const bx0 = Math.min(...xs) - ext, by0 = Math.min(...ys) - ext, bx1 = Math.max(...xs) + ext, by1 = Math.max(...ys) + ext;
  g += `<rect x="${X(bx0)}" y="${Y(by1)}" width="${((bx1 - bx0) * S).toFixed(1)}" height="${((by1 - by0) * S).toFixed(1)}" fill="#374151"/>`;
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
  // stairs
  for (const s of pkg.building.stairs ?? []) if (s.fromLevel === levelId || s.toLevel === levelId) {
    const [sx0, sy0, sx1, sy1] = s.bbox;
    g += `<rect x="${X(sx0)}" y="${Y(sy1)}" width="${((sx1 - sx0) * S).toFixed(1)}" height="${((sy1 - sy0) * S).toFixed(1)}" fill="#fef3c7" stroke="#b45309"/>`;
    for (let i = 1; i < s.risers; i++) { const y = sy1 - i * s.tread; g += `<line x1="${X(sx0)}" y1="${Y(y)}" x2="${X(sx1)}" y2="${Y(y)}" stroke="#d97706" stroke-width="0.7"/>`; }
    g += `<line x1="${X(s.split)}" y1="${Y(sy0)}" x2="${X(s.split)}" y2="${Y(sy1)}" stroke="#b45309"/><text x="${X((sx0 + sx1) / 2)}" y="${Y(s.landingEdge / 2 + sy0 / 2)}" font-size="12" fill="#92400e" text-anchor="middle">${esc(s.id)} ↑ ${s.fromLevel === levelId ? 'up' : 'down'}</text>`;
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
    const cx = r.polygon.reduce((s, p) => s + p[0], 0) / r.polygon.length, cy = r.polygon.reduce((s, p) => s + p[1], 0) / r.polygon.length;
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
        await p.evaluate((r) => { const s = window.__home.state(); window.__home.ui({ roomId: r, level: s.level, section: 'interiors' }); }, room);
        await sleep(3000);
        await p.screenshot({ path: path.join(out, `room-${room}.png`) }); written.push(path.join(out, `room-${room}.png`));
      }
    } finally { srv.stop(); fs.rmSync(tmp, { recursive: true, force: true }); }
  }
} finally { await browser.close(); }
console.log(`preview (${renderer}):\n  ${written.join('\n  ')}`);
