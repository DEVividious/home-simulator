// One action, one place (ADR 0037) and child-level language (ADR 0043): the UI registry, the sources and the rendered chrome over
// a matrix of states pass the UI rules (scripts/audit/ui-rules.ts — the same checks `npm run audit:ui` reports).
import { describe, expect, it } from 'vitest';
import { chromeStates } from '../../../scripts/audit/ui-matrix';
import {
  handlerNames, handlerProblems, KNOWN_DUPLICATES, languageProblems, mountProblems, mounts, registryProblems, renderProblems, testidProblems, unusedKeys,
} from '../../../scripts/audit/ui-rules';
import { ACTIONS, actionShown, runAction } from '../ui/registry';
import { ui } from '../store/ui';

describe('UI registry: one action, one place', () => {
  it('unique test ids, labels in English and Polish, icons that exist', () => expect(registryProblems()).toEqual([]));
  it('every action is mounted exactly once (<ActionButton id> or useActionSlot) in src/home/ui and src/pwa', () => {
    expect(mountProblems()).toEqual([]);
    expect([...mounts().keys()].sort()).toEqual(Object.keys(ACTIONS).sort());
  });
  it('no UI file calls a registry handler directly (beyond the allow-list)', () => {
    expect(handlerNames()).toContain('newVersion');
    expect(handlerProblems()).toEqual([]);
  });
  it('a literal data-testid lives in at most one file', () => expect(testidProblems()).toEqual([]));
  it('the list of known duplicates is empty', () => expect(KNOWN_DUPLICATES).toEqual([]));
  it('button texts, hints and the welcome follow the language rules in English and Polish', () => expect(languageProblems()).toEqual([]));
  it('no dictionary key is unused', () => expect(unusedKeys()).toEqual([]));
});

describe('UI registry: running actions', () => {
  it('runAction runs only an action that is shown (advanced-only actions in simple mode do nothing)', () => {
    const u0 = ui.get();
    try {
      ui.set({ mode: 'simple', section: 'look' });
      expect(actionShown('step-expert')).toBe(false);
      expect(runAction('step-expert')).toBe(false);
      expect(ui.get().section).toBe('look');
      ui.set({ mode: 'advanced' });
      expect(runAction('step-expert')).toBe(true);
      expect(ui.get().section).toBe('expert');
    } finally { ui.set(u0); }
  });
});

describe('UI rules over the rendered chrome (both projects, en / pl, simple / advanced, desktop / phone)', () => {
  it('renders every state; no repeated test id, bars, panels and blocks within their limits, no forbidden words in simple mode', () => {
    const states = chromeStates();
    expect(states.length).toBeGreaterThan(100);
    expect(states.flatMap(renderProblems)).toEqual([]);
  });
});
