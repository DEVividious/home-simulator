#!/usr/bin/env node
// npm run plugin:build -- [--out ../house-forge] [--force]
// Assembles the house-forge plugin (ADR 0033, 0034) into a directory the owner publishes as DEVividious/house-forge:
//   .claude-plugin/marketplace.json, README.md, LICENSE, CHANGELOG.md, .gitignore
//   plugins/house-forge/.claude-plugin/plugin.json (+ icon.png), README.md, LICENSE
//   plugins/house-forge/skills/house-forge/SKILL.md, references/ (generated, scripts/plugin/references.mjs)
//   plugins/house-forge/skills/house-forge/scripts/ house-forge.mjs (esbuild: the CLI and the core in one ESM file),
//     manifold.wasm, tools.py + tools.py.lock, hstools/ image/ pdf/ cad/ (the repository's tools/), VERSION.json,
//     THIRD-PARTY-NOTICES.md
// Only these paths are replaced; anything else in the directory (.git, the owner's files) stays. A directory that is not empty
// and holds no house-forge marketplace is refused unless --force. Two builds of one commit are byte-identical.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { build } from 'esbuild';
import { building } from '@home-sim/core/model/building';
import { drawMeshes, encodePng, image } from '@home-sim/core/print/raster';
import { shellMeshes } from '@home-sim/core/solid/levels';
import { ROLES } from '@home-sim/core/solid/tags';
import { loadGeometry } from '@home-sim/core/solid/wasm';
import { COPIED, leftovers, references, ROOT } from './references.mjs';

const args = process.argv.slice(2).filter((a) => a !== '--');
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const OUT = path.resolve(opt('--out') ?? path.join(ROOT, 'dist', 'house-forge'));
const PKG_DIR = path.join(ROOT, 'packages', 'house-forge');
const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
const core = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'core', 'package.json'), 'utf8'));
const manifoldVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'manifold-3d', 'package.json'), 'utf8')).version;
const git = (a) => { try { return execFileSync('git', a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };
const sha = git(['rev-parse', '--short', 'HEAD']), dirty = git(['status', '--porcelain', '--untracked-files=no']);
const engine = sha ? `${sha}${dirty ? '+changes' : ''}` : 'unknown';
const fail = (m) => { console.error(m); process.exit(2); };

// ---- the target directory: only the managed paths are replaced
const MANAGED = ['.claude-plugin', 'plugins/house-forge', 'README.md', 'LICENSE', 'CHANGELOG.md', '.gitignore'];
if (fs.existsSync(OUT)) {
  const entries = fs.readdirSync(OUT).filter((e) => e !== '.git');
  let ours = false;
  try { ours = JSON.parse(fs.readFileSync(path.join(OUT, '.claude-plugin', 'marketplace.json'), 'utf8')).name === 'house-forge'; } catch { /* not ours */ }
  if (entries.length && !ours && !args.includes('--force')) fail(`${OUT} is not empty and holds no house-forge marketplace — choose another --out or pass --force`);
  for (const m of MANAGED) fs.rmSync(path.join(OUT, m), { recursive: true, force: true });
}
const PLUGIN = path.join(OUT, 'plugins', 'house-forge'), SKILL = path.join(PLUGIN, 'skills', 'house-forge'), SCRIPTS = path.join(SKILL, 'scripts');
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const json = (v) => JSON.stringify(v, null, 2) + '\n';

// ---- the CLI bundle
const result = await build({
  absWorkingDir: ROOT,
  entryPoints: [path.join(PKG_DIR, 'src', 'cli.ts')],
  outfile: path.join(SCRIPTS, 'house-forge.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node20', charset: 'utf8', legalComments: 'none', logLevel: 'warning',
  define: { __HOUSE_FORGE__: JSON.stringify({ version: pkg.version, core: core.version, engine }) },
  banner: { js: `// house-forge ${pkg.version} — built from Home Simulator ${engine} by npm run plugin:build; source: packages/house-forge (MIT).\n// Bundled: @home-sim/core, zod, manifold-3d (see THIRD-PARTY-NOTICES.md).` },
  metafile: true,
});
const bundled = Object.keys(result.metafile.inputs).filter((f) => f.includes('node_modules/')).map((f) => f.split('node_modules/').pop().split('/')[0]);
fs.chmodSync(path.join(SCRIPTS, 'house-forge.mjs'), 0o755);
fs.copyFileSync(path.join(ROOT, 'node_modules', 'manifold-3d', 'manifold.wasm'), path.join(SCRIPTS, 'manifold.wasm'));

// ---- the Python tools: tools.py, its lock, and the repository's tools (no tests, no caches)
fs.copyFileSync(path.join(PKG_DIR, 'python', 'tools.py'), path.join(SCRIPTS, 'tools.py'));
fs.copyFileSync(path.join(PKG_DIR, 'python', 'tools.py.lock'), path.join(SCRIPTS, 'tools.py.lock'));
for (const dir of ['hstools', 'image', 'pdf', 'cad']) for (const f of fs.readdirSync(path.join(ROOT, 'tools', dir)).filter((x) => x.endsWith('.py')).sort()) {
  write(path.join(SCRIPTS, dir, f), fs.readFileSync(path.join(ROOT, 'tools', dir, f)));
}
fs.copyFileSync(path.join(ROOT, 'tools', 'intake.py'), path.join(SCRIPTS, 'intake.py'));

// ---- licences of what the bundle contains
const notices = ['# Third-party notices', '', `\`house-forge.mjs\` bundles the following packages; \`manifold.wasm\` is part of manifold-3d ${manifoldVersion}.`, ''];
for (const name of [...new Set(bundled)].sort()) {
  const dir = path.join(ROOT, 'node_modules', name), lic = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
  const v = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  notices.push(`## ${name} ${v.version} (${v.license})`, '', '```', (lic ? fs.readFileSync(path.join(dir, lic), 'utf8') : `${v.license}`).trim(), '```', '');
}
write(path.join(SCRIPTS, 'THIRD-PARTY-NOTICES.md'), notices.join('\n'));
const lockHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(SCRIPTS, 'tools.py.lock'))).digest('hex');
write(path.join(SCRIPTS, 'VERSION.json'), json({ name: 'house-forge', version: pkg.version, engine, core: core.version, manifold: manifoldVersion, toolsLock: `sha256:${lockHash}` }));

// ---- the skill and its references
write(path.join(SKILL, 'SKILL.md'), fs.readFileSync(path.join(PKG_DIR, 'skill', 'SKILL.md')));
const refs = references(), problems = [];
for (const [f, text] of Object.entries(refs)) {
  for (const [n, l] of leftovers(text)) problems.push(`references/${f}:${n}: ${l.trim().slice(0, 140)}`);
  write(path.join(SKILL, 'references', f), text);
}
for (const [f, src] of Object.entries(COPIED)) {
  let text = fs.readFileSync(src, 'utf8');
  if (f.startsWith('examples/')) text = text.replace(/"\$schema":\s*"[^"]*"/, '"$schema": "../plan.schema.json"');
  write(path.join(SKILL, 'references', f), text);
}
if (problems.length) fail(`references still name repository paths — add a rewrite in scripts/plugin/references.mjs:\n  ${problems.join('\n  ')}`);

// ---- manifests, readmes, licence, icon
const author = { name: 'Vividious', url: 'https://github.com/DEVividious' }, repo = 'https://github.com/DEVividious/house-forge';
write(path.join(PLUGIN, '.claude-plugin', 'plugin.json'), json({
  name: 'house-forge', displayName: pkg.displayName, version: pkg.version, description: pkg.description, author, homepage: repo, repository: repo, license: pkg.license, keywords: pkg.keywords,
}));
write(path.join(OUT, '.claude-plugin', 'marketplace.json'), json({
  name: 'house-forge', owner: author, description: 'House Forge: turn floor plans into a 3D-printable scale model of a house.',
  plugins: [{ name: 'house-forge', source: './plugins/house-forge', description: 'Floor plans, PDF sheets or CAD drawings into STL parts of a house model that fit your printer, with preview approval.', version: pkg.version }],
}));
write(path.join(PLUGIN, 'README.md'), fs.readFileSync(path.join(PKG_DIR, 'plugin', 'README.md')));
write(path.join(OUT, 'README.md'), fs.readFileSync(path.join(PKG_DIR, 'plugin', 'repo-README.md')));
write(path.join(OUT, 'CHANGELOG.md'), fs.readFileSync(path.join(PKG_DIR, 'CHANGELOG.md')));
for (const d of [OUT, PLUGIN]) write(path.join(d, 'LICENSE'), fs.readFileSync(path.join(ROOT, 'LICENSE')));
write(path.join(OUT, '.gitignore'), 'house-forge-output/\n__pycache__/\n*.py[cod]\n.venv/\n.DS_Store\n');
// the icon: the sample house of this repository from outside, drawn by the core's rasteriser
const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'projects', 'sample-house', 'project.json'), 'utf8'));
const shell = shellMeshes(await loadGeometry(), building(sample.building)), meshes = [];
if (shell.failed.length) throw new Error(`the sample house shell could not be built: ${shell.failed.map((f) => `${f.part} ${f.level} — ${f.error}`).join('; ')}`);
for (const l of [...shell.levels, ...shell.roofs]) {
  const groups = new Map();
  for (let t = 0; t < l.solid.role.length; t++) {
    const role = ROLES[l.solid.role[t]], key = ['roof', 'roof-flat', 'eaves', 'roof-underside'].includes(role) ? 'roof' : 'wall';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l.solid.index[t * 3], l.solid.index[t * 3 + 1], l.solid.index[t * 3 + 2]);
  }
  for (const [key, idx] of groups) meshes.push({ positions: l.solid.positions, index: new Uint32Array(idx), color: key === 'roof' ? [176, 92, 74] : [236, 232, 222] });
  if (l.glass.index.length) meshes.push({ positions: l.glass.positions, index: l.glass.index, color: [150, 186, 222] });
}
const icon = image(512, 512, [244, 241, 234]);
drawMeshes(icon, 0, 0, 512, 512, meshes, { azimuth: -125, elevation: 26 }, 36);
write(path.join(PLUGIN, '.claude-plugin', 'icon.png'), encodePng(icon, (raw) => zlib.deflateSync(raw, { level: 9 })));

// ---- summary
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== '.git') walk(p); } else files.push(p); } };
walk(OUT);
const size = files.reduce((s, f) => s + fs.statSync(f).size, 0);
console.log(`house-forge ${pkg.version} (engine ${engine}) → ${path.relative(process.cwd(), OUT) || '.'}: ${files.length} files, ${(size / 1e6).toFixed(2)} MB (house-forge.mjs ${(fs.statSync(path.join(SCRIPTS, 'house-forge.mjs')).size / 1e3).toFixed(0)} kB)`);
if (dirty) console.log('  note: the working tree has uncommitted changes — VERSION.json says engine "+changes"; publish from a commit');
