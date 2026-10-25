// npm run project:validate -- projects/<id> [--strict]
// Checks a project package exactly as the app does at load time: JSON Schema structure (zod), semantic rules
// (src/project/validate.ts), catalog ids, files named in assets. Exit codes: 0 — valid, 2 — errors, 3 — warnings with --strict.
import fs from 'node:fs';
import path from 'node:path';
import { readProjectCatalogs, projectDirErrors } from '../../src/project/node';
import type { ProjectPackage } from '../../src/project/types';

const args = process.argv.slice(2), dir = args.find((a) => !a.startsWith('--'));
if (!dir) { console.error('usage: npm run project:validate -- projects/<id> [--strict]'); process.exit(2); }
const file = path.join(dir, 'project.json');
let data: ProjectPackage;
try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`${file}: ${(e as Error).message}`); process.exit(2); }

const errors = projectDirErrors(dir, data);
// files named by the package: assets and the GLB models / texture maps of its own catalog items
for (const i of readProjectCatalogs(dir, data).catalogs.furniture.items) {
  const url = i.runtimeModel.url;
  if (url && !/^([a-z]+:)?\/\//i.test(url) && !url.startsWith('/') && !fs.existsSync(path.join(dir, url))) errors.push(`catalog item "${i.id}": model ${url} not found in ${dir}`);
}
const warnings: string[] = [];
for (const [k, rel] of Object.entries(data.assets ?? {})) if (typeof rel === 'string' && /\.(glb|gltf)$/i.test(rel) && !fs.existsSync(path.join(dir, rel))) errors.push(`assets.${k}: file ${rel} not found in ${dir}`);
if (fs.existsSync(path.join(dir, 'source', 'plan.json')) && fs.statSync(path.join(dir, 'source', 'plan.json')).mtimeMs > fs.statSync(file).mtimeMs) warnings.push('source/plan.json is newer than project.json — run npm run project:build');
for (const e of errors) console.log(`  ERROR    ${e}`);
for (const w of warnings) console.log(`  warning  ${w}`);
if (errors.length) { console.error(`${file}: ${errors.length} error(s)`); process.exit(2); }
console.log(`${file}: valid (${data.building.rooms.rooms.length} rooms, ${Object.keys(data.building.rooms.levels).length} level(s), modules: ${data.manifest.modules.join(', ') || 'none'})`);
if (warnings.length && args.includes('--strict')) process.exit(3);
