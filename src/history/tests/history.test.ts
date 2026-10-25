// Edit history (undo / redo): immutable snapshots, one entry per operation, labels for the toolbar, a bounded past.
import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, commit, HISTORY_LIMIT, initHistory, redo, redoLabel, undo, undoLabel } from '../history';

describe('history', () => {
  it('commit / undo / redo; an identical state creates no entry; a new branch clears redo', () => {
    let h = initHistory(1);
    h = commit(h, 2, 'a'); h = commit(h, 3, 'b'); h = commit(h, 3, 'nothing');
    expect(h.past).toHaveLength(2);
    expect(undoLabel(h)).toBe('b');
    h = undo(h); expect(h.present).toBe(2);
    h = undo(h); expect(h.present).toBe(1); expect(canUndo(h)).toBe(false);
    h = redo(h); expect(h.present).toBe(2); expect(canRedo(h)).toBe(true);
    h = commit(h, 9, 'c'); expect(canRedo(h)).toBe(false); expect(h.present).toBe(9);
    h = undo(h); expect(h.present).toBe(2);
  });

  it('labels: undo names the operation that led to the present state, redo the next one; empty at the ends', () => {
    let h = initHistory('s0');
    expect([undoLabel(h), redoLabel(h)]).toEqual(['', '']);
    h = commit(h, 's1', 'move: armchair'); h = commit(h, 's2', 'paint: wall');
    expect(undoLabel(h)).toBe('paint: wall');
    h = undo(h);
    expect([h.present, undoLabel(h), redoLabel(h)]).toEqual(['s1', 'move: armchair', 'paint: wall']);
    h = undo(h);
    expect([h.present, undoLabel(h), redoLabel(h)]).toEqual(['s0', '', 'move: armchair']);
    h = redo(redo(h));
    expect([h.present, undoLabel(h), redoLabel(h)]).toEqual(['s2', 'paint: wall', '']);
  });

  it('undo / redo at the ends of the history return the same object', () => {
    const h = initHistory({ n: 0 });
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('custom comparison: a structurally equal state is not a change', () => {
    const same = (a: { n: number }, b: { n: number }) => a.n === b.n;
    const h0 = initHistory({ n: 1 });
    expect(commit(h0, { n: 1 }, 'noop', same)).toBe(h0);
    expect(commit(h0, { n: 1 }, 'by reference').past).toHaveLength(1);
    expect(commit(h0, { n: 2 }, 'real', same).present).toEqual({ n: 2 });
  });

  it(`the past is bounded to ${HISTORY_LIMIT} entries — the oldest are dropped`, () => {
    let h = initHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 25; i++) h = commit(h, i, `step ${i}`);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0].state).toBe(25);
    let n = 0;
    while (canUndo(h)) { h = undo(h); n++; }
    expect(n).toBe(HISTORY_LIMIT);
    expect(h.present).toBe(25);
    expect(h.future).toHaveLength(HISTORY_LIMIT);
  });

  it('snapshots are not mutated: an earlier history object stays valid after further commits', () => {
    const h1 = commit(initHistory(['a']), ['a', 'b'], 'add b');
    const h2 = commit(h1, ['a', 'b', 'c'], 'add c');
    expect(h1.present).toEqual(['a', 'b']);
    expect(h1.past).toHaveLength(1);
    expect(undo(h2).present).toBe(h1.present);
  });
});
