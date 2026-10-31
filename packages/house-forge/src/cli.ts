#!/usr/bin/env node
// house-forge: floor plan, PDF sheet or CAD drawing → plan.json → a printable STL scale model (ADR 0033, 0034). The geometry
// is the Home Simulator core (@home-sim/core) — the same code as the app and the repository's CLIs; the import tools are the
// repository's Python tools, run through uv. Bundled by scripts/plugin/build.mjs into the plugin's scripts/house-forge.mjs;
// in this repository `node packages/house-forge/src/cli.ts …` runs the same commands from source.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { building, roomsOfLevel } from '@home-sim/core/model/building';
import { ProjectSchema } from '@home-sim/core/package/schema';
import { exteriorImage } from '@home-sim/core/preview/exterior';
import { planImage, roofImage } from '@home-sim/core/preview/plan';
import { findPrinters, PRINTERS, printerName } from '@home-sim/core/print/printers';
import { encodePng } from '@home-sim/core/print/raster';
import { roofBounds } from '@home-sim/core/solid/roofSolid';
import { geometry, loadPlan, rel, UsageError, type Opts } from './common.ts';
import { LANGS, planLabels } from './labels.ts';
import { PRINT_HELP, printCommand } from './print.ts';
import { capturePython, runPython, toolsScript, UV_INSTALL, versionOf } from './python.ts';
import { VERSION } from './version.ts';
import { workspace } from './workspace.ts';

const HELP = `house-forge ${VERSION.version} (engine ${VERSION.engine}) — a floor plan into a 3D-printable scale model

usage: house-forge <command> [options]        (house-forge <command> --help for its options)

  doctor                               Node, uv, the Python tools and their libraries, ODA File Converter (DWG only)
  paths --name <name>                  where the files of a house go (plan.json, inputs, previews, builds)
  intake <file>… [--name <name>]       what each file is and which branch reads it; with --name copies them to source/inputs/
  image prepare|calibrate …            raster plans: a labelled pixel grid and close-ups; the scale from several estimates
  pdf text|svg|arcs|render …           vector PDF sheets: words, areas, scale, roof facts; paths; door swings; a page as PNG
  cad inspect|walls|dwg2dxf …          DXF layers and texts; walls and room candidates in metres; DWG → DXF (ODA)
  compile --name <name>                plan.json → project.json, with errors, warnings and what the plan says
  preview --name <name> [--lang pl]    plan-<level>.png, roof.png and 3d.png in previews/ (no browser needed)
  printers ["<phrase>"]                printers and their bed sizes
  print --name <name> --bed <printer>  the printable model: --scales, --dry-run (approval card), then the build

Files go to ./house-forge-output/<name>/ (--output-dir to change). Exit codes: 0 — done, 2 — bad input, 3 — not printable.`;

const COMMAND_HELP: Record<string, string> = {
  doctor: 'house-forge doctor\n\nChecks Node, uv (installs the locked Python libraries on its first run — needs network once), the Python tools and the\nODA File Converter (only for DWG drawings).',
  paths: 'house-forge paths --name <name> [--output-dir <dir>]\n\nThe workspace of a house: plan.json to write, inputs/, the previews and builds directories.',
  intake: 'house-forge intake <file>… [--name <name>] [--json] [--output-dir <dir>]\n\nClassifies each file (dwg / dxf / vector or raster PDF / image / room list) and names the branch that reads it. With --name the\nfiles are copied to house-forge-output/<name>/source/inputs/ (the originals are never changed).',
  compile: 'house-forge compile --name <name> [--output-dir <dir>]\n\nCompiles house-forge-output/<name>/source/plan.json into project.json: every adjustment, warning and error, then what the\nplan says (levels, rooms with their areas against the printed ones, openings, stairs, the roof). Exit 2 on errors.',
  preview: 'house-forge preview --name <name> [--level <id>] [--lang en|pl] [--output-dir <dir>]\n\nDraws previews/plan-<level>.png (rooms with id, name and area, walls, doors with swings, windows, stairs, the 140 / 220 lines\nunder the roof, 1 m grid), roof.png (planes, ridges, hips, valleys, dormers, chimneys, roof windows) and 3d.png (the\nbuilding from two corners).',
  printers: 'house-forge printers ["<phrase>"]\n\nPrinters whose maker and model contain every word of the phrase (all without one), with the bed X × Y × Z in mm. A model named\nexactly wins ("k1" is the Creality K1). Not listed: give the bed as --bed WxD or WxDxH.',
  print: PRINT_HELP,
};

const PY_TOOLS: Record<string, string[]> = { image: ['prepare', 'calibrate'], pdf: ['text', 'svg', 'arcs', 'render'], cad: ['inspect', 'walls', 'dwg2dxf'] };
const VALUED = new Set(['--name', '--output-dir', '--bed', '--scale', '--nozzle', '--min-wall', '--margin', '--eaves', '--joints', '--lang', '--from', '--level']);
const FLAGS = new Set(['--help', '-h', '--json', '--scales', '--dry-run', '--details', '--new-version']);

function parse(args: string[]): { opts: Opts; positional: string[] } {
  const opts: Opts = {}, positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (VALUED.has(a)) { if (i + 1 >= args.length) throw new UsageError(`${a} needs a value`); opts[a] = args[++i]; }
    else if (FLAGS.has(a)) opts[a === '-h' ? '--help' : a] = true;
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a} (house-forge <command> --help)`);
    else positional.push(a);
  }
  return { opts, positional };
}

const png = (img: Parameters<typeof encodePng>[0]) => encodePng(img, (raw) => zlib.deflateSync(raw, { level: 9 }));
const fmt = (x: number) => (Math.round(x * 100) / 100).toString();

function doctor(): number {
  const ok = (s: string) => console.log(`  ✓ ${s}`), no = (s: string, fix: string) => console.log(`  ✗ ${s} — ${fix}`);
  let bad = 0;
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) ok(`node ${process.versions.node}`); else { bad++; no(`node ${process.versions.node}`, 'install Node.js 20 or newer'); }
  ok(`house-forge ${VERSION.version} (core ${VERSION.core}, engine ${VERSION.engine})`);
  const uv = versionOf('uv');
  if (process.env.HOUSE_FORGE_PYTHON) ok(`python tools with ${process.env.HOUSE_FORGE_PYTHON} (HOUSE_FORGE_PYTHON)`);
  else if (uv) ok(uv); else { bad++; no('uv', `install it: ${UV_INSTALL} (needed for plan images, PDF and CAD; then open a new terminal)`); }
  if (uv || process.env.HOUSE_FORGE_PYTHON) {
    const r = capturePython(['doctor']);
    process.stdout.write(r.stdout.split('\n').filter(Boolean).map((l) => `  ${l.trim()}`).join('\n') + '\n');
    if (r.status !== 0) { bad++; no('python tools', (r.stderr.trim().split('\n').pop() ?? '') || 'see above'); }
  }
  const oda = process.env.ODA_FILE_CONVERTER;
  if (oda && fs.existsSync(oda)) ok(`ODA File Converter (${oda})`);
  else if (versionOf('ODAFileConverter', ['--help']) !== null) ok('ODA File Converter');
  else console.log('  – ODA File Converter not found — only DWG drawings need it (free from opendesign.com; set ODA_FILE_CONVERTER=/path)');
  console.log(`  tools: ${rel(toolsScript())}`);
  return bad ? 1 : 0;
}

function paths(o: Opts): number {
  const ws = workspace(String(o['--name'] ?? ''), o['--output-dir'] as string | undefined);
  const lines: [string, string][] = [
    ['workspace', ws.dir], ['plan', ws.plan], ['inputs', ws.inputs], ['prep', path.join(ws.source, 'prep')], ['calibration', path.join(ws.source, 'calibration.json')],
    ['pdf', path.join(ws.source, 'pdf')], ['cad', path.join(ws.source, 'cad')], ['project', ws.project], ['previews', ws.previews], ['builds', ws.builds],
  ];
  for (const [k, v] of lines) console.log(`${k.padEnd(12)} ${rel(v)}${fs.existsSync(v) ? '' : '   (not yet)'}`);
  return 0;
}

function intake(o: Opts, files: string[]): number {
  if (!files.length) throw new UsageError(COMMAND_HELP.intake);
  const code = runPython(['intake', ...files, ...(o['--json'] ? ['--json'] : [])]);
  if (code !== 0 || !o['--name']) return code;
  const ws = workspace(String(o['--name']), o['--output-dir'] as string | undefined);
  fs.mkdirSync(ws.inputs, { recursive: true });
  for (const f of files) {
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) continue;
    const dst = path.join(ws.inputs, path.basename(f));
    if (path.resolve(f) !== dst) fs.copyFileSync(f, dst);
    console.log(`copied → ${rel(dst)}`);
  }
  return 0;
}

function compile(o: Opts): number {
  const ws = workspace(String(o['--name'] ?? ''), o['--output-dir'] as string | undefined);
  const plan = loadPlan(ws);
  if (!plan) return 2;
  const check = ProjectSchema.safeParse(plan.project);
  if (!check.success) {
    for (const i of check.error.issues.slice(0, 20)) console.log(`  ERROR    [package] ${i.path.join('.')}: ${i.message}`);
    return 2;
  }
  fs.writeFileSync(ws.project, JSON.stringify(plan.project, null, 1) + '\n');
  const raw = JSON.parse(plan.bytes.toString('utf8')) as { roof?: { ridgeHeight?: number; parts?: { id: string; type: string; level: string; pitch?: number; knee?: number; lines?: unknown[] }[]; dormers?: unknown[]; chimneys?: unknown[] }; levels?: { id: string; slope?: unknown }[] };
  const b = building(plan.data), rooms = plan.data.rooms.rooms;
  console.log(`\n## ${plan.id}: what the plan says\n`);
  for (const l of b.levels) {
    const rs = roomsOfLevel(b, l.id), area = rs.reduce((s, r) => s + r.area, 0);
    console.log(`- ${l.name} (${l.id}), floor at ${fmt(l.floorZ)} m: ${rs.length} room(s), ${fmt(area)} m²`);
    for (const r of rs) {
      const src = rooms.find((x) => x.id === r.id)!;
      const under = r.ceiling.kind === 'roof' ? (() => { const [lo, hi] = r.ceiling.range(); return `, under the roof ${fmt(lo)}–${fmt(hi)} m`; })() : `, ceiling ${fmt(r.ceiling.flatZ - r.floorZ)} m`;
      console.log(`  - ${r.id} ${r.name} (${r.kind}): ${fmt(r.area)} m²${src.area_data !== src.area ? ` — on the drawing ${fmt(src.area_data)} m² (${src.area_data ? `${Math.round(((src.area - src.area_data) / src.area_data) * 100)} %` : ''})` : ''}${under}`);
    }
  }
  const doors = plan.data.doors.length, windows = rooms.reduce((s, r) => s + r.openings.length, 0), stairs = b.stairs.map((s) => `${s.id} ${s.kind} ${s.fromLevel} → ${s.toLevel}`);
  console.log(`- Openings: ${doors} door(s), ${windows} window(s) (counted per room)${stairs.length ? `; stairs ${stairs.join(', ')}` : ''}`);
  if (raw.roof?.parts?.length) {
    const top = roofBounds(b)?.max[2];
    for (const p of raw.roof.parts) console.log(`- Roof part ${p.id}: ${p.type}${p.pitch !== undefined ? ` ${p.pitch}°` : ''} over ${p.level}${p.knee !== undefined ? `, knee wall ${p.knee} m` : p.lines ? ', from the 140 / 220 lines' : ', resting on the ceiling'}`);
    console.log(`- Roof top ${top !== undefined ? `${fmt(top)} m` : '—'}${raw.roof.ridgeHeight !== undefined ? ` (drawing: ridge ${raw.roof.ridgeHeight} m)` : ''}; ${raw.roof.dormers?.length ?? 0} dormer(s), ${raw.roof.chimneys?.length ?? 0} chimney(s), ${rooms.reduce((s, r) => s + r.roof_windows.length, 0)} roof window(s)`);
  } else if (b.roof) console.log(`- Roof: one gable from the level slope (${raw.levels?.filter((l) => l.slope).map((l) => l.id).join(', ')})`);
  else console.log('- Roof: none — the top level is closed by a flat slab');
  console.log(`\n${rel(ws.project)}: written, ${plan.warnings} warning(s)`);
  return 0;
}

async function preview(o: Opts): Promise<number> {
  const ws = workspace(String(o['--name'] ?? ''), o['--output-dir'] as string | undefined);
  const lang = (o['--lang'] as string | undefined) ?? 'en';
  if (!LANGS.includes(lang)) throw new UsageError(`--lang ${lang}: one of ${LANGS.join(', ')}`);
  const plan = loadPlan(ws, { quiet: true });
  if (!plan) return 2;
  fs.mkdirSync(ws.previews, { recursive: true });
  const name = plan.project.manifest.name, labels = planLabels(lang), written: string[] = [];
  const levels = Object.keys(plan.data.rooms.levels).filter((l) => !o['--level'] || l === o['--level']);
  if (!levels.length) throw new UsageError(`--level ${o['--level']}: no such level (${Object.keys(plan.data.rooms.levels).join(', ')})`);
  for (const l of levels) {
    const f = path.join(ws.previews, `plan-${l}.png`);
    fs.writeFileSync(f, png(planImage(plan.data, l, { name, labels })));
    written.push(f);
  }
  if (!o['--level']) {
    const roof = roofImage(plan.data, { name, labels });
    const rf = path.join(ws.previews, 'roof.png');
    if (roof) { fs.writeFileSync(rf, png(roof)); written.push(rf); } else if (fs.existsSync(rf)) fs.rmSync(rf);
    const f = path.join(ws.previews, '3d.png');
    fs.writeFileSync(f, png(exteriorImage(await geometry(), plan.data, { title: name })));
    written.push(f);
  }
  console.log(`${plan.id}: previews\n${written.map((f) => `  ${rel(f)}`).join('\n')}`);
  return 0;
}

function printers(phrase: string | undefined): number {
  const list = phrase ? findPrinters(phrase) : [...PRINTERS];
  if (!list.length) {
    console.log(`no printer matches "${phrase}" — ask for the bed size (manual or slicer profile) and give it as --bed WIDTHxDEPTH[xHEIGHT] in mm`);
    return 1;
  }
  for (const p of list) console.log(`${printerName(p).padEnd(28)} ${p.x} × ${p.y} × ${p.z} mm${p.note ? `   (${p.note})` : ''}`);
  if (phrase && list.length === 1) console.log(`→ --bed "${printerName(list[0])}"`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return 0; }
  if (cmd === '--version') { console.log(`house-forge ${VERSION.version} (core ${VERSION.core}, engine ${VERSION.engine})`); return 0; }
  if (PY_TOOLS[cmd]) {
    const tool = rest[0];
    if (!tool || tool === '--help' || tool === '-h' || !PY_TOOLS[cmd].includes(tool)) {
      console.log(`usage: house-forge ${cmd} ${PY_TOOLS[cmd].join('|')} …   (house-forge ${cmd} <tool> --help for its options)`);
      return tool && !['--help', '-h'].includes(tool) ? 2 : 0;
    }
    return runPython([cmd, ...rest]);
  }
  if (!(cmd in COMMAND_HELP)) throw new UsageError(`unknown command "${cmd}"\n\n${HELP}`);
  if (cmd === 'intake') {
    // intake passes the files through; its own options are --name, --json and --output-dir
    const { opts, positional } = parse(rest);
    if (opts['--help']) { console.log(COMMAND_HELP.intake); return 0; }
    return intake(opts, positional);
  }
  const { opts, positional } = parse(rest);
  if (opts['--help']) { console.log(COMMAND_HELP[cmd]); return 0; }
  switch (cmd) {
    case 'doctor': return doctor();
    case 'paths': return paths(opts);
    case 'compile': return compile(opts);
    case 'preview': return preview(opts);
    case 'printers': return printers(positional.join(' ') || undefined);
    case 'print': return printCommand(opts);
  }
  return 2;
}

const entry = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
if (entry && fs.realpathSync(fileURLToPath(import.meta.url)) === entry) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e: unknown) => {
    if (e instanceof UsageError) console.error(e.message);
    else console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.exit(2);
  });
}
