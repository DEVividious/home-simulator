// Complete variants: optional variant fields (stairs finish, own electrical layout, view, sun, thumbnail), validation, variant
// operations that keep the rest of the variant, export / import of a variant (schema, project, new id, unique name, data
// validation), A/B comparison sides (variants and room arrangements), screenshot metadata in PNG.
import { afterEach, describe, expect, it } from 'vitest';
import { createVariant, defaultDoc, docErrors, parseDoc, serializeDoc, type ConfiguratorDoc, type Variant } from '../../document/model';
import { initHistory } from '../../history/history';
import { duplicateProjectVariant, deleteProjectVariant, newVariant, projectDefaultVariant, renameProjectVariant, resetVariantToProject, uniqueVariantName } from '../actions';
import { resolvePlan } from '../model/electrical';
import { defaultInterior } from '../model/interiors';
import { exportVariant, importVariant, sameDesign, VARIANT_SCHEMA, variantExtrasErrors } from '../model/variantData';
import { pngText, pngWithText } from '../screenshot';
import { design, docOf, undo, variantOf } from '../store/design';
import { sidesOf } from '../store/sides';

const B_EXTRAS: Partial<Variant> = {
  view: { position: [-2, 2, 6], target: [4.5, 3.5, 1.2], fov: 45, environment: false }, sun: { date: '2026-06-21', minutes: 1080 },
  thumbnail: 'data:image/jpeg;base64,/9j/AAAA', updatedAt: '2026-10-02T12:00:00.000Z',
};
function twoVariants(): ConfiguratorDoc {
  const d = defaultDoc(), b: Variant = { ...createVariant('Variant B', 'v-b'), ...B_EXTRAS };
  b.interiors = { R2: { ...defaultInterior('R2'), arrangements: [{ ...defaultInterior('R2').arrangements[0], name: 'Study B' }] } };
  return { ...d, variants: [d.variants[0], b] };
}
const docWith = (v: Variant): ConfiguratorDoc => ({ ...defaultDoc(), variants: [v], activeVariantId: v.id });

describe('variant: optional fields', () => {
  it('a document with and without them passes validation; save → load loses nothing', () => {
    const d = twoVariants();
    expect(docErrors(d)).toEqual([]);
    expect(parseDoc(serializeDoc(d))).toEqual(d);
    expect(variantExtrasErrors(d.variants[0])).toEqual([]);
    expect(variantExtrasErrors(d.variants[1])).toEqual([]);
  });
  it('validation: view, date and time, thumbnail (image data URL), stairs finish, own electrical layout', () => {
    const v: Variant = {
      ...createVariant('A'),
      view: { position: [0, 0], target: [0, 0, 0], fov: 200, environment: true } as never, sun: { date: '21.06.2026', minutes: 2000 }, thumbnail: 'http://x/y.png',
      stairs: { treadThickness: 0.5, handrail: { place: 'everywhere' as never } }, electrical: { version: 2 } as never,
    };
    const e = variantExtrasErrors(v).join(' | ');
    for (const re of [/view: position, target, fov 10–120/, /sun: date YYYY-MM-DD/, /thumbnail: image data URL/, /stairs\.treadThickness/, /stairs\.handrail\.place/, /electrical \(variant\): expected \{ version: 1/]) expect(e).toMatch(re);
    expect(docErrors(docWith(v)).join(' | ')).toMatch(/^A \/ /);
    expect(variantExtrasErrors({ ...createVariant('A'), thumbnail: `data:image/png;base64,${'A'.repeat(400_000)}` })).toEqual(['thumbnail: image data URL (≤ 300 kB)']);
  });
  it('own electrical layout of a variant: validated on the project rooms', () => {
    const points = resolvePlan(null).points.slice(0, 2);
    expect(variantExtrasErrors({ ...createVariant('A'), electrical: { version: 1, points } })).toEqual([]);
    expect(variantExtrasErrors({ ...createVariant('A'), electrical: { version: 1, points: [{ ...points[0], roomId: 'BR1' }] } }).join()).toMatch(/unknown room "BR1"/);
  });
  it('unique variant names (Save as, New)', () => {
    const d = twoVariants();
    expect(uniqueVariantName(d.variants, 'Variant B')).toBe('Variant B (2)');
    expect(uniqueVariantName(d.variants, '  New  ')).toBe('New');
    expect(uniqueVariantName(d.variants, '   ')).not.toBe('');
  });
});

// Whole-variant operations must change only what they are about — a variant carries more fields than the operation knows of
// (also fields written by a newer app version).
describe('variant operations keep the rest of the variant', () => {
  const populated = (): Variant => {
    const ri = defaultInterior('R2');
    return {
      ...createVariant('My variant', 'v-full'), ...B_EXTRAS,
      interiors: { R2: { ...ri, arrangements: [{ ...ri.arrangements[0], name: 'Study B', furniture: [{ id: 'f1', catalogId: 'desk', x: 6, y: 5, rot: 0 }] }] } },
      electrical: { version: 1, points: resolvePlan(null).points.slice(0, 2) },
      ...({ futureField: { a: [1, 2, 3] } } as object),
    };
  };
  const start = (v: Variant) => design.set({ history: initHistory(docWith(v)), draft: null });
  afterEach(() => design.set({ history: initHistory(defaultDoc()), draft: null }));

  it('test data: the populated variant is a valid document', () => {
    expect(docErrors(docWith(populated()))).toEqual([]);
  });
  it('rename: only the name changes (every other field is the same object)', () => {
    const v = populated();
    start(v);
    renameProjectVariant('  Renamed  ');
    const r = variantOf(design.get()) as unknown as Record<string, unknown>, before = v as unknown as Record<string, unknown>;
    expect(r.name).toBe('Renamed');
    expect(Object.keys(r).sort()).toEqual(Object.keys(before).sort());
    for (const k of Object.keys(before).filter((x) => x !== 'name')) expect(r[k], k).toBe(before[k]);
  });
  it('duplicate: every field is copied (deep), new id and name; the copy becomes active', () => {
    const v = populated();
    start(v);
    duplicateProjectVariant();
    const d = docOf(design.get()), c = d.variants[1];
    expect(d.activeVariantId).toBe(c.id);
    expect(c.id).not.toBe(v.id);
    expect(c.name).toBe('My variant (copy)');
    const { id: _i, name: _n, ...restCopy } = c, { id: _j, name: _m, ...restOrig } = v;
    expect(restCopy).toEqual(restOrig);
    expect(c.interiors).not.toBe(v.interiors);
    expect(docErrors(d)).toEqual([]);
  });
  it('restore project settings: back to the package state — id, name and own electrical layout kept; one history entry, Undo restores the object', () => {
    const v = populated();
    start(v);
    expect(projectDefaultVariant(v)).toEqual({ id: 'v-full', name: 'My variant', interiors: {}, electrical: v.electrical });
    expect(resetVariantToProject()).toBe(true);
    expect(variantOf(design.get())).toEqual(projectDefaultVariant(v));
    expect(design.get().history.past).toHaveLength(1);
    expect(resetVariantToProject()).toBe(false);                          // already the project state — no entry
    expect(undo()).toBe(true);
    expect(variantOf(design.get())).toBe(v);
  });
  it('new and delete: the new variant is empty and active; the last variant cannot be deleted', () => {
    start(populated());
    newVariant('My variant');
    const d = docOf(design.get());
    expect(d.variants.map((x) => x.name)).toEqual(['My variant', 'My variant (2)']);
    expect(d.variants[1]).toMatchObject({ interiors: {} });
    expect(d.activeVariantId).toBe(d.variants[1].id);
    deleteProjectVariant(d.variants[1].id);
    expect(docOf(design.get()).variants.map((x) => x.id)).toEqual(['v-full']);
    expect(docOf(design.get()).activeVariantId).toBe('v-full');
    deleteProjectVariant('v-full');
    expect(docOf(design.get()).variants.map((x) => x.id)).toEqual(['v-full']);
  });
});

describe('variant export / import (JSON)', () => {
  let n = 0;
  const newId = () => `v-imp-${++n}`;
  const imp = (text: string, d: ConfiguratorDoc) => importVariant(text, d, docErrors, newId, 'Variant from file');
  it('export: schema, version, project, the variant with every field', () => {
    const f = exportVariant(twoVariants(), 'v-b', new Date('2026-10-02T12:00:00Z'));
    expect([f.schema, f.version, f.exportedAt]).toEqual([VARIANT_SCHEMA, 1, '2026-10-02T12:00:00.000Z']);
    expect(VARIANT_SCHEMA).toBe('home-simulator/variant');
    expect(f.project).toEqual({ id: 'demo-apartment', name: 'Demo apartment', docVersion: 1 });
    expect(f.variant.name).toBe('Variant B');
    expect(f.variant.view?.fov).toBe(45); expect(f.variant.sun?.minutes).toBe(1080);
    expect(f.variant.interiors.R2.arrangements[0].name).toBe('Study B');
    expect(f.importedAssets).toEqual([]);
    expect(() => exportVariant(twoVariants(), 'nope')).toThrow(/no variant nope/);
  });
  it('import into another document of the project: the variant is added and active, data identical', () => {
    const r = imp(JSON.stringify(exportVariant(twoVariants(), 'v-b')), defaultDoc());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.variants.length).toBe(2);
    expect(r.doc.activeVariantId).toBe(r.variantId);
    expect(r.variantId).toBe('v-b');                                       // the id was free — kept
    const v = r.doc.variants.find((x) => x.id === r.variantId)!;
    expect(v.view).toEqual(B_EXTRAS.view); expect(v.sun).toEqual(B_EXTRAS.sun); expect(v.thumbnail).toBe(B_EXTRAS.thumbnail);
    expect(r.warnings).toEqual([]);
  });
  it('import into a document that has the same variant: new id, unique name (with a warning)', () => {
    const d = twoVariants(), r = imp(JSON.stringify(exportVariant(d, 'v-b')), d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.variantId).not.toBe('v-b');
    expect(r.name).toBe('Variant B (2)');
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain('Variant B (2)');
  });
  it('a variant without a name gets the fallback name', () => {
    const f = exportVariant(twoVariants(), 'v-b');
    const r = imp(JSON.stringify({ ...f, variant: { ...f.variant, name: '  ' } }), defaultDoc());
    expect(r.ok && r.name).toBe('Variant from file');
  });
  it('imported models used by the variant travel with it; the import warns about them', () => {
    const asset = { id: 'chair-x', file: 'chair-x.glb', name: 'Chair X', dims: { w: 0.5, d: 0.5, h: 0.9 }, scale: 1 };
    const d = twoVariants();
    d.importedAssets = [asset as never, { ...asset, id: 'unused' } as never];
    d.variants[1].interiors.R2.arrangements[0].furniture = [{ id: 'f1', catalogId: 'imported:chair-x', x: 6, y: 5, rot: 0 }];
    expect(docErrors(d)).toEqual([]);
    const f = exportVariant(d, 'v-b');
    expect(f.importedAssets.map((a) => a.id)).toEqual(['chair-x']);
    const r = imp(JSON.stringify(f), defaultDoc());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.importedAssets.map((a) => a.id)).toEqual(['chair-x']);
    expect(r.warnings.length).toBe(1);
  });
  it('rejected: bad JSON, another schema, wrong version, no variant, another project, invalid variant data', () => {
    const d = defaultDoc(), good = exportVariant(twoVariants(), 'v-b');
    const bad = (x: unknown) => { const r = imp(typeof x === 'string' ? x : JSON.stringify(x), d); return r.ok ? '' : r.errors.join(' | '); };
    expect(bad('{not json')).toMatch(/JSON syntax error/);
    expect(bad('42')).toMatch(/expected a JSON object|unknown schema/);
    expect(bad({ ...good, schema: 'home-simulator/document' })).toMatch(/unknown schema: home-simulator\/document \(expected home-simulator\/variant\)/);
    expect(bad({ ...good, version: 2 })).toMatch(/unsupported variant file version: 2/);
    expect(bad({ ...good, variant: null })).toMatch(/no variant in the file/);
    expect(bad({ ...good, project: { ...good.project, id: 'sample-house' } })).toMatch(/variant of project "sample-house"/);
    expect(bad({ ...good, variant: { ...good.variant, sun: { date: 'x', minutes: 0 } } })).toMatch(/sun:/);
    const furn = JSON.parse(JSON.stringify(good));
    furn.variant.interiors.R2.arrangements[0].furniture = [{ id: 'x', catalogId: 'grand-piano-x', x: 6, y: 5, rot: 0 }];
    expect(bad(furn)).toMatch(/unknown furniture grand-piano-x/);
  });
});

describe('a copy that is still the same design (usability issue A5: "Change something in this copy, then compare.")', () => {
  it('a fresh copy is the same design whatever its name, view, picture or time; a change of furniture, finish or stairs is not', () => {
    const a: Variant = { ...createVariant('A', 'v-a'), interiors: { R1: defaultInterior('R1') } };
    const b: Variant = { ...JSON.parse(JSON.stringify(a)), id: 'v-b', name: 'B', ...B_EXTRAS };
    expect(sameDesign(a, b)).toBe(true);
    const moved: Variant = JSON.parse(JSON.stringify(b));
    moved.interiors.R1 = { ...moved.interiors.R1, finishes: { ...(moved.interiors.R1 as { finishes?: object }).finishes, walls: { all: 'paint-white' } } } as never;
    expect(sameDesign(a, moved)).toBe(false);
    expect(sameDesign(a, { ...b, stairs: { handrail: { kind: 'wood' } } as never })).toBe(false);
  });
});

describe('A / B comparison sides', () => {
  it('without a comparison — one side: the active variant', () => {
    const s = sidesOf(twoVariants(), null);
    expect(s.map((x) => x.id)).toEqual(['A']);
    expect(s[0].variant.id).toBe('v-default');
  });
  it('comparing variants: sides A and B with the data of the chosen variants; an unknown variant — no comparison', () => {
    const s = sidesOf(twoVariants(), { kind: 'variants', a: 'v-b', b: 'v-default' });
    expect(s.map((x) => [x.id, x.variant.id, x.label])).toEqual([['A', 'v-b', 'Variant B'], ['B', 'v-default', 'Version 1']]);
    expect(s[0].interiors.R2.arrangements[0].name).toBe('Study B');
    expect(sidesOf(twoVariants(), { kind: 'variants', a: 'v-b', b: 'gone' }).map((x) => x.id)).toEqual(['A']);
  });
  it('comparing room arrangements: the same variant, a different active arrangement of one room', () => {
    const d = defaultDoc(), ri = defaultInterior('R2');
    const a1 = { ...ri.arrangements[0], id: 'arr-a', name: 'Study A' }, a2 = { ...ri.arrangements[0], id: 'arr-b', name: 'Study B', furniture: [{ id: 'f1', catalogId: 'desk', x: 6, y: 5, rot: 0 }] };
    const doc = { ...d, variants: [{ ...d.variants[0], interiors: { R2: { activeArrangementId: 'arr-a', arrangements: [a1, a2] } } }] };
    const s = sidesOf(doc, { kind: 'room', roomId: 'R2', a: 'arr-a', b: 'arr-b' });
    expect(s.map((x) => x.label)).toEqual(['Bedroom: Study A', 'Bedroom: Study B']);
    expect(s[0].interiors.R2.activeArrangementId).toBe('arr-a');
    expect(s[1].interiors.R2.activeArrangementId).toBe('arr-b');
    expect(s[0].variant).toBe(s[1].variant);
  });
});

describe('screenshot: metadata in PNG (iTXt, UTF-8)', () => {
  it('an iTXt chunk is written and read back (non-ASCII text), the file still starts with IHDR', () => {
    // minimal 1 × 1 PNG: signature, IHDR, IDAT, IEND
    const hex = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a1d2d5b40000000049454e44ae426082';
    const png = new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));
    const meta = JSON.stringify({ variant: 'Variant B — dark façade', sun: '21.06 18:00 · 23°' });
    const out = pngWithText(png, 'home-simulator', meta);
    expect(out.length).toBeGreaterThan(png.length);
    expect(new TextDecoder().decode(out.subarray(12, 16))).toBe('IHDR');
    expect(pngText(out, 'home-simulator')).toBe(meta);
    expect(pngText(out, 'other-key')).toBeNull();
    expect(pngText(png, 'home-simulator')).toBeNull();
  });
});
