// The Claude API executor of the usability sessions (scripts/usability/computer.mjs) against a stand-in for the Messages API and
// the session: the request shape of the computer toolset, the results it needs back (toolset_name on every member result, a
// screenshot after every action), the mapping of members to the session's commands, a failed action halting the rest of a turn.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error — a plain ES module of the scripts (no types)
import { keyName, MEMBERS_OFF, playSession, splitAnswer, toAct } from './computer.mjs';

type Block = { type: string; [k: string]: unknown };
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('usability executor through the Claude API: members → session commands', () => {
  it('clicks, drags, scroll, keys, hold; the cursor is kept between members', () => {
    const p = { at: null, down: null };
    expect(toAct('left_click', { coordinate: [10.4, 20] }, p)).toEqual({ cmds: [{ cmd: 'click', args: ['10', '20'] }] });
    expect(toAct('double_click', {}, p).cmds).toHaveLength(2);                          // at the kept cursor
    expect(toAct('left_click_drag', { start_coordinate: [1, 2], coordinate: [3, 4] }, p)).toEqual({ cmds: [{ cmd: 'drag', args: ['1', '2', '3', '4'] }] });
    expect(toAct('scroll', { scroll_direction: 'down', scroll_amount: 2, coordinate: [5, 6] }, p)).toEqual({ cmds: [{ cmd: 'scroll', args: ['5', '6', '200'] }] });
    expect(toAct('scroll', { scroll_direction: 'left', scroll_amount: 1 }, p).error).toBeTruthy();
    expect(toAct('key', { text: 'ctrl+z', repeat: 2 }, p)).toEqual({ cmds: [{ cmd: 'key', args: ['Control+z'] }, { cmd: 'key', args: ['Control+z'] }] });
    expect(toAct('hold_key', { text: 'w', duration: 2 }, p)).toEqual({ cmds: [{ cmd: 'hold', args: ['w', '2'] }] });
    expect(keyName('Return')).toBe('Enter'); expect(keyName('Escape')).toBe('Escape'); expect(keyName('shift+Tab')).toBe('Shift+Tab');
    expect(toAct('screenshot', {}, p)).toEqual({ cmds: [{ cmd: 'wait', args: [] }] });
    expect(toAct('left_click', { coordinate: [1, 1], text: 'shift' }, p).error).toBeTruthy();
  });
  it('mouse down, wait, mouse up = press and hold for the waited time (the walk pad)', () => {
    const p = { at: null, down: null };
    expect(toAct('left_mouse_down', {}, p).error).toBeTruthy();                          // nowhere yet
    expect(toAct('mouse_move', { coordinate: [80, 700] }, p)).toEqual({ text: 'OK' });
    expect(toAct('left_mouse_down', {}, p)).toEqual({ text: 'OK' });
    expect(toAct('wait', { duration: 2 }, p)).toEqual({ text: 'OK' });
    expect(toAct('left_mouse_up', {}, p)).toEqual({ cmds: [{ cmd: 'hold', args: ['80', '700', '2'] }] });
    expect(toAct('wait', { duration: 1 }, p)).toEqual({ cmds: [{ cmd: 'wait', args: [] }] }); // released: an ordinary look again
  });
  it('the screenshot path is taken out of the text the model sees', () => {
    expect(splitAnswer('Task 1 of 2: Go up.\nScreenshot: /x/T1-step-0.png')).toEqual({ text: 'Task 1 of 2: Go up.', shot: '/x/T1-step-0.png' });
    expect(splitAnswer('Screenshot: /x/a.png')).toEqual({ text: 'OK', shot: '/x/a.png' });
  });
});

describe('usability executor through the Claude API: the loop', () => {
  it('plays a session: request shape, results with toolset_name and screenshots, persona tools to session commands', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'usability-api-')); dirs.push(dir);
    const shot = join(dir, 'shot.png'); writeFileSync(shot, Buffer.from('png'));
    const acted: { cmd: string; args: string[]; say?: string | null }[] = [];
    const act = async (b: { cmd: string; args: string[]; say?: string | null }) => {
      acted.push(b);
      if (b.cmd === 'done') return { ok: true, text: 'Task finished.\nAll tasks finished. Now answer the questionnaire with the "sus" command, then run "end".' };
      if (b.cmd === 'sus' || b.cmd === 'end' || b.cmd === 'note') return { ok: true, text: 'Noted.' };
      return { ok: true, text: `${b.cmd === 'start' ? 'Task 1 of 1: Go up to the first floor.\n' : ''}Screenshot: ${shot}` };
    };
    const tu = (id: string, name: string, input: object, computer = true) => ({ type: 'tool_use', id, name, input, ...(computer ? { toolset_name: 'computer' } : {}) });
    const script = [
      [tu('a', 'say', { text: 'First floor button' }, false), tu('b', 'left_click', { coordinate: [640, 760] }), tu('c', 'screenshot', {})],
      [tu('d', 'task_done', { say: 'I see the upstairs' }, false)],
      [tu('e', 'answer_questionnaire', { answers: [5, 1, 5, 1, 4, 2, 5, 1, 5, 1], summary: 'Easy.' }, false)],
    ];
    const requests: { headers: Record<string, string>; body: { tools: Block[]; messages: { role: string; content: Block[] }[]; model: string; fallbacks?: string } }[] = [];
    const fetchImpl = async (_url: string, init: { headers: Record<string, string>; body: string }) => {
      requests.push({ headers: init.headers, body: JSON.parse(init.body) });
      const content = script[requests.length - 1];
      return { ok: true, json: async () => ({ model: 'claude-sonnet-5-5', content, stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } }) };
    };
    const r = await playSession({ dir, persona: 'kid10', tasks: 1, act, fetchImpl, env: { ANTHROPIC_API_KEY: 'test-key' } });

    expect(r).toMatchObject({ finished: true, turns: 3, served: ['claude-sonnet-5-5'], requested: 'claude-sonnet-5-5', usage: { input_tokens: 30, output_tokens: 15 } });
    const q = requests[0];
    expect(q.headers['x-api-key']).toBe('test-key');
    expect(q.headers['anthropic-version']).toBe('2023-06-01');
    expect(q.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    expect(q.body.fallbacks).toBe('default');
    const toolset = q.body.tools[0];
    expect(toolset.type).toBe('computer_toolset_20260801');
    expect(toolset.name).toBeUndefined();
    expect(Object.keys(toolset.configs as object).sort()).toEqual([...MEMBERS_OFF].sort());
    expect(q.body.tools.slice(1).map((t) => t.name)).toEqual(['say', 'task_done', 'give_up', 'note', 'answer_questionnaire']);
    // the first message: the task and the first screenshot
    expect(q.body.messages[0].content.map((b) => b.type)).toEqual(['text', 'text', 'image']);
    // the results of turn 1: in order, toolset_name echoed on computer members only, an image after every action
    const res = requests[1].body.messages.at(-1)!.content as Block[];
    expect(res.map((b) => [b.tool_use_id, b.toolset_name ?? null])).toEqual([['a', null], ['b', 'computer'], ['c', 'computer']]);
    expect((res[1].content as Block[]).some((c) => c.type === 'image')).toBe(true);
    // session commands: the thought goes with the next action
    expect(acted.map((a) => a.cmd)).toEqual(['start', 'click', 'wait', 'done', 'sus', 'end']);
    expect(acted[1]).toMatchObject({ args: ['640', '760'], say: 'First floor button' });
    expect(acted[3].say).toBe('I see the upstairs');
    expect(acted[4].args).toEqual(['5,1,5,1,4,2,5,1,5,1']);
  });

  it('a failed action halts the rest of the turn ("Not executed …"), and no credentials stop it before any request', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'usability-api-')); dirs.push(dir);
    const shot = join(dir, 's.png'); writeFileSync(shot, Buffer.from('png'));
    const act = async (b: { cmd: string }) => (b.cmd === 'start' ? { ok: true, text: `Task 1 of 1: x\nScreenshot: ${shot}` } : b.cmd === 'giveup' || b.cmd === 'sus' || b.cmd === 'end' ? { ok: true, text: 'ok' } : { ok: false, text: 'click: expected a number' });
    const turns = [
      [{ type: 'tool_use', id: 'a', name: 'scroll', toolset_name: 'computer', input: { scroll_direction: 'left', scroll_amount: 1, coordinate: [1, 1] } },
        { type: 'tool_use', id: 'b', name: 'left_click', toolset_name: 'computer', input: { coordinate: [1, 1] } }],
      [{ type: 'tool_use', id: 'c', name: 'answer_questionnaire', input: { answers: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3], summary: '' } }],
    ];
    const sent: { messages: { content: Block[] }[] }[] = [];
    const fetchImpl = async (_u: string, init: { body: string }) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ model: 'm', content: turns[sent.length - 1], stop_reason: 'tool_use', usage: {} }) }; };
    await playSession({ dir, persona: 'seniorPhone', tasks: 1, act, fetchImpl, env: { ANTHROPIC_API_KEY: 'k' } });
    const res = sent[1].messages.at(-1)!.content;
    expect(res.map((b) => [b.is_error, (b.content as Block[])[0].text])).toEqual([[true, 'Only up and down scrolling is available.'], [true, 'Not executed: an earlier computer action in this turn failed.']]);
    await expect(playSession({ dir, persona: 'kid10', tasks: 1, act, fetchImpl, env: {} })).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});
