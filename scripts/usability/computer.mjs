// Usability executor through the Claude API (ADR 0045): a computer-use loop that plays one persona session started by run.mjs.
// The model sees only the session's screenshots and acts only through the computer toolset (computer_toolset_20260801; each
// member is passed on to the session as an act.mjs command) and five persona tools — say, task_done, give_up, note,
// answer_questionnaire. The hidden checker, the log and the report are the same as with the Claude Code subagent executor.
// Raw HTTP (fetch) on purpose: no new dependency in the repository. Credentials: ANTHROPIC_API_KEY (x-api-key) or
// ANTHROPIC_AUTH_TOKEN (Bearer); ANTHROPIC_BASE_URL points it elsewhere (a local stand-in in the tests).
// Usage: node scripts/usability/computer.mjs --session reports/usability/<run>/<persona>-<n> [--model claude-sonnet-5-5]
//        [--effort medium] [--no-fallbacks] [--max-turns 400]
//        node scripts/usability/run.mjs … --executor api   starts the sessions and runs this loop for each of them.
// Writes hidden/executor.json: the model asked for, the models that answered, turns, token usage.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, sleep } from '../verify/browser.mjs';
import { MAX_ACTIONS, PERSONAS, SUS_TEXT, hidden, readJson, sessionFile, writeJson } from './lib.mjs';

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
/** toolset members the session cannot do like a person would (no hover, no zoom, no right / middle / triple click) */
export const MEMBERS_OFF = ['zoom', 'right_click', 'middle_click', 'triple_click', 'cursor_position'];
const NOT_RUN = 'Not executed: an earlier computer action in this turn failed.';

const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const str = (description) => ({ type: 'string', description });
/** the persona's own tools (everything else is the computer toolset) */
export const PERSONA_TOOLS = [
  { name: 'say', description: 'Think aloud: one short sentence in the person\'s own words and language. It is recorded with your next action.', input_schema: obj({ text: str('the thought') }), strict: true },
  { name: 'task_done', description: 'You believe the current task is done. The next task starts by itself and its first screenshot comes back.', input_schema: obj({ say: str('how it felt, one short sentence as the person') }), strict: true },
  { name: 'give_up', description: 'The person would give up on the current task. The next task starts by itself.', input_schema: obj({ say: str('why, one short sentence as the person') }), strict: true },
  {
    name: 'note', description: 'Something confused the person. Mark dead_end when there was no way forward, too_much_text when the person needed more than one sentence to understand.',
    input_schema: obj({ text: str('what was confusing'), dead_end: { type: 'boolean' }, too_much_text: { type: 'boolean' } }), strict: true,
  },
  {
    name: 'answer_questionnaire', description: 'At the very end: the ten System Usability Scale answers as the person (1 = strongly disagree … 5 = strongly agree), in order.',
    input_schema: obj({ answers: { type: 'array', items: { type: 'integer', enum: [1, 2, 3, 4, 5] } }, summary: str('a short summary in the person\'s voice: each task, how it felt, the three most confusing moments') }), strict: true,
  },
];

/** xdotool-style key names (as the model writes them) → the browser's key names */
const KEYS = { return: 'Enter', enter: 'Enter', esc: 'Escape', escape: 'Escape', backspace: 'Backspace', delete: 'Delete', tab: 'Tab', space: 'Space',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', page_up: 'PageUp', page_down: 'PageDown', home: 'Home', end: 'End',
  ctrl: 'Control', control: 'Control', alt: 'Alt', shift: 'Shift', super: 'Meta', cmd: 'Meta', meta: 'Meta' };
export const keyName = (k) => String(k).split('+').map((p) => KEYS[p.trim().toLowerCase()] ?? (p.trim().length === 1 ? p.trim() : p.trim())).join('+');

/**
 * One toolset member → session commands (act.mjs). `pointer` is the cursor the loop keeps: the last point and a pressed
 * button (left_mouse_down … wait … left_mouse_up = press and hold for the waited time). Returns { cmds } or { error }, or
 * { text } for members that only change the loop's own state.
 */
export function toAct(name, input = {}, pointer = { at: null, down: null }) {
  const xy = (c) => (Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) ? c.map(Math.round) : null);
  const at = xy(input.coordinate) ?? pointer.at;
  if (['left_click', 'double_click', 'left_click_drag', 'scroll'].includes(name) && input.text) return { error: 'Clicking with keys held is not available.' };
  switch (name) {
    case 'screenshot': return { cmds: [{ cmd: 'wait', args: [] }] };
    case 'left_click':
    case 'double_click':
      if (!at) return { error: 'No coordinate given and the cursor has not been placed yet.' };
      pointer.at = at;
      return { cmds: Array.from({ length: name === 'double_click' ? 2 : 1 }, () => ({ cmd: 'click', args: at.map(String) })) };
    case 'left_click_drag': {
      const a = xy(input.start_coordinate) ?? pointer.at, b = xy(input.coordinate);
      if (!a || !b) return { error: 'A drag needs start_coordinate and coordinate.' };
      pointer.at = b;
      return { cmds: [{ cmd: 'drag', args: [...a, ...b].map(String) }] };
    }
    case 'mouse_move': if (!at) return { error: 'mouse_move needs a coordinate.' }; pointer.at = at; return { text: 'OK' };
    case 'left_mouse_down': if (!pointer.at) return { error: 'Move the mouse to a point first.' }; pointer.down = { at: pointer.at, s: 0 }; return { text: 'OK' };
    case 'left_mouse_up': {
      if (!pointer.down) return { error: 'The button is not pressed.' };
      const d = pointer.down; pointer.down = null;
      return { cmds: [{ cmd: 'hold', args: [...d.at.map(String), String(Math.min(10, Math.max(0.3, d.s || 1)))] }] };
    }
    case 'scroll': {
      const dir = input.scroll_direction, n = Math.max(1, Math.min(20, Math.round(input.scroll_amount ?? 3)));
      if (dir !== 'up' && dir !== 'down') return { error: 'Only up and down scrolling is available.' };
      if (!at) return { error: 'No coordinate given and the cursor has not been placed yet.' };
      return { cmds: [{ cmd: 'scroll', args: [...at.map(String), String((dir === 'down' ? 1 : -1) * 100 * n)] }] };
    }
    case 'type': return { cmds: [{ cmd: 'type', args: [String(input.text ?? '')] }] };
    case 'key': return { cmds: Array.from({ length: Math.max(1, Math.min(10, input.repeat ?? 1)) }, () => ({ cmd: 'key', args: [keyName(input.text)] })) };
    case 'hold_key': return { cmds: [{ cmd: 'hold', args: [keyName(input.text), String(Math.min(10, Math.max(0.1, input.duration ?? 1)))] }] };
    case 'wait':
      if (pointer.down) { pointer.down.s += Number(input.duration) || 1; return { text: 'OK' }; }  // part of a press and hold
      return { cmds: [{ cmd: 'wait', args: [] }] };
    default: return { error: `${name} is not available.` };
  }
}

/** the system prompt: the persona and the rules (the same rules as the subagent's prompt.md, in tool terms) */
export function systemPrompt(personaId, n) {
  const p = PERSONAS[personaId];
  return `# Usability test — you play a person using an app

${p.brief}

Device: ${p.device}. Screen ${p.viewport.width} × ${p.viewport.height} pixels.${p.touch ? ' This is a touch screen: a left_click is a tap of your finger, a drag is a swipe.' : ''}

You are testing a home design app the way this person would. You get ${n} small tasks, one at a time.

## Rules (strict)
- You see the app ONLY through the screenshots that come back after every action. Coordinates are pixels of those screenshots.
- You act ONLY with the computer tools (click, drag, scroll, type, key, hold_key; left_mouse_down, wait, left_mouse_up to press
  and hold; wait to look again) and the tools say, task_done, give_up, note and answer_questionnaire.
- Behave like the person: notice what they would notice, read only as much as they would read, guess like they would. Do not
  use knowledge of how such apps are built. If something is unclear to the person, it is unclear to you.
- Use say to think aloud in the person's own words and language (one short sentence) before an action that matters.
- When you believe a task is done, call task_done; if the person would give up, call give_up. The next task then starts by
  itself. After ${MAX_ACTIONS} actions on one task the person runs out of patience.
- When something confuses the person, call note (dead_end when there was no way forward, too_much_text when the person needed
  more than one sentence to understand).
- At the end answer the ten System Usability Scale statements as this person, in this order: ${SUS_TEXT}
  Call answer_questionnaire with the ten answers and a short summary in the person's voice.`;
}

/** the session's answer → text for the model (without the screenshot path) and the screenshot file */
export function splitAnswer(text) {
  const shot = text.match(/^Screenshot: (.+\.png)$/m)?.[1] ?? null;
  return { text: text.replace(/^Screenshot: .+$/m, '').trim() || 'OK', shot };
}

/** a command to the running session (the same channel as act.mjs) */
export function sessionAct(dir) {
  const S = readJson(sessionFile(dir));
  if (!S?.control) throw new Error(`no running session in ${dir}`);
  return async (body) => {
    const r = await fetch(`http://127.0.0.1:${S.control}/`, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
    return r.json();
  };
}

/** one Messages API request with retries on overload and rate limits */
async function messages(req, { fetchImpl, base, headers }) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetchImpl(`${base}/v1/messages`, { method: 'POST', headers, body: JSON.stringify(req) });
    if (r.ok) return r.json();
    const body = await r.text();
    if ((r.status === 429 || r.status >= 500) && attempt < 5) { await sleep(1000 * Math.max(Number(r.headers.get?.('retry-after')) || 0, 2 ** attempt)); continue; }
    throw new Error(`Messages API ${r.status}: ${body.slice(0, 400)}`);
  }
}

/**
 * Plays one persona session to the end. act — sends a command to the session ({cmd, args, say, deadEnd, tooMuch} → {ok, text});
 * image — reads a screenshot file as base64. Returns { turns, usage, served, finished }.
 */
export async function playSession({ dir, persona, tasks, model = DEFAULT_MODEL, effort = 'medium', fallbacks = true, maxTurns = 400,
  act, image = (f) => readFileSync(f).toString('base64'), fetchImpl = fetch, env = process.env }) {
  const base = (env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const auth = env.ANTHROPIC_API_KEY ? { 'x-api-key': env.ANTHROPIC_API_KEY } : env.ANTHROPIC_AUTH_TOKEN ? { authorization: `Bearer ${env.ANTHROPIC_AUTH_TOKEN}` } : null;
  if (!auth) throw new Error('no ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) in the environment');
  const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...auth, ...(fallbacks ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}) };
  const tools = [{ type: 'computer_toolset_20260801', configs: Object.fromEntries(MEMBERS_OFF.map((m) => [m, { enabled: false }])) }, ...PERSONA_TOOLS];
  const shotBlock = (f) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image(f) } });
  const reply = (r) => { const a = splitAnswer(r.text ?? ''); return [{ type: 'text', text: a.text }, ...(a.shot ? [shotBlock(a.shot)] : [])]; };

  const first = await act({ cmd: 'start', args: [] });
  if (!first.ok) throw new Error(`the session did not start: ${first.text}`);
  const msgs = [{ role: 'user', content: [{ type: 'text', text: 'The test begins.' }, ...reply(first)] }];
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, served = new Set();
  const pointer = { at: null, down: null };
  let said = null, finished = false, idle = 0, turns = 0;
  while (!finished && turns < maxTurns) {
    turns++;
    const res = await messages({
      model, max_tokens: 16000, system: systemPrompt(persona, tasks), tools, messages: msgs, output_config: { effort },
      cache_control: { type: 'ephemeral' }, ...(fallbacks ? { fallbacks: 'default' } : {}),
    }, { fetchImpl, base, headers });
    served.add(res.model);
    for (const k of Object.keys(usage)) usage[k] += res.usage?.[k] ?? 0;
    msgs.push({ role: 'assistant', content: res.content });
    if (res.stop_reason === 'refusal') throw new Error(`the model declined (${res.stop_details?.category ?? 'no category'})`);
    const calls = res.content.filter((b) => b.type === 'tool_use');
    if (!calls.length) {
      if (++idle > 3) { await act({ cmd: 'giveup', args: [], say: 'stopped acting' }); break; }
      msgs.push({ role: 'user', content: [{ type: 'text', text: 'Go on as the person: act on the screen with the tools, or call task_done / give_up.' }] });
      continue;
    }
    idle = 0;
    const results = [];
    let failed = false;
    for (const b of calls) {
      const out = (content, isError = false) => results.push({ type: 'tool_result', tool_use_id: b.id, ...(b.toolset_name ? { toolset_name: b.toolset_name } : {}), content, ...(isError ? { is_error: true } : {}) });
      if (failed) { out([{ type: 'text', text: NOT_RUN }], true); continue; }
      if (b.toolset_name === 'computer') {
        const m = toAct(b.name, b.input, pointer);
        if (m.error) { out([{ type: 'text', text: m.error }], true); failed = true; continue; }
        if (m.text) { out([{ type: 'text', text: m.text }]); continue; }
        let r = null;
        for (const c of m.cmds) { r = await act({ ...c, say: said }); said = null; if (!r.ok) break; }
        if (!r.ok) { out([{ type: 'text', text: r.text }], true); failed = true; continue; }
        out(reply(r));
        if (/All tasks finished/.test(r.text)) pointer.down = null;
        continue;
      }
      const i = b.input ?? {};
      if (b.name === 'say') { said = String(i.text ?? '').slice(0, 300); out([{ type: 'text', text: 'OK' }]); continue; }
      if (b.name === 'note') { const r = await act({ cmd: 'note', args: [String(i.text ?? '')], deadEnd: !!i.dead_end, tooMuch: !!i.too_much_text }); out([{ type: 'text', text: r.text }]); continue; }
      if (b.name === 'task_done' || b.name === 'give_up') { const r = await act({ cmd: b.name === 'task_done' ? 'done' : 'giveup', args: [], say: i.say ?? said }); said = null; out(reply(r), !r.ok); continue; }
      if (b.name === 'answer_questionnaire') {
        const r = await act({ cmd: 'sus', args: [(i.answers ?? []).join(',')], say: i.summary ?? null });
        if (!r.ok) { out([{ type: 'text', text: r.text }], true); continue; }
        writeJson(hidden(dir, 'summary.json'), { summary: i.summary ?? null });
        await act({ cmd: 'end', args: [] }).catch(() => null);
        out([{ type: 'text', text: 'Thank you — the test is over.' }]);
        finished = true;
        continue;
      }
      out([{ type: 'text', text: `Unknown tool ${b.name}.` }], true);
    }
    msgs.push({ role: 'user', content: results });
  }
  const record = { executor: 'claude-api', requested: model, served: [...served], effort, fallbacks, turns, usage, finished };
  writeJson(hidden(dir, 'executor.json'), record);
  return record;
}

// command line: one session
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const dir = resolve(ROOT, arg('session', ''));
  const S = readJson(sessionFile(dir));
  if (!S) { console.error(`no session in ${dir} — start one with scripts/usability/run.mjs`); process.exit(2); }
  try {
    const r = await playSession({ dir, persona: S.persona, tasks: S.tasks.length, model: arg('model', S.model ?? DEFAULT_MODEL), effort: arg('effort', 'medium'),
      fallbacks: !process.argv.includes('--no-fallbacks'), maxTurns: Number(arg('max-turns', '400')), act: sessionAct(dir) });
    console.log(`${S.persona}: ${r.finished ? 'finished' : 'stopped'} in ${r.turns} turns (${r.served.join(', ')}); tokens in ${r.usage.input_tokens} + cache ${r.usage.cache_read_input_tokens}, out ${r.usage.output_tokens}`);
  } catch (e) {
    console.error(String(e?.message ?? e));
    await sessionAct(dir)({ cmd: 'end', args: [] }).catch(() => {});
    process.exit(1);
  }
}
