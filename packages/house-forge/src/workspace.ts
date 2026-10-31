// The workspace of one house in the user's directory (never in the plugin's installation):
//   house-forge-output/<name>/source/plan.json      what the agent writes (and inputs/, prep/, calibration.json, pdf/, cad/)
//   house-forge-output/<name>/project.json          compiled from the plan
//   house-forge-output/<name>/previews/             plan-<level>.png, roof.png, 3d.png; <build>-dry-run.png, <build>-print.png
//   house-forge-output/<name>/builds/1to<N>-v<K>/   STL parts, print-report.json, build.json (settings of the build)
// A build directory is a version: identical settings and plan reuse it, anything else makes the next one.
import fs from 'node:fs';
import path from 'node:path';
import { UsageError } from './common.ts';

export const OUTPUT = 'house-forge-output';
/** a workspace name: the plan's project id (lower-case ASCII, digits, hyphens) */
export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface Workspace {
  name: string;
  root: string;
  dir: string;
  source: string;
  plan: string;
  inputs: string;
  project: string;
  previews: string;
  builds: string;
}

export function workspace(name: string, outputDir?: string): Workspace {
  if (!NAME_RE.test(name)) throw new UsageError(`--name "${name}": use lower-case letters, digits and hyphens (the plan's project id), e.g. "my-house"`);
  const root = path.resolve(outputDir ?? OUTPUT), dir = path.join(root, name), source = path.join(dir, 'source');
  return {
    name, root, dir, source, plan: path.join(source, 'plan.json'), inputs: path.join(source, 'inputs'), project: path.join(dir, 'project.json'),
    previews: path.join(dir, 'previews'), builds: path.join(dir, 'builds'),
  };
}

/** the settings a build is made with — equal settings (and an equal plan) make the same files */
export interface BuildSettings {
  bed: string;
  scale: string;
  nozzle: string;
  minWall: number | null;
  margin: number;
  eaves: 'keep' | 'trim';
  /** registration tabs between the stacked parts (absent in builds made before 0.2.0: on) */
  joints?: boolean;
  lang: string;
}

/** what build.json / dry-run.json record */
export interface BuildRecord {
  generator: string;
  version: string;
  engine: string;
  /** sha256 of the plan the build was made from */
  input: string;
  settings: BuildSettings;
  scale: string;
  files?: { file: string; bytes: number; sha256: string }[];
}

const VERSION_DIR = /^(1to\d+)-v(\d+)$/;

export const sameBuild = (a: BuildRecord, b: BuildRecord): boolean =>
  a.input === b.input && a.engine === b.engine && a.version === b.version && JSON.stringify(a.settings) === JSON.stringify(b.settings);

const readJson = (f: string): BuildRecord | null => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) as BuildRecord; } catch { return null; } };

export interface Slot {
  dir: string;
  tag: string;
  /** done — an earlier build with the same settings whose files are all there; dry — reserved by a dry run with these settings */
  state: 'new' | 'dry' | 'done';
}

/**
 * The build directory for a record at a scale (tag "1to75"): the version already built with the same settings and plan, the
 * version a dry run with them reserved, or the next free version (always the next one when `fresh`).
 */
export function buildSlot(ws: Workspace, tag: string, rec: BuildRecord, fresh = false): Slot {
  const versions = fs.existsSync(ws.builds) ? fs.readdirSync(ws.builds).map((d) => VERSION_DIR.exec(d)).filter((m): m is RegExpExecArray => !!m && m[1] === tag).map((m) => Number(m[2])).sort((a, b) => a - b) : [];
  if (!fresh) for (const v of versions) {
    const dir = path.join(ws.builds, `${tag}-v${v}`), built = readJson(path.join(dir, 'build.json'));
    if (built && sameBuild(built, rec) && (built.files ?? []).every((f) => fs.existsSync(path.join(dir, f.file)))) return { dir, tag: `${tag}-v${v}`, state: 'done' };
  }
  if (!fresh) for (const v of versions) {
    const dir = path.join(ws.builds, `${tag}-v${v}`), dry = readJson(path.join(dir, 'dry-run.json'));
    if (dry && sameBuild(dry, rec) && !fs.existsSync(path.join(dir, 'build.json'))) return { dir, tag: `${tag}-v${v}`, state: 'dry' };
  }
  const next = (versions[versions.length - 1] ?? 0) + 1;
  return { dir: path.join(ws.builds, `${tag}-v${next}`), tag: `${tag}-v${next}`, state: 'new' };
}

/** the workspace and settings of an earlier build directory (`--from`) */
export function fromBuild(dir: string): { ws: Workspace; settings: BuildSettings } {
  const abs = path.resolve(dir), rec = readJson(path.join(abs, 'build.json')) ?? readJson(path.join(abs, 'dry-run.json'));
  if (!rec) throw new UsageError(`--from ${dir}: no build.json or dry-run.json there`);
  const buildsDir = path.dirname(abs), wsDir = path.dirname(buildsDir);
  if (path.basename(buildsDir) !== 'builds') throw new UsageError(`--from ${dir}: not a build directory (…/<name>/builds/1to<N>-v<K>)`);
  return { ws: workspace(path.basename(wsDir), path.dirname(wsDir)), settings: rec.settings };
}
