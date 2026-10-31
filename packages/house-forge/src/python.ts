// The Python import tools (ADR 0034): tools.py, a PEP 723 script with a lock file, run with `uv run --locked` — the same
// tools as the repository's tools/ (copied next to it in the plugin). HOUSE_FORGE_PYTHON=/path/to/python runs it with that
// interpreter instead (a virtual environment with tools/requirements.txt; for development and tests).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** tools.py: next to the bundle in the plugin, packages/house-forge/python/ in the repository */
export function toolsScript(): string {
  for (const p of [path.join(HERE, 'tools.py'), path.join(HERE, '..', 'python', 'tools.py')]) if (fs.existsSync(p)) return p;
  throw new Error('tools.py not found next to house-forge');
}

export const UV_INSTALL = 'https://docs.astral.sh/uv/getting-started/installation/';

/** a command's version line, or null when it does not run */
export function versionOf(cmd: string, args = ['--version']): string | null {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || r.stderr).trim().split('\n')[0] : null;
}

/** the command line that runs tools.py with `args` */
export function pythonCommand(args: string[]): [string, string[]] {
  const script = toolsScript(), py = process.env.HOUSE_FORGE_PYTHON;
  return py ? [py, [script, ...args]] : ['uv', ['run', '--quiet', '--locked', script, ...args]];
}

/** runs a Python tool with the terminal attached; returns its exit code */
export function runPython(args: string[]): number {
  const [cmd, argv] = pythonCommand(args);
  if (cmd === 'uv' && !versionOf('uv')) {
    console.error(`the Python tools need uv: install it (${UV_INSTALL}), then open a new terminal / restart the host so it sees uv on PATH`);
    return 2;
  }
  const r = spawnSync(cmd, argv, { stdio: 'inherit', env: { ...process.env, HSTOOLS_NAMES: 'plugin' } });
  if (r.error) { console.error(`${cmd}: ${r.error.message}`); return 2; }
  return r.status ?? 2;
}

/** runs a Python tool and returns its output */
export function capturePython(args: string[]): { status: number; stdout: string; stderr: string } {
  const [cmd, argv] = pythonCommand(args);
  const r = spawnSync(cmd, argv, { encoding: 'utf8', env: { ...process.env, HSTOOLS_NAMES: 'plugin' } });
  return { status: r.status ?? 2, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error?.message ?? '') };
}
