// npm run project:build -- projects/<id> [--check] [--lock] [--force-relock]
// Compiles projects/<id>/source/plan.json into projects/<id>/project.json (packages/core/src/authoring/compile.ts), validates the result
// with the same rules the app uses at load time and prints every issue. Exit codes: 0 — written (or up to date with --check),
// 2 — errors (nothing written), 3 — --check: project.json differs from the compiled plan.
//   --lock          records room ids and outlines in projects/<id>/ids.lock.json (do this when the package is released:
//                   user documents refer to wall ids <room>-w<n>, which follow the outline order)
//   --force-relock  accept a changed outline of a locked room and rewrite the lock
import fs from 'node:fs';
import path from 'node:path';
import { compilePlan, type CatalogItemInfo } from '@home-sim/core/authoring/compile';
import { catalogIdsWith, packageErrors } from '../../src/project/registry';
import { readProjectCatalogs } from '../../src/project/node';

const args = process.argv.slice(2), dir = args.find((a) => !a.startsWith('--'));
if (!dir) { console.error('usage: npm run project:build -- projects/<id> [--check] [--lock] [--force-relock]'); process.exit(2); }
const planFile = path.join(dir, 'source', 'plan.json'), outFile = path.join(dir, 'project.json'), lockFile = path.join(dir, 'ids.lock.json');
if (!fs.existsSync(planFile)) { console.error(`${planFile} not found`); process.exit(2); }
const catalog = (JSON.parse(fs.readFileSync('data/furnitureCatalog.json', 'utf8')) as { items: CatalogItemInfo[] }).items;
const force = args.includes('--force-relock');
const lock = fs.existsSync(lockFile) && !force ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) : null;
let plan: unknown;
try { plan = JSON.parse(fs.readFileSync(planFile, 'utf8')); } catch (e) { console.error(`${planFile}: ${(e as Error).message}`); process.exit(2); }
// the project's own catalog files (plan.catalog): their items can be placed like engine items
const ext = readProjectCatalogs(dir, { catalog: (plan as { catalog?: unknown } | null)?.catalog });
for (const e of ext.errors) console.log(`  ERROR    ${e}`);
if (ext.errors.length) { console.error(`\n${dir}: catalog extension has ${ext.errors.length} error(s) — project.json not written`); process.exit(2); }
const r = compilePlan(plan, { catalog: [...catalog, ...(ext.catalogs.furniture.items as unknown as CatalogItemInfo[])], lock });
for (const a of r.adjustments) console.log(`  adjusted  ${a}`);
for (const i of r.issues) console.log(`  ${i.level === 'error' ? 'ERROR  ' : 'warning'}  [${i.code}] ${i.message}`);
if (!r.project) { console.error(`\n${planFile}: ${r.issues.filter((i) => i.level === 'error').length} error(s) — project.json not written`); process.exit(2); }
const id = path.basename(path.resolve(dir));
const errs = packageErrors(r.project, id, catalogIdsWith(ext.catalogs));
if (errs.length) { console.error(`\ncompiled package fails validation:\n  ${errs.join('\n  ')}`); process.exit(2); }
const text = JSON.stringify({ $schema: '../../schemas/project.schema.json', ...r.project }, null, 1) + '\n';
if (args.includes('--check')) {
  const cur = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  if (cur !== text) { console.error(`${outFile} is out of date — run: npm run project:build -- ${dir}`); process.exit(3); }
  console.log(`${outFile}: up to date`);
} else {
  fs.writeFileSync(outFile, text);
  console.log(`${outFile}: ${r.project.building.rooms.rooms.length} rooms, ${r.project.building.doors.length} doors, ${r.project.interiors.items.length} furniture items, ${r.project.electrical.points.length} electrical points, ${r.issues.filter((i) => i.level === 'warning').length} warning(s)`);
}
if (args.includes('--lock') || force) {
  const rooms = Object.fromEntries(r.project.building.rooms.rooms.map((x) => [x.id, { vertices: x.polygon.length, first: x.polygon[0] }]));
  fs.writeFileSync(lockFile, JSON.stringify({ note: 'released room outlines — wall ids <room>-w<n> follow them; change only with --force-relock', rooms }, null, 1) + '\n');
  console.log(`${lockFile}: ${Object.keys(rooms).length} rooms locked`);
}
