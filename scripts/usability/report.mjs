// Usability report (ADR 0045) from the sessions of one run: per persona and task — success (hidden checker), actions against the
// shortest path and the threshold, the first click, actions without effect, the time by the keystroke-level model, quotes;
// confusion notes, dead ends, jargon seen on screen, SUS; thresholds of the release criteria; issues from issues.json.
// Usage: node scripts/usability/report.mjs reports/usability/<run>   → report.md, report.json in that directory.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ROOT } from '../verify/browser.mjs';
import { PERSONAS, TASKS, readJson } from './lib.mjs';

const RULES = JSON.parse(readFileSync(join(ROOT, 'src/home/ui/language.json'), 'utf8'));
const root = resolve(ROOT, process.argv[2] ?? '');
if (!existsSync(join(root, 'sessions.json'))) { console.error(`no sessions.json in ${root}`); process.exit(2); }
const meta = readJson(join(root, 'sessions.json'));

/** keystroke-level model [s]: M mental 1.35, P point 1.1, B button 0.2, K key 0.28 */
const KLM = { click: 1.35 + 1.1 + 0.2, tap: 1.35 + 1.1 + 0.2, drag: 1.35 + 1.1 + 0.2 + 1.1 + 0.2, scroll: 1.35 + 1.1, key: 1.35 + 0.28, wait: 1.35 };
const klm = (a) => (a.cmd === 'type' ? 1.35 + 0.28 * a.args.join(' ').length : KLM[a.cmd] ?? 0);
const susScore = (a) => a.reduce((s, x, i) => s + (i % 2 === 0 ? x - 1 : 5 - x), 0) * 2.5;
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** forbidden words in a visible text (simple mode only) */
function jargon(text, lang) {
  const hits = new Set(), low = text.toLowerCase();
  for (const w of RULES.forbidden[lang] ?? []) if (new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(low)) hits.add(w);
  for (const w of RULES.forbiddenCaseSensitive[lang] ?? []) if (new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(text)) hits.add(w);
  return [...hits];
}

const rows = [], notes = [], quotes = [], susAll = [], jargonSeen = {};
for (const s of meta.sessions) {
  const dir = join(ROOT, s.dir), P = PERSONAS[s.persona];
  const log = existsSync(join(dir, 'hidden', 'log.jsonl')) ? readFileSync(join(dir, 'hidden', 'log.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const results = readJson(join(dir, 'hidden', 'results.json'), {});
  const sus = readJson(join(dir, 'hidden', 'sus.json'));
  if (sus) susAll.push({ persona: s.persona, run: s.run, score: susScore(sus.answers), say: sus.say });
  for (const rec of log) {
    if (rec.kind === 'note') notes.push({ persona: s.persona, run: s.run, task: rec.task, step: rec.step, text: rec.text, deadEnd: rec.deadEnd, tooMuch: rec.tooMuch, shot: rec.task ? relative(root, join(dir, `${rec.task}-step-${rec.step}.png`)) : null });
    if (rec.say) quotes.push({ persona: s.persona, task: rec.task, say: rec.say });
    // the screen's text only (actions and task starts) — a persona's own note is not something the app showed
    if (rec.kind !== 'note' && rec.text && rec.state?.mode !== 'advanced') for (const w of jargon(rec.text, P.lang)) (jargonSeen[w] ??= new Set()).add(`${s.persona}:${rec.task}`);
  }
  for (const id of s.tasks) {
    const task = TASKS.find((t) => t.id === id), r = results[id];
    // closing the welcome screen at the start of a session is not part of the task: neither its first click nor its count
    const acts = log.filter((x) => x.task === id && x.kind === 'action' && x.cmd !== 'wait' && !String(x.hit?.testid ?? '').startsWith('onboarding'));
    const firstAct = acts[0];
    const first = firstAct?.hit?.testid ?? (firstAct?.hit?.canvas ? '(scene)' : firstAct ? '(nothing)' : null);
    const firstOk = !!first && (task.firstOk ?? []).some((p) => first.startsWith(p));
    const limit = task.limit ?? task.best + 2;
    rows.push({
      persona: s.persona, run: s.run, task: id, success: !!r?.success, said: r?.said ?? 'not finished', tired: !!r?.tired,
      actions: acts.length, best: task.best, limit, withinLimit: acts.length <= limit, first, firstOk,
      noEffect: acts.filter((a) => a.effect === false).length, seconds: Math.round(acts.reduce((t, a) => t + klm(a), 0) * 10) / 10,
      firstShot: relative(root, join(dir, `${id}-step-0.png`)),
    });
  }
}

// thresholds (release criteria, ADR 0045)
const adults = rows.filter((r) => r.persona !== 'kid10'), kid = rows.filter((r) => r.persona === 'kid10');
const rate = (xs) => (xs.length ? xs.filter((r) => r.success).length / xs.length : null);
const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)} %`);
const limited = rows.filter((r) => ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].includes(r.task));
const thresholds = [
  ['success, adults = 100 %', pct(rate(adults)), rate(adults) === 1],
  ['success, child ≥ 90 %', pct(rate(kid)), rate(kid) !== null && rate(kid) >= 0.9],
  ['actions ≤ limit (T1–T5, T7: 4; T6: 6)', `${limited.filter((r) => r.withinLimit && r.success).length} / ${limited.length}`, limited.every((r) => r.withinLimit && r.success)],
  ['first click right ≥ 80 %', pct(rows.length ? rows.filter((r) => r.firstOk).length / rows.length : null), rows.filter((r) => r.firstOk).length >= 0.8 * rows.length],
  ['no dead ends', String(notes.filter((n) => n.deadEnd).length), !notes.some((n) => n.deadEnd)],
  ['no "needed more than one sentence"', String(notes.filter((n) => n.tooMuch).length), !notes.some((n) => n.tooMuch)],
  ['no jargon on screen (simple mode)', Object.keys(jargonSeen).join(', ') || '0', !Object.keys(jargonSeen).length],
  ['SUS ≥ 80', susAll.map((x) => `${x.persona} ${x.score}`).join(', ') || '—', susAll.length > 0 && susAll.every((x) => x.score >= 80)],
];
const issues = readJson(join(root, 'issues.json'), []);
let sha = null, renderer = null;
for (const s of meta.sessions) { const S = readJson(join(ROOT, s.dir, 'session.json')); sha ??= S?.sha; renderer ??= S?.renderer; }

const md = [
  `# Usability report — ${relative(join(ROOT, 'reports/usability'), root)}`, '',
  `Engine ${sha ?? '?'} · persona model ${meta.model} (${meta.executor === 'api' ? 'Claude API computer use' : 'Claude Code subagent'}) · project ${meta.project} · renderer ${renderer ?? '?'}`, '',
  '## Thresholds', '', '| criterion | result | met |', '|---|---|---|',
  ...thresholds.map(([k, v, ok]) => `| ${k} | ${esc(v)} | ${ok ? 'yes' : '**no**'} |`), '',
  '## Tasks', '', '| persona | run | task | success | actions / best / limit | first click | no effect | KLM s |', '|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.persona} (${PERSONAS[r.persona].device}) | ${r.run} | ${r.task} | ${r.success ? 'yes' : `**no** (${r.said}${r.tired ? ', out of patience' : ''})`} | ${r.actions} / ${r.best} / ${r.limit} | ${esc(r.first)} ${r.firstOk ? '✓' : '✗'} | ${r.noEffect} | ${r.seconds} |`), '',
  '## Confusion points', '', ...(notes.length ? notes.map((n) => `- ${n.persona} ${n.task ?? ''} step ${n.step}${n.deadEnd ? ' **dead end**' : ''}${n.tooMuch ? ' **more than one sentence**' : ''}: ${n.text}${n.shot ? ` ([screenshot](${n.shot}))` : ''}`) : ['none recorded']), '',
  '## Quotes', '', ...(quotes.length ? quotes.slice(0, 80).map((q) => `- ${q.persona} ${q.task ?? ''}: “${q.say}”`) : ['none']), '',
  '## Jargon seen in simple mode', '', ...(Object.keys(jargonSeen).length ? Object.entries(jargonSeen).map(([w, where]) => `- ${w}: ${[...where].join(', ')}`) : ['none']), '',
  '## SUS', '', ...(susAll.length ? susAll.map((x) => `- ${x.persona} run ${x.run}: ${x.score}${x.say ? ` — “${x.say}”` : ''}`) : ['not answered']), '',
  '## Issues', '', ...(issues.length ? ['| id | severity 0–4 | action ids | problem | evidence | proposal |', '|---|---|---|---|---|---|', ...issues.map((i) => `| ${i.id} | ${i.severity} | ${esc((i.actions ?? []).join(', '))} | ${esc(i.problem)} | ${esc(i.evidence)} | ${esc(i.proposal)} |`)] : ['none filed (issues.json)']), '',
];
writeFileSync(join(root, 'report.md'), md.join('\n'));
writeFileSync(join(root, 'report.json'), JSON.stringify({ sha, model: meta.model, project: meta.project, renderer, thresholds: thresholds.map(([k, v, ok]) => ({ criterion: k, result: v, met: ok })), tasks: rows, notes, quotes, jargon: Object.fromEntries(Object.entries(jargonSeen).map(([k, v]) => [k, [...v]])), sus: susAll, issues }, null, 2) + '\n');
console.log(`report: ${relative(ROOT, join(root, 'report.md'))}`);
for (const [k, v, ok] of thresholds) console.log(`  ${ok ? 'met ' : 'NOT '} ${k}: ${v}`);
