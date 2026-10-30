// E2E suite runner: one build (npx vite build), the browser tests in parallel processes (every test has its own server port,
// its own temporary user-data directory and its own output directory — safe to run side by side), longest first, the time of
// every test, a memory guard (no new test starts while free memory is below 3 GB).
// Usage: node scripts/verify/run_suite.mjs [--workers N (3)] [--only core,pwa] [--no-build]
//        HOME_SIM_BROWSER=auto|gpu|swiftshader is passed on to the tests.
// Report: reports/e2e/suite.json (+ a table in the console). Exit code 1 when any test fails or does not report its result.
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { resolve } from 'node:path';
import { ROOT } from './browser.mjs';

const OUT = resolve(ROOT, 'reports/e2e');
mkdirSync(OUT, { recursive: true });
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const workers = Math.max(1, Number(arg('workers', '3')) || 3);
const only = (arg('only', '') ?? '').split(',').filter(Boolean);

/** [name, script, relative duration (order: longest first), extra arguments] */
const ALL = [
  ['core', 'verify_core.mjs', 10],
  ['core-grid', 'verify_core.mjs', 9, ['--shell', 'grid']],
  ['mobile', 'verify_mobile.mjs', 8],
  ['pwa', 'verify_pwa.mjs', 7],
  ['mounted', 'verify_mounted.mjs', 5],
  ['electrical', 'verify_electrical.mjs', 5],
  ['shell', 'verify_shell.mjs', 3],
];
const unknown = only.filter((n) => !ALL.some(([x]) => x === n));
if (unknown.length) { console.error(`unknown test(s): ${unknown.join(', ')} — available: ${ALL.map(([n]) => n).join(', ')}`); process.exit(2); }
const TESTS = ALL.filter(([n]) => !only.length || only.includes(n));

const fmt = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const t0 = Date.now();
let buildMs = 0;
if (!process.argv.includes('--no-build')) {
  const b = Date.now();
  process.stdout.write('build (npx vite build)… ');
  try { execSync('npx vite build', { cwd: ROOT, stdio: 'pipe' }); } catch (e) { console.log('FAILED'); console.error(String(e.stdout ?? '') + String(e.stderr ?? '')); process.exit(1); }
  buildMs = Date.now() - b;
  console.log(fmt(buildMs));
}

const results = [];
function runOne([name, script, , extra = []]) {
  return new Promise((done) => {
    const start = Date.now();
    // the build is fresh: the tests do not build again
    const p = spawn(process.execPath, [`scripts/verify/${script}`, '--no-build', ...extra], { cwd: ROOT, env: process.env });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', (e) => { out += String(e); });
    p.on('close', (code) => {
      const ms = Date.now() - start;
      const all = [...out.matchAll(/(\d+) PASS, (\d+) FAIL/g)], m = all.at(-1);
      const renderer = (out.match(/^\[browser\] (.*)$/m) ?? out.match(/^renderer: (.*)$/m) ?? [])[1] ?? null;
      const fails = out.split('\n').filter((l) => /^\s*FAIL \|/.test(l)).map((l) => l.trim().slice(0, 240));
      const r = { name, script, ms, time: fmt(ms), pass: m ? Number(m[1]) : null, fail: m ? Number(m[2]) : null, code, renderer, fails, ...(m ? {} : { tail: out.trim().split('\n').slice(-15).join('\n') }) };
      writeFileSync(resolve(OUT, `${name}.log`), out);
      results.push(r);
      console.log(`  ${name.padEnd(11)} ${r.time.padStart(6)}  ${String(r.pass ?? '?').padStart(4)} PASS ${String(r.fail ?? '?').padStart(4)} FAIL${code ? `  (exit ${code})` : ''}`);
      for (const f of fails) console.log(`      ${f}`);
      if (!m) console.log(`      no "N PASS, M FAIL" line — last output:\n${r.tail.replace(/^/gm, '        ')}`);
      done(r);
    });
  });
}

const queue = [...TESTS].sort((a, b) => b[2] - a[2]);
async function worker() {
  while (queue.length) {
    while (freemem() < 3 * 1024 ** 3) { console.log('  (waiting — low free memory)'); await new Promise((r) => setTimeout(r, 15000)); }
    const t = queue.shift();
    if (t) await runOne(t);
  }
}
console.log(`running ${TESTS.length} test(s) with ${Math.min(workers, TESTS.length)} worker(s), browser profile ${process.env.HOME_SIM_BROWSER ?? 'auto'}`);
await Promise.all(Array.from({ length: Math.min(workers, TESTS.length) }, worker));

const total = Date.now() - t0;
const ordered = TESTS.map(([n]) => results.find((r) => r.name === n));
const pass = ordered.reduce((s, r) => s + (r.pass ?? 0), 0), fail = ordered.reduce((s, r) => s + (r.fail ?? 0), 0);
const broken = ordered.filter((r) => r.pass === null || (r.code && !r.fail));
console.log(`\n${'test'.padEnd(12)} ${'time'.padStart(6)} ${'PASS'.padStart(5)} ${'FAIL'.padStart(5)}  renderer`);
for (const r of ordered) console.log(`${r.name.padEnd(12)} ${r.time.padStart(6)} ${String(r.pass ?? '?').padStart(5)} ${String(r.fail ?? '?').padStart(5)}  ${r.renderer ?? ''}`);
console.log(`${'total'.padEnd(12)} ${fmt(total).padStart(6)} ${String(pass).padStart(5)} ${String(fail).padStart(5)}  (build ${fmt(buildMs)}, ${workers} worker(s))`);
const report = { at: new Date(t0).toISOString(), profile: process.env.HOME_SIM_BROWSER ?? 'auto', workers, buildMs, totalMs: total, total: fmt(total), pass, fail, results: ordered };
writeFileSync(resolve(OUT, 'suite.json'), JSON.stringify(report, null, 2));
if (broken.length) console.log(`no result / crashed: ${broken.map((r) => `${r.name} (exit ${r.code})`).join(', ')}`);
// a test that crashed without its result line counts as one failure in the summary
console.log(`\n${pass} PASS, ${fail + broken.length} FAIL`);
process.exit(fail || broken.length || ordered.some((r) => r.code) ? 1 : 0);
