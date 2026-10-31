#!/usr/bin/env node
// Genericity gate: the engine, its tooling, skills and docs must not reference any specific building.
// A line may carry the marker `i18n-ok` when its non-English text is data on purpose (e.g. CAD layer names in several
// languages); the marker never exempts building-specific tokens.
// Fails (exit 1) on tokens that identify the building this engine was extracted from, on room / opening / level ids of
// that building, and on Polish text outside the Polish dictionaries (English-first).
// Usage: node scripts/audit/no-house-refs.mjs [--list]
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SCAN = ['src', 'packages', 'scripts', 'docs', 'projects', 'data', 'schemas', 'skills', 'tools', 'public', '.cursor', 'index.html', 'vite.config.ts', 'tsconfig.json',
  'README.md', 'AGENTS.md', 'LICENSE', 'package.json', '.gitignore'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '__pycache__', 'preview']);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|webmanifest|svg|md|mdc|html|css|py|sh|txt|ya?ml|tsv)$|(^|\/)(LICENSE|\.gitignore)$/i;
const SELF = path.relative(ROOT, new URL(import.meta.url).pathname);
/** files allowed to contain Polish text */
// beyond the dictionaries: the language rules (the Polish forbidden words) and the usability data (Polish personas and the
// task goals in each persona's language) — language data by nature
const POLISH_OK = (rel) => /^src\/i18n\/pl\/[^/]+\.json$/.test(rel) || ['src/home/ui/language.json', 'scripts/usability/personas.json', 'scripts/usability/tasks.json'].includes(rel);

// Each rule: name, regex — generic shapes of the source building's identifiers (no facts about it).
const RULES = [
  ['source opening / door ids', /\b(GF|AT)-(O|D|RW|W|G)-?\d|\bAT-G[25]\b/],
  ['source window ids', /['"`]G[25]['"`]/],
  ['source level ids', /['"`](GF|ATTIC)['"`]/],
  ['source room ids', /['"`](10[1-9]|110|20[1-7])['"`]/],
  ['source drawing sheets', /\bA\.[1-7]\b/],
  ['source file prefixes', /\bHS3D_/],
  ['legacy project concept', /legacy|upgradeLegacyKitchen/i],
];
// Names, places, plot numbers, vehicles and sources of the building this engine was extracted from — kept as hashes so that the
// audit does not publish them: a lower-cased word whose SHA-256 prefix is listed, or a word containing a listed stem.
// Add one: node scripts/audit/no-house-refs.mjs --hash <word>
const WORDS = new Set(['4ed56aaf62c14cf1', '84eca0f76d2b1a23', '07fc164b8596d46a', 'c38c694be0201b1f', '573abb3ca06e6abb', '7358bd4ec877e1b6', 'a19fb0c53767e022', 'af78f0aa69f2642e', 'bcc1181753f0f259', '02297875e8d80182', '932a6a999de2d4d0', '6d30e9e6b66fc399', '9f425608e6ccf987', '089d455f519f8086', 'd9221fd5e995e913', 'e7b103cd9515d51c', 'cb32b95a01173e07', 'bfb0fb3224043407', '2adf253383e3a8b0', '5d9e55e731436482', '93fd829fb52f2541']);
const STEMS = [[9, '49e9025a8d3f47ee']];
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
function hashedHits(line) {
  const out = [];
  for (const w of line.toLowerCase().match(/[a-z0-9][a-z0-9/:._-]*[a-z0-9]|[a-z0-9]/g) ?? []) {
    if (WORDS.has(sha(w))) { out.push(w); continue; }
    for (const [n, hh] of STEMS) for (let i = 0; i + n <= w.length; i++) if (sha(w.slice(i, i + n)) === hh) { out.push(w); break; }
  }
  return out;
}
if (process.argv[2] === '--hash') { console.log(sha(String(process.argv[3] ?? '').toLowerCase())); process.exit(0); }
const DIACRITICS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

const files = [];
const walk = (p) => {
  const abs = path.join(ROOT, p);
  if (!fs.existsSync(abs)) return;
  const st = fs.statSync(abs);
  if (st.isDirectory()) { for (const e of fs.readdirSync(abs)) if (!SKIP_DIRS.has(e)) walk(path.join(p, e)); }
  else if (TEXT.test(p) && p !== SELF) files.push(p);
};
SCAN.forEach(walk);

const hits = [];
for (const rel of files) {
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [name, re] of RULES) if (re.test(line)) hits.push({ rel, line: i + 1, rule: name, text: line.trim().slice(0, 140) });
    for (const w of hashedHits(line)) hits.push({ rel, line: i + 1, rule: 'source building fact (hashed list)', text: `"${w}" in: ${line.trim().slice(0, 120)}` });
    if (!POLISH_OK(rel) && DIACRITICS.test(line) && !/i18n-ok/.test(line)) hits.push({ rel, line: i + 1, rule: 'Polish text outside a Polish dictionary', text: line.trim().slice(0, 140) });
  });
}

const byRule = {};
for (const h of hits) byRule[h.rule] = (byRule[h.rule] ?? 0) + 1;
console.log(`genericity audit: ${files.length} files scanned, ${hits.length} finding(s)`);
for (const [r, n] of Object.entries(byRule)) console.log(`  ${String(n).padStart(5)}  ${r}`);
if (hits.length && (process.argv.includes('--list') || hits.length <= 40)) for (const h of hits) console.log(`${h.rel}:${h.line}  [${h.rule}]  ${h.text}`);
process.exit(hits.length ? 1 : 0);
