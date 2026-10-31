// house-forge print: the printable scale model of a workspace's plan (the core's printModel — the same STL bytes as the
// repository's npm run project:print for the same plan and settings). --scales lists the scales, --dry-run builds and checks
// everything and prints the approval card with a preview, without STL; the build writes a new version of the build directory
// (or says that one with identical settings exists) and prints the report.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { BuildingData } from '@home-sim/core/model/building';
import { printModel, scaleTable, type PrintModel } from '@home-sim/core/print/model';
import { printPreview } from '@home-sim/core/print/preview';
import { parseBed, type Bed } from '@home-sim/core/print/printers';
import { profileOf, type PrintProfile } from '@home-sim/core/print/profiles';
import { encodePng } from '@home-sim/core/print/raster';
import { parseScale, scaleLabel, scaleTag } from '@home-sim/core/print/scale';
import { geometry, loadPlan, rel, UsageError, type Opts } from './common.ts';
import { LANGS, printLabels } from './labels.ts';
import { VERSION } from './version.ts';
import { buildSlot, fromBuild, workspace, type BuildRecord, type BuildSettings, type Workspace } from './workspace.ts';

const png = (img: Parameters<typeof encodePng>[0]) => encodePng(img, (raw) => zlib.deflateSync(raw, { level: 9 }));
const sha256 = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');
const mm = (s: number[]) => s.map((x) => (Math.round(x * 10) / 10).toString()).join(' × ');
const SPLIT_RULE = { eaves: 'the bottom of the eaves', floor: '0.3 m above the floor', 'wall-top': 'the top of the walls', ceiling: 'the lowest ceiling' } as const;

export const PRINT_HELP = `house-forge print --name <name> --bed "<printer>"|WxD[xH] [options]
house-forge print --from <house-forge-output/<name>/builds/1to<N>-v<K>> [options to change]

The printable scale model of the plan in house-forge-output/<name>/source/plan.json: one STL part per level and a removable roof,
checked (watertight, one solid, read back) and fitted on the bed.
  --bed "K1C" | 220x220[x250]   printer (house-forge printers "<phrase>") or bed size in mm          (required)
  --scale auto | 1:N            default auto: the largest standard scale at which every part fits
  --nozzle 0.4 | 0.6 | resin    print profile (smallest wall, slab, pier, opening) — default 0.4
  --min-wall <mm>               override the profile's smallest wall
  --margin <mm>                 kept free on every side of the bed — default 10
  --eaves keep | trim           trim: cut the eaves and verges at the outer faces of the walls — default keep
  --scales                      list the standard scales with the size of every part, write nothing
  --dry-run                     build and check, write dry-run.json and a preview, print the approval card — no STL
  --details                     with the card: every printability change, note and overhang
  --new-version                 build again into a new version even if identical settings were built
  --lang en | pl                language of the preview labels — default en
  --output-dir <dir>            workspace root — default ./house-forge-output
Exit codes: 0 — done, 2 — bad input, 3 — not printable (the card or report says why).`;

function settingsFrom(o: Opts, base?: BuildSettings): BuildSettings {
  const num = (k: string) => (o[k] !== undefined ? Number(o[k]) : undefined);
  const s: BuildSettings = {
    bed: (o['--bed'] as string | undefined) ?? base?.bed ?? '',
    scale: (o['--scale'] as string | undefined) ?? base?.scale ?? 'auto',
    nozzle: (o['--nozzle'] as string | undefined) ?? base?.nozzle ?? '0.4',
    minWall: num('--min-wall') ?? base?.minWall ?? null,
    margin: num('--margin') ?? base?.margin ?? 10,
    eaves: ((o['--eaves'] as string | undefined) ?? base?.eaves ?? 'keep') as BuildSettings['eaves'],
    lang: (o['--lang'] as string | undefined) ?? base?.lang ?? 'en',
  };
  if (!s.bed) throw new UsageError(`--bed is required: a printer ("K1C", "Prusa MK4") or the bed size in mm ("220x220x250")\n\n${PRINT_HELP}`);
  if (s.eaves !== 'keep' && s.eaves !== 'trim') throw new UsageError(`--eaves must be keep or trim, not ${s.eaves}`);
  if (!LANGS.includes(s.lang)) throw new UsageError(`--lang ${s.lang}: one of ${LANGS.join(', ')}`);
  return s;
}

interface Parsed { bed: Bed; profile: PrintProfile; scale: number | null; margin: number }
function parseSettings(s: BuildSettings): Parsed {
  try {
    const bed = parseBed(s.bed), profile = profileOf(s.nozzle, s.minWall ?? undefined), scale = parseScale(s.scale === 'auto' ? undefined : s.scale);
    if (!(s.margin >= 0) || 2 * s.margin >= Math.min(bed.x, bed.y)) throw new Error(`--margin ${s.margin} leaves no room on the bed`);
    return { bed, profile, scale, margin: s.margin };
  } catch (e) { throw new UsageError((e as Error).message); }
}

/** the command line that builds with these settings (the card's build command) */
function buildCommand(ws: Workspace, s: BuildSettings, outputDir: string | undefined): string {
  const q = (v: string) => (/^[\w.:/@+-]+$/.test(v) ? v : `"${v.replace(/(["\\$`])/g, '\\$1')}"`);
  const a = [`node ${q(process.argv[1])} print --name ${ws.name} --bed ${q(s.bed)}`];
  if (s.scale !== 'auto') a.push(`--scale ${s.scale}`);
  if (s.nozzle !== '0.4') a.push(`--nozzle ${s.nozzle}`);
  if (s.minWall !== null) a.push(`--min-wall ${s.minWall}`);
  if (s.margin !== 10) a.push(`--margin ${s.margin}`);
  if (s.eaves !== 'keep') a.push(`--eaves ${s.eaves}`);
  if (s.lang !== 'en') a.push(`--lang ${s.lang}`);
  if (outputDir) a.push(`--output-dir ${q(outputDir)}`);
  return a.join(' ');
}

function bedText(b: Bed): string { return `${b.name ? `${b.name}, bed ` : 'bed '}${b.x} × ${b.y}${b.z ? ` × ${b.z}` : ''} mm`; }

function partLines(m: PrintModel): string[] {
  return m.parts.map((p) => {
    const extra = [p.fit.rotated ? 'turned 90°' : '', p.flipped ? 'upside down' : '', p.overhangs.supports.length ? `${p.overhangs.supports.length} overhang(s) need supports` : ''].filter(Boolean);
    return `  - ${p.kind === 'roof' ? 'Roof' : `${p.id} ${p.title}`}: ${mm(p.sizeMm)} mm, ${Math.max(...p.fit.usage)} % of the bed${extra.length ? `, ${extra.join(', ')}` : ''}${p.ok ? '' : ` — NOT PRINTABLE: ${p.problems.join('; ')}`}`;
  });
}

function facts(m: PrintModel, p: Parsed, details: boolean): string[] {
  const out: string[] = [];
  out.push(`- Scale ${scaleLabel(m.n!)} — ${m.auto ? 'the largest standard scale at which every part fits' : 'as given'}`);
  out.push(`- Printer: ${bedText(p.bed)}, ${p.margin} mm margin`);
  out.push(`- ${m.parts.length} part(s), each printed on its own:`, ...partLines(m));
  if (m.split) out.push(`- The roof comes off at ${m.split.z.toFixed(2)} m (${SPLIT_RULE[m.split.rule]})`);
  out.push(`- Profile: ${p.profile.label} — walls at least ${p.profile.wall} mm on the print`);
  if (m.adjustments.length) {
    const list = m.adjustments.map((a) => `${a.element}: ${a.scaledMm} → ${a.printedMm} mm (${a.rule})`);
    out.push(`- Thickened or widened for printing: ${details || list.length <= 3 ? list.join('; ') : `${list.slice(0, 3).join('; ')}; and ${list.length - 3} more (--details)`}`);
  }
  for (const part of m.parts) if (part.overhangs.supports.length) {
    const what = [...new Set(part.overhangs.supports.map((s) => s.what ?? `at ${s.at.join(', ')} m`))];
    out.push(`- Supports in ${part.kind === 'roof' ? 'the roof' : part.id}: ${details || what.length <= 3 ? what.join(', ') : `${what.slice(0, 3).join(', ')} and ${what.length - 3} more`}`);
  }
  for (const n of details ? m.notes : m.notes.slice(0, 2)) out.push(`- Note: ${n.message}`);
  if (!details && m.notes.length > 2) out.push(`- ${m.notes.length - 2} more note(s) (--details)`);
  for (const x of m.problems) out.push(`- Problem: ${x}`);
  return out;
}

export async function printCommand(o: Opts): Promise<number> {
  const from = o['--from'] as string | undefined, prior = from ? fromBuild(from) : null;
  const outputDir = o['--output-dir'] as string | undefined;
  const ws = prior?.ws ?? workspace(String(o['--name'] ?? ''), outputDir);
  if (!o['--name'] && !prior) throw new UsageError(`--name is required (the workspace in house-forge-output/)\n\n${PRINT_HELP}`);
  const s = settingsFrom(o, prior?.settings), p = parseSettings(s);
  const plan = loadPlan(ws, { quiet: true });
  if (!plan) return 2;
  const { data, id, bytes } = plan;
  const geo = await geometry();
  if (o['--scales']) {
    console.log(`${id}: part sizes on ${bedText(p.bed)} (margin ${p.margin} mm, ${p.profile.id})`);
    for (const c of scaleTable(data, geo, { bed: p.bed, profile: p.profile, margin: p.margin, eaves: s.eaves })) {
      console.log(`  ${scaleLabel(c.n).padEnd(6)} ${c.fits ? 'fits    ' : 'too big '} ${c.parts.map((x) => `${x.id} ${mm(x.sizeMm)}${x.fit.rotated ? ' (turned)' : ''}`).join(' · ')}`);
    }
    return 0;
  }
  const meta = { core: VERSION.core, engine: VERSION.engine, plugin: VERSION.version, input: `sha256:${sha256(bytes)}`, inputFile: rel(ws.plan) };
  const m = buildModel(data, geo, id, p, s, meta);
  if (!m.n) {
    console.log(`## ${id}: no scale fits\n\n- Printer: ${bedText(p.bed)}, ${p.margin} mm margin`);
    for (const x of m.problems) console.log(`- Problem: ${x}`);
    console.log('\nA larger printer, a smaller margin, or a given scale (--scale 1:N, parts that do not fit are reported) are the ways out.');
    return 3;
  }
  const rec: BuildRecord = { generator: 'house-forge', version: VERSION.version, engine: VERSION.engine, input: meta.input, settings: s, scale: scaleLabel(m.n) };
  const slot = buildSlot(ws, scaleTag(m.n), rec, !!o['--new-version']);
  fs.mkdirSync(ws.previews, { recursive: true });
  const preview = (suffix: string) => {
    const file = path.join(ws.previews, `${slot.tag}-${suffix}.png`);
    fs.writeFileSync(file, png(printPreview(m, { bed: p.bed, margin: p.margin, title: id, labels: printLabels(s.lang) })));
    return file;
  };
  if (o['--dry-run']) {
    fs.mkdirSync(slot.dir, { recursive: true });
    if (slot.state !== 'done') fs.writeFileSync(path.join(slot.dir, 'dry-run.json'), JSON.stringify({ ...rec, report: m.report }, null, 1) + '\n');
    const file = preview('dry-run');
    console.log(`## ${id}: ready to print?\n`);
    console.log(facts(m, p, !!o['--details']).join('\n'));
    console.log(slot.state === 'done' ? `- Already built with identical settings: \`${rel(slot.dir)}/\`` : `- ${slot.state === 'dry' ? 'Version' : 'New version'}: \`${rel(slot.dir)}/\``);
    console.log(`\nPreview: \`${rel(file)}\``);
    if (m.ok) console.log(`\n### Build command\n\n\`\`\`bash\n${buildCommand(ws, s, outputDir)}\n\`\`\``);
    else console.log('\nNot printable as it is: change the settings or the plan (see the problems above).');
    return m.ok ? 0 : 3;
  }
  if (slot.state === 'done') {
    const built = JSON.parse(fs.readFileSync(path.join(slot.dir, 'build.json'), 'utf8')) as BuildRecord;
    console.log(`## ${id}: already built\n\nIdentical settings and plan: nothing was rebuilt (--new-version builds a copy).\n\nFiles:\n`);
    for (const f of built.files ?? []) console.log(`- \`${rel(path.join(slot.dir, f.file))}\``);
    return 0;
  }
  fs.mkdirSync(slot.dir, { recursive: true });
  for (const f of fs.readdirSync(slot.dir)) if (f.endsWith('.stl')) fs.rmSync(path.join(slot.dir, f));
  const files: { file: string; bytes: number; sha256: string }[] = [];
  if (m.ok) for (const part of m.parts) {
    fs.writeFileSync(path.join(slot.dir, part.file), part.stl!);
    files.push({ file: part.file, bytes: part.stl!.length, sha256: sha256(part.stl!) });
  }
  fs.writeFileSync(path.join(slot.dir, 'print-report.json'), JSON.stringify({ ...m.report, files }, null, 1) + '\n');
  const file = preview('print');
  if (!m.ok) {
    console.log(`## ${id}: not printable\n`);
    console.log(facts(m, p, true).join('\n'));
    console.log(`\nNo STL was written. Report: \`${rel(path.join(slot.dir, 'print-report.json'))}\`, preview: \`${rel(file)}\``);
    return 3;
  }
  fs.writeFileSync(path.join(slot.dir, 'build.json'), JSON.stringify({ ...rec, files }, null, 1) + '\n');
  const total = m.parts.reduce((t, x) => t + x.volumeMm3, 0) / 1000;
  console.log(`## ${id}: ready to print\n`);
  console.log(`- Scale ${scaleLabel(m.n)} on ${bedText(p.bed)}`);
  console.log(`- STL check: OK — every part watertight, one solid, read back (${m.parts.reduce((t, x) => t + x.triangles, 0)} triangles, ${(Math.round(total * 10) / 10).toString()} cm³ of material if printed solid)`);
  console.log(partLines(m).map((l) => l.replace(/^ {2}/, '')).join('\n'));
  if (m.split) console.log(`- The roof comes off at ${m.split.z.toFixed(2)} m (${SPLIT_RULE[m.split.rule]})`);
  if (slot.state === 'new') console.log('- Note: these settings were not shown in a dry run');
  console.log('\nFiles:\n');
  for (const part of m.parts) console.log(`- \`${rel(path.join(slot.dir, part.file))}\`: ${part.kind === 'roof' ? 'the roof' : `${part.id} ${part.title}`}`);
  console.log(`- \`${rel(file)}\`: preview`);
  console.log(`- \`${rel(path.join(slot.dir, 'print-report.json'))}\`: report (sizes, checks, every change for printing)`);
  return 0;
}

function buildModel(data: BuildingData, geo: Awaited<ReturnType<typeof geometry>>, id: string, p: Parsed, s: BuildSettings, meta: Record<string, string>): PrintModel {
  return printModel(data, geo, { bed: p.bed, profile: p.profile, scale: p.scale, margin: p.margin, eaves: s.eaves, name: id, meta });
}
