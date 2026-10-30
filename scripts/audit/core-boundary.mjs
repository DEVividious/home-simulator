#!/usr/bin/env node
// Core boundary gate (ADR 0023): packages/core stays pure. Its sources import only each other (relative, with the .ts
// extension, never leaving packages/core/src) and the allowed packages; no Node built-ins, no DOM, three.js, React or app
// code; no translated text. Outside the core, code reaches it only through the package name (@home-sim/core/...), never by a
// relative path into packages/core. The typecheck of packages/core (lib ES2022, no ambient types) covers globals.
// Exit 1 on any problem.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const CORE = path.join(ROOT, 'packages', 'core');
const CORE_SRC = path.join(CORE, 'src');
const ALLOWED = ['zod', 'manifold-3d'];
const problems = [];

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'dist', 'build'].includes(e.name)) walk(p, out); } else if (/\.(m?[jt]sx?)$/.test(e.name)) out.push(p);
  }
  return out;
};
/** module specifiers of static imports / re-exports and dynamic imports */
const specifiers = (src) => [...src.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
const rel = (p) => path.relative(ROOT, p);

let coreFiles = 0;
for (const f of walk(CORE_SRC)) {
  coreFiles++;
  const src = fs.readFileSync(f, 'utf8');
  if (/\.tsx$/.test(f)) problems.push(`${rel(f)}: JSX has no place in the core`);
  for (const s of specifiers(src)) {
    if (s.startsWith('.')) {
      const target = path.resolve(path.dirname(f), s);
      if (!target.startsWith(CORE_SRC + path.sep)) problems.push(`${rel(f)}: '${s}' leaves packages/core/src`);
      else if (!s.endsWith('.ts')) problems.push(`${rel(f)}: '${s}' — relative imports carry the .ts extension (Node runs the sources as they are)`);
      else if (!fs.existsSync(target)) problems.push(`${rel(f)}: '${s}' does not exist`);
    } else if (!ALLOWED.some((a) => s === a || s.startsWith(`${a}/`))) {
      problems.push(`${rel(f)}: imports '${s}' — the core may import only ${ALLOWED.join(', ')} and its own files`);
    }
  }
  if (/\bt\(\s*['"][a-zA-Z][\w.]*['"]/.test(src)) problems.push(`${rel(f)}: translated text (t()) belongs to the app`);
}

// the other side: nothing outside the core reaches into its sources by path
const OUTSIDE = ['src', 'scripts', 'packages'].map((d) => path.join(ROOT, d)).filter((d) => fs.existsSync(d));
for (const d of OUTSIDE) for (const f of walk(d)) {
  if (f.startsWith(CORE + path.sep)) continue;
  for (const s of specifiers(fs.readFileSync(f, 'utf8'))) {
    if (s.startsWith('.') && path.resolve(path.dirname(f), s).startsWith(CORE + path.sep)) problems.push(`${rel(f)}: '${s}' — import the core as @home-sim/core/...`);
  }
}

if (problems.length) {
  console.error(`core boundary: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`core boundary: ${coreFiles} core files, 0 problems`);
