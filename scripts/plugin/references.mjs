// The references of the house-forge skill (ADR 0033): generated from this repository so they never drift — the printer table
// and the print profiles from the core, the plan-reading references from skills/home-from-plan (its SKILL.md section 2 becomes
// reading-plans.md), with the repository's commands and paths rewritten as the plugin's. A line that still names a repository
// path after the rewrite fails the build (leftovers()).
import fs from 'node:fs';
import path from 'node:path';
import { PRINTERS } from '@home-sim/core/print/printers';
import { PROFILES } from '@home-sim/core/print/profiles';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SKILL = path.join(ROOT, 'skills', 'home-from-plan');
const TEMPLATES = path.join(ROOT, 'packages', 'house-forge', 'skill', 'references');

/** repository tool → plugin command */
const TOOLS = [
  ['intake.py', 'intake'], ['image/prepare.py', 'image prepare'], ['image/calibrate.py', 'image calibrate'],
  ['pdf/sheet_text.py', 'pdf text'], ['pdf/sheet_svg.py', 'pdf svg'], ['pdf/door_arcs.py', 'pdf arcs'], ['pdf/render.py', 'pdf render'],
  ['cad/dwg2dxf.py', 'cad dwg2dxf'], ['cad/dxf_inspect.py', 'cad inspect'], ['cad/dxf_walls.py', 'cad walls'],
];

/** the rewrite of one repository text for the plugin */
export function rewrite(md) {
  let s = md;
  for (const [file, cmd] of TOOLS) {
    const esc = file.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    s = s.replace(new RegExp(`(?:\\.venv/bin/python|python3) tools/${esc}`, 'g'), `node "$HF" ${cmd}`);
    s = s.replace(new RegExp(`\`tools/${esc}`, 'g'), `\`node "$HF" ${cmd}`);
    s = s.replace(new RegExp(`tools/${esc}`, 'g'), `\`${cmd}\``);
    s = s.replace(new RegExp(`\\b${esc.split('\\/').pop()}\\b`, 'g'), cmd);
  }
  s = s.replace(/npm run -s project:build -- projects\/<id>/g, 'node "$HF" compile --name <name>')
    .replace(/npm run -s project:preview -- projects\/<id>/g, 'node "$HF" preview --name <name>')
    .replace(/projects\/<id>\/source\//g, 'house-forge-output/<name>/source/')
    .replace(/projects\/<id>\//g, 'house-forge-output/<name>/')
    .replace(/projects\/<id>/g, 'house-forge-output/<name>')
    .replace(/`projects\/demo-apartment\/source\/plan\.json`/g, '`references/examples/demo-apartment.plan.json`')
    .replace(/`projects\/sample-house\/source\/plan\.json`/g, '`references/examples/sample-house.plan.json`')
    .replace(/JSON Schema: `schemas\/plan\.schema\.json` \(put `"\$schema": "[./]*schemas\/plan\.schema\.json"` at the top for editor help\)\./g, 'JSON Schema: `references/plan.schema.json`.')
    .replace(/ the catalog `car`/g, ' a car')
    .replace(/\(the project's own furniture \/ material files, ids `<project id>:…`, docs\/PROJECT_PACKAGE_SPEC\.md\)/g, "(the project's own furniture / material files — not used for a print)")
    .replace(/\bthe README\b/g, 'plan.json `source`')
    .replace(/\bin the README\b/g, 'in plan.json `source`')
    .replace(/the `home-check` skill/g, 'the preview')
    .replace(/`preview\/roof\.png`/g, '`previews/roof.png`')
    .replace(/`sheet_text`/g, '`pdf text`');
  return s;
}

/** lines that still name something only the repository has */
export function leftovers(md) {
  return md.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !l.startsWith('<!-- generated from') && /(\.venv|\bnpm run\b|\btools\/|\bprojects\/|\bsrc\/|\bdocs\/|\bschemas\/|\bskills\/|\.py\b|pdfto|poppler)/.test(l));
}

/** skills/home-from-plan/SKILL.md section 2 (reading the plan) as a reference of its own */
function readingPlans() {
  const md = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  const a = md.indexOf('## 2. Read the plan'), b = md.indexOf('\n## 3.', a);
  if (a < 0 || b < 0) throw new Error('skills/home-from-plan/SKILL.md: section "## 2. Read the plan" not found');
  const body = md.slice(a, b).replace(/^## 2\. Read the plan[^\n]*\n/, '').replace(/^### /gm, '## ');
  return `# Reading the plan\n\nPick the branch \`intake\` names. Coordinates go into \`plan.json\` (\`references/plan-schema.md\`); \`compile\` converts and checks them.\n${body}`;
}

const cell = (s) => String(s).replace(/\|/g, '\\|');

function printers() {
  const rows = PRINTERS.map((p) => `| ${cell(p.maker)} | ${cell(p.model)} | ${p.x} × ${p.y} × ${p.z} | ${cell(p.note ?? '')} |`).join('\n');
  return `| Maker | Model | X × Y × Z | Notes |\n|---|---|---|---|\n${rows}\n`;
}

function profiles() {
  const P = Object.values(PROFILES), row = (name, f) => `| ${name} | ${P.map(f).join(' | ')} |`;
  return [
    `| | ${P.map((p) => `\`--nozzle ${p.id === 'resin' ? 'resin' : p.id.slice(4)}\``).join(' | ')} |`, `|---|${P.map(() => '---').join('|')}|`,
    row('Printer', (p) => p.label), row('Smallest wall', (p) => `${p.wall} mm`), row('Slab, lintel, roof layer', (p) => `${p.slab} mm`),
    row('Pier, post, chimney', (p) => `${p.pier} mm`), row('Smallest opening', (p) => `${p.hole} mm`), row('Steepest overhang without supports', (p) => `${p.overhang}° from the vertical`),
    row('Longest bridge without supports', (p) => `${p.bridge} mm`), row('Lowest step (lower: a ramp)', (p) => `${p.step} mm`), row('Clearance (reported, not used)', (p) => `${p.clearance} mm`),
  ].join('\n') + '\n';
}

const fill = (file, marker, body) => {
  const t = fs.readFileSync(path.join(TEMPLATES, file), 'utf8'), i = t.indexOf(`<!-- ${marker}`);
  if (i < 0) throw new Error(`${file}: marker <!-- ${marker} missing`);
  return t.slice(0, i) + body;
};

/** every reference file of the skill: name → text (and examples / schema as files to copy) */
export function references() {
  const out = {
    'printers.md': fill('printers.md', 'PRINTERS', printers()),
    'print-profiles.md': (() => { const t = fs.readFileSync(path.join(TEMPLATES, 'print-profiles.md'), 'utf8'); return t.replace(/<!-- PROFILES[^>]*-->\n/, profiles()); })(),
    'reading-plans.md': rewrite(readingPlans()),
  };
  for (const f of ['authoring-conventions.md', 'plan-schema.md', 'symbol-legend.md', 'roofs.md', 'cad-layer-heuristics.md']) {
    out[f] = `<!-- generated from skills/home-from-plan/references/${f} of Home Simulator by npm run plugin:build -->\n${rewrite(fs.readFileSync(path.join(SKILL, 'references', f), 'utf8'))}`;
  }
  return out;
}

/** files copied as they are: the JSON Schema of plan.json and the two worked examples */
export const COPIED = {
  'plan.schema.json': path.join(ROOT, 'schemas', 'plan.schema.json'),
  'examples/demo-apartment.plan.json': path.join(ROOT, 'projects', 'demo-apartment', 'source', 'plan.json'),
  'examples/sample-house.plan.json': path.join(ROOT, 'projects', 'sample-house', 'source', 'plan.json'),
};
