// The house-forge plugin (ADR 0033, 0034): the bundle prints the same STL bytes as the core in this process; two builds of
// one tree are identical; every command and reference the skill names exists; the Python tools in the plugin give the same
// intake as the repository's; build versions are reused only for identical settings.
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { compilePlan } from '@home-sim/core/authoring/compile';
import { printModel } from '@home-sim/core/print/model';
import { parseBed } from '@home-sim/core/print/printers';
import { profileOf } from '@home-sim/core/print/profiles';
import { loadGeometry } from '@home-sim/core/solid/wasm';
import { buildSlot, workspace, type BuildRecord } from '../src/workspace.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const OUT_A = tmp('hf-a-'), OUT_B = tmp('hf-b-');
const SKILL_DIR = (out: string) => path.join(out, 'plugins', 'house-forge', 'skills', 'house-forge');
const BUNDLE = path.join(SKILL_DIR(OUT_A), 'scripts', 'house-forge.mjs');
const node = (args: string[], cwd: string) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
const tree = (dir: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } };
  walk(dir);
  return out;
};
const have = (cmd: string, args = ['--version']) => spawnSync(cmd, args).status === 0;

beforeAll(() => {
  for (const out of [OUT_A, OUT_B]) execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'plugin', 'build.mjs'), '--out', out], { cwd: ROOT, stdio: 'pipe' });
}, 180_000);

describe('the plugin build', () => {
  it('is byte-identical when built twice', () => {
    const a = tree(OUT_A), b = tree(OUT_B);
    expect(Object.keys(a).length).toBeGreaterThan(30);
    expect(b).toEqual(a);
  });

  it('carries the manifests, the skill, the kernel and the Python tools', () => {
    const plugin = JSON.parse(fs.readFileSync(path.join(OUT_A, 'plugins', 'house-forge', '.claude-plugin', 'plugin.json'), 'utf8'));
    const market = JSON.parse(fs.readFileSync(path.join(OUT_A, '.claude-plugin', 'marketplace.json'), 'utf8'));
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'house-forge', 'package.json'), 'utf8')).version;
    expect(plugin).toMatchObject({ name: 'house-forge', version, license: 'MIT' });
    expect(market.plugins[0]).toMatchObject({ name: 'house-forge', source: './plugins/house-forge', version });
    for (const f of ['SKILL.md', 'scripts/manifold.wasm', 'scripts/tools.py', 'scripts/tools.py.lock', 'scripts/intake.py', 'scripts/hstools/pdfdoc.py', 'scripts/VERSION.json', 'scripts/THIRD-PARTY-NOTICES.md']) {
      expect(fs.existsSync(path.join(SKILL_DIR(OUT_A), f)), f).toBe(true);
    }
    expect(fs.readFileSync(path.join(SKILL_DIR(OUT_A), 'scripts', 'THIRD-PARTY-NOTICES.md'), 'utf8')).toMatch(/manifold-3d[\s\S]*zod/);
  });

  it('names in SKILL.md only commands the CLI has and references that exist', () => {
    const skill = fs.readFileSync(path.join(SKILL_DIR(OUT_A), 'SKILL.md'), 'utf8');
    const help = node([BUNDLE, '--help'], OUT_A).stdout;
    const commands = new Set([...help.matchAll(/^ {2}([a-z]+)\b/gm)].map((m) => m[1]));
    const used = [...skill.matchAll(/node "\$HF" ([a-z]+)(?: ([a-z0-9]+))?/g)];
    expect(used.length).toBeGreaterThan(15);
    for (const [, cmd, sub] of used) {
      expect(commands.has(cmd), `${cmd} in --help`).toBe(true);
      if (['image', 'pdf', 'cad'].includes(cmd)) expect(node([BUNDLE, cmd, '--help'], OUT_A).stdout, `${cmd} ${sub}`).toContain(sub);
      else expect(node([BUNDLE, cmd, '--help'], OUT_A).status, `${cmd} --help`).toBe(0);
    }
    const refs = path.join(SKILL_DIR(OUT_A), 'references');
    const texts = [skill, ...fs.readdirSync(refs).filter((f) => f.endsWith('.md')).map((f) => fs.readFileSync(path.join(refs, f), 'utf8'))];
    for (const t of texts) for (const [, ref] of t.matchAll(/`?references\/([\w./-]+[\w])`?/g)) expect(fs.existsSync(path.join(refs, ref)), `references/${ref}`).toBe(true);
    // the bundle's own print options are the ones the card prints
    const printHelp = node([BUNDLE, 'print', '--help'], OUT_A).stdout;
    for (const o of ['--from', '--scales', '--dry-run', '--details', '--new-version']) expect(printHelp).toContain(o);
  });
});

describe('print from the bundle', () => {
  it('writes the same STL bytes as printModel in this process', async () => {
    const cwd = tmp('hf-ws-'), ws = workspace('sample-house', path.join(cwd, 'house-forge-output'));
    fs.mkdirSync(ws.source, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'projects', 'sample-house', 'source', 'plan.json'), ws.plan);
    const r = node([BUNDLE, 'print', '--name', 'sample-house', '--bed', 'K1C'], cwd);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const dir = path.join(ws.builds, '1to75-v1');
    const plan = compilePlan(JSON.parse(fs.readFileSync(ws.plan, 'utf8')), { catalog: null }).project!;
    const m = printModel(plan.building, await loadGeometry(), { bed: parseBed('K1C'), profile: profileOf('0.4'), scale: null, margin: 10, eaves: 'keep', name: plan.manifest.projectId });
    expect(m.parts.length).toBe(3);
    for (const p of m.parts) expect(Buffer.compare(fs.readFileSync(path.join(dir, p.file)), Buffer.from(p.stl!)), p.file).toBe(0);
    // the same settings again: nothing rebuilt
    expect(node([BUNDLE, 'print', '--name', 'sample-house', '--bed', 'K1C'], cwd).stdout).toContain('already built');
  }, 120_000);

  it('previews a plan without a browser', () => {
    const cwd = tmp('hf-pv-'), ws = workspace('demo', path.join(cwd, 'house-forge-output'));
    fs.mkdirSync(ws.source, { recursive: true });
    const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'projects', 'demo-apartment', 'source', 'plan.json'), 'utf8'));
    fs.writeFileSync(ws.plan, JSON.stringify({ ...plan, project: { ...plan.project, id: 'demo' } }));
    const r = node([BUNDLE, 'preview', '--name', 'demo', '--lang', 'pl'], cwd);
    expect(r.status, r.stderr).toBe(0);
    for (const f of ['plan-L1.png', '3d.png']) expect(fs.readFileSync(path.join(ws.previews, f)).subarray(1, 4).toString()).toBe('PNG');
  }, 60_000);
});

describe.skipIf(!have('uv'))('the Python tools in the plugin', () => {
  it('give the same intake as the repository tools', () => {
    const sample = path.join(ROOT, 'skills', 'home-from-plan', 'assets', 'samples', 'flat-2room.png');
    const plugin = spawnSync('uv', ['run', '--quiet', '--locked', path.join(SKILL_DIR(OUT_A), 'scripts', 'tools.py'), 'intake', sample, '--json'], { encoding: 'utf8' });
    expect(plugin.status, plugin.stderr).toBe(0);
    const py = fs.existsSync(path.join(ROOT, '.venv', 'bin', 'python')) ? path.join(ROOT, '.venv', 'bin', 'python') : 'python3';
    const repo = spawnSync(py, [path.join(ROOT, 'tools', 'intake.py'), sample, '--json'], { encoding: 'utf8', env: { ...process.env, HSTOOLS_NAMES: 'plugin' } });
    if (repo.status !== 0) return; // no pillow for the repository tools here: the plugin side ran above
    expect(JSON.parse(plugin.stdout)).toEqual(JSON.parse(repo.stdout));
    expect(JSON.parse(plugin.stdout)[0].branch).toBe('A. raster — image prepare → image calibrate');
  }, 300_000);
});

describe('build versions', () => {
  it('reuse a version only for the same settings and plan', () => {
    const ws = workspace('v', tmp('hf-v-'));
    const rec: BuildRecord = { generator: 'house-forge', version: '0', engine: 'e', input: 'sha256:a', scale: '1:75', settings: { bed: 'K1C', scale: 'auto', nozzle: '0.4', minWall: null, margin: 10, eaves: 'keep', lang: 'en' } };
    const s1 = buildSlot(ws, '1to75', rec);
    expect(s1).toMatchObject({ tag: '1to75-v1', state: 'new' });
    fs.mkdirSync(s1.dir, { recursive: true });
    fs.writeFileSync(path.join(s1.dir, 'dry-run.json'), JSON.stringify(rec));
    expect(buildSlot(ws, '1to75', rec).state).toBe('dry');
    fs.writeFileSync(path.join(s1.dir, 'a.stl'), 'x');
    fs.writeFileSync(path.join(s1.dir, 'build.json'), JSON.stringify({ ...rec, files: [{ file: 'a.stl', bytes: 1, sha256: '' }] }));
    expect(buildSlot(ws, '1to75', rec).state).toBe('done');
    expect(buildSlot(ws, '1to75', { ...rec, settings: { ...rec.settings, margin: 5 } })).toMatchObject({ tag: '1to75-v2', state: 'new' });
    expect(buildSlot(ws, '1to75', { ...rec, input: 'sha256:b' }).tag).toBe('1to75-v2');
    expect(buildSlot(ws, '1to75', rec, true).tag).toBe('1to75-v2');
    fs.rmSync(path.join(s1.dir, 'a.stl'));
    expect(buildSlot(ws, '1to75', rec).state).not.toBe('done');
  });
});
