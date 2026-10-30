// npm run schema:generate [-- --check] — JSON Schemas generated from the zod schemas (the single source of truth):
//   schemas/project.schema.json (project package), schemas/plan.schema.json (authoring format),
//   schemas/projects-index.schema.json (projects/index.json). Editors use them through "$schema"; Python tools may validate
//   with them. --check fails when a committed file is out of date.
import fs from 'node:fs';
import { z } from 'zod';
import { PlanSchema } from '@home-sim/core/authoring/plan';
import { ProjectIndexSchema, ProjectSchema } from '../../src/project/schema';

const out: [string, z.ZodType, string][] = [
  ['schemas/project.schema.json', ProjectSchema, 'Home Simulator project package (projects/<id>/project.json)'],
  ['schemas/plan.schema.json', PlanSchema, 'Home Simulator authoring plan (projects/<id>/source/plan.json)'],
  ['schemas/projects-index.schema.json', ProjectIndexSchema, 'Home Simulator project index (projects/index.json, generated)'],
];
let stale = 0;
for (const [file, schema, title] of out) {
  const json = { title, ...z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) };
  const text = JSON.stringify(json, null, 1) + '\n';
  if (process.argv.includes('--check')) { if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error(`${file} is out of date — run npm run schema:generate`); stale++; } }
  else { fs.writeFileSync(file, text); console.log(`${file}: ${text.length} bytes`); }
}
process.exit(stale ? 1 : 0);
