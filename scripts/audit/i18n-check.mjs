#!/usr/bin/env node
// i18n gate (ADR 0019): every language has the same keys with the same {placeholders}; every literal t('key') / tOr('key', …)
// used in src/ exists in the English dictionary; src/i18n/dictionaries.ts is up to date. Exit 1 on any problem.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const DIR = path.join(ROOT, 'src', 'i18n');
const langs = fs.readdirSync(DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
const dict = Object.fromEntries(langs.map((l) => [l, Object.assign({}, ...fs.readdirSync(path.join(DIR, l)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(DIR, l, f), 'utf8'))))]));
const problems = [];
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
// catalog names exist only in non-English dictionaries (English names live in data/*.json)
const catalogKey = (k) => /^(furniture|furnitureCategory|material|materialCategory)\./.test(k);
for (const l of langs) {
  for (const k of Object.keys(dict.en)) if (!(k in dict[l])) problems.push(`${l}: missing key ${k}`);
  for (const k of Object.keys(dict[l])) {
    if (!(k in dict.en) && !catalogKey(k)) problems.push(`${l}: key ${k} not in en`);
    else if (k in dict.en && ph(dict[l][k]) !== ph(dict.en[k])) problems.push(`${l}: placeholders of ${k} differ (${ph(dict[l][k])} vs ${ph(dict.en[k])})`);
  }
}
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'tests' && e.name !== 'i18n') walk(p); } else if (/\.tsx?$/.test(e.name)) files.push(p); } };
walk(path.join(ROOT, 'src'));
let used = 0;
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) { used++; if (!(m[1] in dict.en)) problems.push(`${path.relative(ROOT, f)}: t('${m[1]}') has no English text`); }
}
try { execFileSync('node', [path.join(ROOT, 'scripts/i18n/gen.mjs'), '--check'], { stdio: 'pipe' }); } catch { problems.push('src/i18n/dictionaries.ts is out of date — run npm run i18n:gen'); }
console.log(`i18n audit: ${langs.join(', ')} · ${Object.keys(dict.en).length} keys · ${used} literal t() uses · ${problems.length} problem(s)`);
for (const p of problems.slice(0, 80)) console.log('  ' + p);
process.exit(problems.length ? 1 : 0);
