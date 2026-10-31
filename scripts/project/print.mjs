#!/usr/bin/env node
// npm run project:print -- <projects/<id> | plan.json | project.json> --bed "<printer>"|WxD[xH] [options]
// A printable scale model of the building (packages/core/src/print): STL parts — one per level and a removable roof — that fit
// the printer bed, print-report.json (scale, parts, checks, every printability change) and preview-<scale>.png.
//   --bed "K1C" | 220x220[x250]   printer (table in packages/core/src/print/printers.ts) or bed size in mm   (required)
//   --scale auto | 1:N            default auto: the largest standard scale at which every part fits
//   --nozzle 0.4 | 0.6 | resin    print profile (smallest wall, slab, pier, opening) — default 0.4
//   --min-wall <mm>               override the profile's smallest wall
//   --margin <mm>                 kept free on every side of the bed — default 10
//   --eaves keep | trim           trim: cut the eaves and verges at the outer faces of the walls — default keep
//   --joints on | off             registration tabs on the walls and pockets in the part above — default on
//   --scales                      list the standard scales with the size of every part, write nothing
//   --dry-run                     build and check everything, write the report and the preview, no STL
//   --out <dir>                   default projects/<id>/print/1to<N> (git-ignored)
//   --lang en | pl                language of the preview labels — default en
// Exit codes: 0 — written (every part passed its checks), 2 — bad input, 3 — not printable (see the report's problems).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { compilePlan } from '@home-sim/core/authoring/compile';
import { printModel, scaleTable } from '@home-sim/core/print/model';
import { printPreview } from '@home-sim/core/print/preview';
import { parseBed } from '@home-sim/core/print/printers';
import { profileOf } from '@home-sim/core/print/profiles';
import { encodePng } from '@home-sim/core/print/raster';
import { parseScale, scaleLabel, scaleTag } from '@home-sim/core/print/scale';
import { kernelMessage, loadGeometry } from '@home-sim/core/solid/wasm';
import { outOfRange, rangeMessage } from '@home-sim/core/package/range';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const USAGE = 'usage: npm run project:print -- <projects/<id> | plan.json | project.json> --bed "<printer>"|WxD[xH] [--scale auto|1:N] [--nozzle 0.4|0.6|resin] [--min-wall mm] [--margin 10] [--eaves keep|trim] [--joints on|off] [--scales] [--dry-run] [--out DIR] [--lang en|pl]';
const args = process.argv.slice(2).filter((a) => a !== '--');
const fail = (msg) => { console.error(msg); process.exit(2); };
const VALUED = new Set(['--bed', '--scale', '--nozzle', '--min-wall', '--margin', '--eaves', '--joints', '--out', '--lang']);
const opts = {}, positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (VALUED.has(a)) { if (i + 1 >= args.length) fail(`${a} needs a value\n${USAGE}`); opts[a] = args[++i]; }
  else if (a === '--scales' || a === '--dry-run') opts[a] = true;
  else if (a.startsWith('--')) fail(`unknown option ${a}\n${USAGE}`);
  else positional.push(a);
}
if (positional.length !== 1) fail(USAGE);
if (!opts['--bed']) fail(`--bed is required: a printer ("K1C", "Prusa MK4") or the bed size in mm ("220x220x250")\n${USAGE}`);

// ---- input: a project directory, its plan.json, or a project.json
let file = path.resolve(positional[0]);
if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
  const pj = path.join(file, 'project.json'), plan = path.join(file, 'source', 'plan.json');
  file = fs.existsSync(pj) ? pj : fs.existsSync(plan) ? plan : fail(`${positional[0]}: no project.json or source/plan.json`);
}
if (!fs.existsSync(file)) fail(`${positional[0]} not found`);
const bytes = fs.readFileSync(file);
let json;
try { json = JSON.parse(bytes.toString('utf8')); } catch (e) { fail(`${file}: ${e.message}`); }
let data, name;
if (json?.schema === 'home-simulator/plan') {
  const r = compilePlan(json, { catalog: null });
  for (const i of r.issues) if (i.level === 'error') console.log(`  ERROR    [${i.code}] ${i.message}`);
  if (!r.project) fail(`${file}: the plan has errors — fix them first (npm run project:build shows them all)`);
  data = r.project.building; name = r.project.manifest.projectId;
} else if (json?.building?.rooms) {
  data = json.building; name = json.manifest?.projectId ?? path.basename(path.dirname(file));
} else fail(`${file}: neither a plan.json (schema home-simulator/plan) nor a project.json`);
const far = outOfRange({ building: data });
if (far.length) fail(`${file}: ${rangeMessage(far)}`);
const projectDir = path.basename(path.dirname(file)) === 'source' ? path.dirname(path.dirname(file)) : path.dirname(file);

// ---- options
let bed, profile, scale, margin;
try {
  bed = parseBed(opts['--bed']);
  profile = profileOf(opts['--nozzle'] ?? '0.4', opts['--min-wall'] !== undefined ? Number(opts['--min-wall']) : undefined);
  scale = parseScale(opts['--scale']);
  margin = opts['--margin'] !== undefined ? Number(opts['--margin']) : 10;
  if (!(margin >= 0) || 2 * margin >= Math.min(bed.x, bed.y)) throw new Error(`--margin ${opts['--margin']} leaves no room on the bed`);
} catch (e) { fail(e.message); }
const eaves = opts['--eaves'] ?? 'keep';
if (eaves !== 'keep' && eaves !== 'trim') fail(`--eaves must be keep or trim, not ${eaves}`);
const joints = (opts['--joints'] ?? 'on') === 'on';
if (!['on', 'off'].includes(opts['--joints'] ?? 'on')) fail(`--joints must be on or off, not ${opts['--joints']}`);
const lang = opts['--lang'] ?? 'en', dictFile = path.join(ROOT, 'src', 'i18n', lang, 'print.json');
if (!fs.existsSync(dictFile)) fail(`--lang ${lang}: no dictionary src/i18n/${lang}/print.json`);
const dict = JSON.parse(fs.readFileSync(dictFile, 'utf8'));
const labels = Object.fromEntries(Object.entries(dict).filter(([k]) => k.startsWith('print.preview.')).map(([k, v]) => [k.slice('print.preview.'.length), v]));
const bedText = `${bed.name ? `${bed.name}, ` : ''}${bed.x} × ${bed.y}${bed.z ? ` × ${bed.z}` : ''} mm`;
const mm = (s) => s.map((x) => (Math.round(x * 10) / 10).toString()).join(' × ');

const geo = await loadGeometry();
if (opts['--scales']) {
  console.log(`${name}: part sizes on ${bedText} (margin ${margin} mm, ${profile.id})`);
  for (const c of scaleTable(data, geo, { bed, profile, margin, eaves, joints })) {
    console.log(`  ${scaleLabel(c.n).padEnd(6)} ${c.fits ? 'fits    ' : 'too big '} ${c.parts.map((p) => `${p.id} ${mm(p.sizeMm)}${p.fit.rotated ? ' (turned)' : ''}`).join(' · ')}`);
  }
  process.exit(0);
}

// ---- build
const git = (a) => { try { return execFileSync('git', a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
const sha = git(['rev-parse', '--short', 'HEAD']), dirty = git(['status', '--porcelain', '--untracked-files=no']);
const meta = {
  core: JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'core', 'package.json'), 'utf8')).version,
  engine: sha ? `${sha}${dirty ? '+changes' : ''}` : 'unknown',
  input: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
  inputFile: path.relative(process.cwd(), file),
};
const t0 = Date.now();
let m;
try { m = printModel(data, geo, { bed, profile, scale, margin, eaves, joints, name, meta }); } catch (e) { fail(`${file}: ${kernelMessage(e)}`); }
const out = path.resolve(opts['--out'] ?? path.join(projectDir, 'print', m.n ? scaleTag(m.n) : 'no-scale'));
fs.mkdirSync(out, { recursive: true });
// stale parts of an earlier run must not pass for this one
for (const f of fs.readdirSync(out)) if (f.endsWith('.stl') && f.startsWith(`${name}-`)) fs.rmSync(path.join(out, f));
const report = { ...m.report, files: [] };
if (!opts['--dry-run']) for (const p of m.parts) if (p.stl) {
  fs.writeFileSync(path.join(out, p.file), p.stl);
  report.files.push({ file: p.file, bytes: p.stl.length, sha256: crypto.createHash('sha256').update(p.stl).digest('hex') });
}
fs.writeFileSync(path.join(out, 'print-report.json'), JSON.stringify(report, null, 1) + '\n');
const previewFile = m.n && m.parts.length ? `preview-${scaleTag(m.n)}.png` : null;
if (previewFile) fs.writeFileSync(path.join(out, previewFile), encodePng(printPreview(m, { bed, margin, title: name, labels }), (raw) => zlib.deflateSync(raw, { level: 9 })));

// ---- summary
const rel = (p) => path.relative(process.cwd(), p) || '.';
console.log(`${name}: ${m.n ? `${scaleLabel(m.n)} (${m.auto ? 'the largest standard scale that fits' : 'as given'})` : 'no scale fits'} on ${bedText}, margin ${margin} mm, ${profile.label} (${Date.now() - t0} ms)`);
if (m.split) console.log(`  the roof comes off at ${m.split.z.toFixed(2)} m (${m.split.rule === 'eaves' ? 'the bottom of the eaves' : m.split.rule === 'floor' ? '0.3 m above the floor' : m.split.rule === 'wall-top' ? 'the top of the walls' : 'the lowest ceiling'})`);
for (const j of m.joints) console.log(j.made ? `  joint ${j.between.join(' → ')}: ${j.tabs} tabs, ${j.heightMm} mm high, ${j.clearanceMm} mm clearance` : `  no joint ${j.between.join(' → ')}: ${j.reason}`);
for (const p of m.parts) {
  const extra = [p.fit.rotated ? 'turned 90°' : '', p.flipped ? 'upside down' : '', p.overhangs.supports.length ? `${p.overhangs.supports.length} overhang(s) need supports` : '', p.thin.length ? `${p.thin.length} thin spot(s)` : ''].filter(Boolean).join(', ');
  console.log(`  ${p.ok ? 'OK ' : 'ERR'} ${p.id.padEnd(5)} ${mm(p.sizeMm).padEnd(24)} ${String(Math.max(...p.fit.usage)).padStart(5)} % of the bed  ${p.triangles} triangles${extra ? `  — ${extra}` : ''}`);
  for (const x of p.problems) console.log(`        ${x}`);
}
for (const a of m.adjustments) console.log(`  adjusted  ${a.element}: ${a.scaledMm} → ${a.printedMm} mm on the print (${a.rule})`);
for (const n of m.notes) console.log(`  note      ${n.message}`);
for (const x of m.problems) console.log(`  ERROR     ${x}`);
console.log(`  → ${rel(out)}/: ${opts['--dry-run'] ? 'dry run, no STL' : `${report.files.length} STL`}, print-report.json${previewFile ? `, ${previewFile}` : ''}`);
process.exit(m.ok ? 0 : 3);
