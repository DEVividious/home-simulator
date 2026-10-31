// Versions recorded in reports and build records: the plugin, the core and the engine commit. The plugin build
// (scripts/plugin/build.mjs) bakes them into the bundle; from source they come from the package files and git.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

declare const __HOUSE_FORGE__: { version: string; core: string; engine: string } | undefined;

function fromSource(): { version: string; core: string; engine: string } {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const git = (a: string[]) => { try { return execFileSync('git', a, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
  const sha = git(['rev-parse', '--short', 'HEAD']), dirty = git(['status', '--porcelain', '--untracked-files=no']);
  const version = (p: string) => (JSON.parse(fs.readFileSync(path.join(root, p, 'package.json'), 'utf8')) as { version: string }).version;
  return { version: version('packages/house-forge'), core: version('packages/core'), engine: sha ? `${sha}${dirty ? '+changes' : ''}` : 'unknown' };
}

export const VERSION: { version: string; core: string; engine: string } = typeof __HOUSE_FORGE__ !== 'undefined' ? __HOUSE_FORGE__ : fromSource();
