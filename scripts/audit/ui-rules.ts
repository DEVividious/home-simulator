// UI rules (ADR 0037 "one action, one place", ADR 0043 "child-level language") — shared by src/home/tests/uiRegistry.test.ts
// and `npm run audit:ui` (scripts/audit/ui-one-place.ts). Every check returns a list of problems (empty = passed):
//   • the registry: unique ids and test ids, labels in every language, icons that exist;
//   • the sources: each action mounted exactly once (<ActionButton id> / useActionSlot), no UI file calling a registry handler
//     directly (an allow-list of the few uses that are not the action), a literal data-testid in at most one file;
//   • the language: button labels of 1–2 words within the length limits, one-sentence hints of ≤ 12 words, no forbidden words
//     on screen in simple mode;
//   • the rendered chrome over a matrix of states: no repeated test id, bars within their number of controls, panels within
//     their number of blocks, blocks within their number of items;
//   • dictionary keys nothing uses.
import fs from 'node:fs';
import path from 'node:path';
import { createElement, Fragment, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dictionary, setLang } from '../../src/i18n';
import { ACTIONS, type ActionDef } from '../../src/home/ui/registry';
import { ICON_NAMES } from '../../src/home/ui/icons';
import RULES from '../../src/home/ui/language.json';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
/** duplicates known while the UI moved to one place per action — may only shrink (it ended empty) */
export const KNOWN_DUPLICATES: string[] = [];
/** UI files that may import a registry handler, and why (not the action itself) */
export const HANDLER_ALLOWED: Record<string, string[]> = {
  // switching the language or the project saves the design first
  'src/home/ui/Settings.tsx': ['save'],
  'src/home/ui/TopBar.tsx': ['save'],
  // the second half of "Compare" with more than two versions: the card picked to compare with
  'src/home/ui/SectionVariants.tsx': ['compareWith'],
  // leaving Electrical on a phone ("back" at the level of the whole home); the electrical card ends its own preview
  'src/home/ui/ElectricalPanels.tsx': ['goSection', 'cancelPreview'],
};
/** modules whose functions the registry runs — the handlers (minus what the registry only reads) */
const HANDLER_MODULES = ['../actions', '../store/design', '../store/doors', '../download', '../scene/interaction'];
const READERS = new Set(['design', 'docOf', 'arrangementOf', 'isDirty', 'mountedNow', 'doors', 'sceneViewOf']);

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');
const read = (f: string) => fs.readFileSync(f, 'utf8');
function files(dir: string, ext: RegExp, skip: (d: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!skip(e.name)) walk(p); } else if (ext.test(e.name)) out.push(p); } };
  walk(path.join(ROOT, dir));
  return out;
}
/** the UI's source files: src/home/ui and src/pwa */
export const uiFiles = () => [...files('src/home/ui', /\.tsx?$/), ...files('src/pwa', /\.tsx?$/, (d) => d === 'tests')];
const ids = Object.keys(ACTIONS) as (keyof typeof ACTIONS)[];
const def = (id: string): ActionDef => (ACTIONS as Record<string, ActionDef>)[id];

// ------------------------------------------------------------------ registry
export function registryProblems(): string[] {
  const out: string[] = [], seen = new Map<string, string>(), en = dictionary('en'), pl = dictionary('pl');
  for (const id of ids) {
    const a = def(id);
    if (seen.has(a.testid)) out.push(`test id "${a.testid}" of ${id} is also the test id of ${seen.get(a.testid)}`);
    seen.set(a.testid, id);
    if (!(a.label in en)) out.push(`${id}: label ${a.label} has no English text`);
    if (!(a.label in pl)) out.push(`${id}: label ${a.label} has no Polish text`);
    if (a.icon && !ICON_NAMES.includes(a.icon)) out.push(`${id}: icon "${a.icon}" does not exist`);
    if (!a.icon && !a.control) out.push(`${id}: a button needs an icon with its label`);
  }
  return out;
}

// ------------------------------------------------------------------ sources
/** where each action is mounted: <ActionButton id="x"> and useActionSlot('x') */
export function mounts(): Map<string, string[]> {
  const m = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const f of uiFiles()) {
    const src = read(f);
    for (const x of src.matchAll(/<ActionButton\s+id="([\w-]+)"|useActionSlot\('([\w-]+)'\)/g)) {
      const id = x[1] ?? x[2];
      if (!m.has(id)) m.set(id, []);
      m.get(id)!.push(rel(f));
    }
  }
  return m;
}
export function mountProblems(): string[] {
  const out: string[] = [];
  for (const [id, where] of mounts()) {
    if (!(id in ACTIONS)) out.push(`${where.join(', ')}: "${id}" is not in the registry`);
    else if (where.length === 0) out.push(`${id}: not mounted anywhere`);
    else if (where.length > 1 && !KNOWN_DUPLICATES.includes(id)) out.push(`${id}: mounted ${where.length} times (${where.join(', ')})`);
  }
  return out;
}
/** the names the registry imports from the handler modules */
export function handlerNames(): string[] {
  const src = read(path.join(ROOT, 'src/home/ui/registry.ts')), names = new Set<string>();
  for (const x of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) if (HANDLER_MODULES.includes(x[2])) for (const n of x[1].split(',')) { const k = n.trim().replace(/^type\s+/, ''); if (k && !/^[A-Z]/.test(k) && !n.includes('type ') && !READERS.has(k)) names.add(k); }
  return [...names].sort();
}
export function handlerProblems(): string[] {
  const out: string[] = [], handlers = handlerNames();
  for (const f of uiFiles()) {
    const r = rel(f);
    if (r === 'src/home/ui/registry.ts' || r === 'src/home/ui/Action.tsx') continue;
    for (const x of read(f).matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
      if (!HANDLER_MODULES.some((m) => x[2].endsWith(m.slice(2)))) continue;
      for (const n of x[1].split(',').map((q) => q.trim()).filter(Boolean)) if (handlers.includes(n) && !(HANDLER_ALLOWED[r] ?? []).includes(n)) out.push(`${r} imports the handler ${n} — render the action with <ActionButton> instead`);
    }
  }
  return out;
}
/** literal test ids (data-testid="x") in more than one file of the app */
export function testidProblems(): string[] {
  const where = new Map<string, Set<string>>();
  for (const f of files('src', /\.tsx$/, (d) => d === 'tests')) for (const x of read(f).matchAll(/data-testid="([^"]+)"/g)) { if (!where.has(x[1])) where.set(x[1], new Set()); where.get(x[1])!.add(rel(f)); }
  return [...where].filter(([, s]) => s.size > 1).map(([id, s]) => `data-testid="${id}" in ${[...s].join(', ')}`);
}

// ------------------------------------------------------------------ language
const words = (s: string) => s.replace(/[…+⤓↶↷←·()]/g, ' ').trim().split(/\s+/).filter(Boolean);
/** forbidden words in a text (simple mode) */
export function jargon(text: string, lang: 'en' | 'pl'): string[] {
  const low = text.toLowerCase(), hits: string[] = [];
  for (const w of (RULES.forbidden as Record<string, string[]>)[lang] ?? []) if (new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(low)) hits.push(w);
  for (const w of (RULES.forbiddenCaseSensitive as Record<string, string[]>)[lang] ?? []) if (new RegExp(`(^|[^\\p{L}])${w}($|[^\\p{L}])`, 'u').test(text)) hits.push(w);
  return hits;
}
export function languageProblems(): string[] {
  const out: string[] = [];
  for (const lang of ['en', 'pl'] as const) {
    const d = dictionary(lang), max = RULES.button.maxChars[lang];
    // buttons: the labels of plain-button actions and the save status when it is a button (saving failed)
    const buttonKeys = [...ids.filter((id) => !def(id).control && !def(id).iconOnly).map((id) => def(id).label), 'steps.save.failed'];
    for (const k of new Set(buttonKeys)) {
      const s = d[k] ?? '';
      if (words(s).length > RULES.button.maxWords) out.push(`${lang} ${k} "${s}": a button has at most ${RULES.button.maxWords} words`);
      if ([...s].length > max) out.push(`${lang} ${k} "${s}": a button has at most ${max} characters`);
    }
    for (const [k, s] of Object.entries(d).filter(([k]) => k.startsWith('steps.hint.') || k.startsWith('steps.welcome.') && k !== 'steps.welcome.start' && k !== 'steps.welcome.title')) {
      const sentences = s.split(/(?<=[.!?])\s+/).filter(Boolean);
      if (sentences.length > RULES.hint.maxSentences) out.push(`${lang} ${k} "${s}": one sentence`);
      if (words(s).length > RULES.hint.maxWords) out.push(`${lang} ${k} "${s}": at most ${RULES.hint.maxWords} words`);
    }
    for (const [k, s] of Object.entries(d).filter(([k]) => k.startsWith('steps.') && !['steps.advancedHint', 'steps.snap', 'steps.device', 'steps.expert'].includes(k))) {
      const j = jargon(s, lang);
      if (j.length) out.push(`${lang} ${k} "${s}": forbidden in simple mode — ${j.join(', ')}`);
    }
  }
  return out;
}

// ------------------------------------------------------------------ unused dictionary keys
/** keys no source uses: a key is used when it appears as a quoted string, or a quoted / template prefix ending with '.' covers it */
export function unusedKeys(): string[] {
  const sources = [
    ...files('src', /\.tsx?$/, (d) => d === 'tests' || d === 'i18n'),
    ...files('scripts', /\.(m?js|ts)$/, (d) => ['verify', 'usability', 'audit'].includes(d)),
    ...files('packages', /\.(ts|mjs)$/, (d) => d === 'node_modules' || d === 'tests' || d === 'build'),
  ].map(read).join('\n');
  const literal = new Set<string>(), prefixes = new Set<string>();
  for (const x of sources.matchAll(/'([a-zA-Z][\w.]*)'|"([a-zA-Z][\w.]*)"/g)) { const k = x[1] ?? x[2]; if (k.endsWith('.')) prefixes.add(k); else literal.add(k); }
  for (const x of sources.matchAll(/`([a-zA-Z][\w.]*)\$\{/g)) prefixes.add(x[1]);
  const keys = Object.keys(dictionary('en'));
  // a dotted literal that names a group ('electrical.status' with labels(…) adding the last part) covers its keys too
  for (const l of literal) if (l.includes('.')) prefixes.add(`${l}.`);
  return keys.filter((k) => !literal.has(k) && ![...prefixes].some((p) => p.includes('.') && k.startsWith(p)));
}

// ------------------------------------------------------------------ rendered chrome
interface Node { tag: string; attrs: Record<string, string>; children: Node[]; text: string }
const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon']);
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#?\w+);/g, (m, e: string) => ENT[e] ?? m);
/** a tree of React's server markup (well-formed: every element closed, attributes quoted) */
export function parseHtml(html: string): Node {
  const root: Node = { tag: '#root', attrs: {}, children: [], text: '' }, stack = [root];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g)) {
    if (m[5] !== undefined) { stack[stack.length - 1].text += decode(m[5]); continue; }
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = decode(a[2] ?? '');
    const n: Node = { tag: m[2].toLowerCase(), attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(n);
    if (!m[4] && !VOID.has(n.tag)) stack.push(n);
  }
  return root;
}
const all = (n: Node, pred: (x: Node) => boolean, out: Node[] = []): Node[] => { for (const c of n.children) { if (pred(c)) out.push(c); all(c, pred, out); } return out; };
const cls = (n: Node, c: string) => (n.attrs.class ?? '').split(/\s+/).includes(c);
const textOf = (n: Node): string => [n.text, n.attrs.title ?? '', n.attrs['aria-label'] ?? '', n.attrs.placeholder ?? '', ...n.children.map(textOf)].join(' ');

/** the controls a bar shows: plain action buttons, each group counted once */
function barControls(bar: Node): number {
  let n = 0;
  const walk = (x: Node) => { for (const c of x.children) { if (c.attrs['data-group'] !== undefined) { if (all(c, (q) => q.tag === 'button').length || c.tag === 'button') n++; } else if (c.tag === 'button' || c.tag === 'label' && c.children.some((q) => q.tag === 'select')) n++; else walk(c); } };
  walk(bar);
  return n;
}
/** the blocks of a panel that are not inside another block */
const topBlocks = (panel: Node): Node[] => { const out: Node[] = []; const walk = (x: Node) => { for (const c of x.children) { if (cls(c, 'hm-block')) out.push(c); else walk(c); } }; walk(panel); return out; };

export interface RenderedState { name: string; mode: 'simple' | 'advanced'; lang: 'en' | 'pl'; html: string }
/** checks of one rendered state */
export function renderProblems(st: RenderedState): string[] {
  const out: string[] = [], tree = parseHtml(st.html), tag = `[${st.name}]`;
  const seen = new Map<string, number>();
  for (const n of all(tree, (x) => x.attrs['data-testid'] !== undefined)) seen.set(n.attrs['data-testid'], (seen.get(n.attrs['data-testid']) ?? 0) + 1);
  for (const [id, n] of seen) if (n > 1 && !KNOWN_DUPLICATES.includes(id)) out.push(`${tag} test id "${id}" ${n} times`);
  for (const bar of all(tree, (x) => x.attrs['data-bar'] !== undefined)) {
    const n = barControls(bar);
    if (n > RULES.bar.maxButtons) out.push(`${tag} bar "${bar.attrs['data-bar']}": ${n} controls (at most ${RULES.bar.maxButtons})`);
  }
  if (st.mode === 'simple') {
    for (const panel of all(tree, (x) => cls(x, 'hm-section'))) {
      const blocks = topBlocks(panel);
      if (blocks.length > RULES.panel.maxBlocks) out.push(`${tag} panel ${panel.attrs['data-testid']}: ${blocks.length} blocks (at most ${RULES.panel.maxBlocks})`);
    }
    for (const block of all(tree, (x) => cls(x, 'hm-block'))) {
      const items = all(block, (x) => x.attrs['data-item'] !== undefined).length;
      if (items > RULES.block.maxItems) out.push(`${tag} block ${block.attrs['data-testid'] ?? ''}: ${items} items (at most ${RULES.block.maxItems})`);
    }
    const j = jargon(textOf(tree), st.lang);
    if (j.length) out.push(`${tag} forbidden words on screen in simple mode: ${j.join(', ')}`);
  }
  return out;
}

/** renders the app's chrome (no 3D scene) in the current store state */
export function renderChrome(parts: (() => ReactElement)[]): string {
  return renderToStaticMarkup(createElement(Fragment, null, ...parts.map((p, i) => createElement(Fragment, { key: i }, p()))));
}
export const withLang = <T,>(lang: 'en' | 'pl', fn: () => T): T => { setLang(lang); try { return fn(); } finally { setLang('en'); } };
