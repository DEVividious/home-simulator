// Project document (home-simulator/document, version 1): variants, JSON round trip, validation and project ownership.
// Runs on the demo apartment (src/test/setup.ts); the sample house stands in for "another project".
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { withProject } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { defaultInterior } from '../../home/model/interiors';
import {
  createVariant, defaultDoc, DOC_SCHEMA, DOC_VERSION, docErrors, duplicateVariant, newVariantId, parseDoc, renameVariant, serializeDoc,
  type ConfiguratorDoc,
} from '../model';

const root = path.resolve(__dirname, '..', '..', '..');
const house = readProjectDir(path.join(root, 'projects', 'sample-house'));

const withRoom = (doc: ConfiguratorDoc): ConfiguratorDoc => {
  const ri = defaultInterior('R1');
  const a = { ...ri.arrangements[0], id: 'arr-1', name: 'Reading corner', furniture: [{ id: 'f1', catalogId: 'armchair', x: 4, y: 2, rot: 0 }] };
  return { ...doc, variants: [{ ...doc.variants[0], interiors: { R1: { activeArrangementId: 'arr-1', arrangements: [a] } } }] };
};

describe('variants', () => {
  it('createVariant: empty interiors (filled lazily per room), given id and name; default name translated', () => {
    expect(createVariant('Mine', 'v-1')).toEqual({ id: 'v-1', name: 'Mine', interiors: {} });
    expect(createVariant().name).toBe('New variant');
    expect(createVariant().id).not.toBe(createVariant().id);
    expect(newVariantId()).toMatch(/^v-/);
  });

  it('duplicate: new id, unique name, deep copy; rename trims and keeps the old name when empty', () => {
    const a = { ...createVariant('Mine', 'v-a'), interiors: { R1: defaultInterior('R1') } };
    const b = duplicateVariant(a, [a]);
    expect(b.id).not.toBe(a.id);
    expect(b.name).toBe('Mine (copy)');
    expect(duplicateVariant(a, [a, b]).name).toBe('Mine (copy 2)');
    expect(b.interiors).toEqual(a.interiors);
    expect(b.interiors.R1).not.toBe(a.interiors.R1);
    expect(renameVariant(a, '  New  ').name).toBe('New');
    expect(renameVariant(a, '   ').name).toBe('Mine');
  });
});

describe('document JSON', () => {
  it('default document: schema, version 1, the active project, one valid variant', () => {
    const d = defaultDoc();
    expect([d.schema, d.version, d.projectId]).toEqual([DOC_SCHEMA, DOC_VERSION, 'demo-apartment']);
    expect([DOC_SCHEMA, DOC_VERSION]).toEqual(['home-simulator/document', 1]);
    expect(d.variants.map((v) => [v.id, v.name])).toEqual([['v-default', 'Project defaults']]);
    expect(d.activeVariantId).toBe('v-default');
    expect(docErrors(d)).toEqual([]);
  });

  it('round trip: serialize → parse gives the same document (with interiors, bookmarks, optional variant fields)', () => {
    const d = withRoom(defaultDoc());
    d.bookmarks = [{ id: 'b1', name: 'Sofa', position: [1, 2, 1.6], target: [4, 3, 1], fov: 50 }];
    d.variants.push({ ...createVariant('Evening', 'v-2'), view: { position: [1, 2, 3], target: [0, 0, 0], fov: 45, environment: false }, thumbnail: null, updatedAt: '2026-10-01T10:00:00.000Z' });
    expect(docErrors(d)).toEqual([]);
    const text = serializeDoc(d);
    expect(text.endsWith('\n')).toBe(true);
    expect(parseDoc(text)).toEqual(d);
  });

  it('parse fills missing optional collections (interiors, bookmarks, imported models)', () => {
    const { bookmarks: _b, importedAssets: _i, ...rest } = defaultDoc();
    const bare = { ...rest, variants: [{ id: 'v-default', name: 'A' }] };
    const d = parseDoc(JSON.stringify(bare));
    expect(d.bookmarks).toEqual([]);
    expect(d.importedAssets).toEqual([]);
    expect(d.variants[0].interiors).toEqual({});
  });

  it('validation: schema, version, variants, active variant, bookmarks, imported models, interiors', () => {
    const d = defaultDoc();
    const msg = (x: unknown) => docErrors(x).join(' | ');
    expect(msg(null)).toBe('expected an object');
    expect(msg({ ...d, schema: 'x' })).toMatch(/unknown schema: x/);
    expect(msg({ ...d, version: 7 })).toMatch(/unsupported version: 7/);
    expect(msg({ ...d, variants: [] })).toMatch(/no variants/);
    expect(msg({ ...d, activeVariantId: 'missing' })).toMatch(/activeVariantId/);
    expect(msg({ ...d, variants: [d.variants[0], d.variants[0]] })).toMatch(/repeated variant id v-default/);
    expect(msg({ ...d, variants: [{ ...d.variants[0], name: ' ' }] })).toMatch(/v-default: no name/);
    expect(msg({ ...d, bookmarks: [{ id: 'b', name: 'x', position: [0, 0], target: [0, 0, 0], fov: 40 }] })).toMatch(/bookmark 1/);
    expect(msg({ ...d, importedAssets: [{ id: 'm' }] })).toMatch(/model 1/);
    const bad = withRoom(d);
    bad.variants[0].interiors.R1.arrangements[0].furniture[0].catalogId = 'grand-piano-x';
    expect(msg(bad)).toMatch(/room R1 \/ Reading corner: unknown furniture grand-piano-x/);
    expect(msg({ ...d, variants: [{ ...d.variants[0], sun: { date: '21.06.2026', minutes: 2000 } }] })).toMatch(/sun:/);
  });

  it('parse errors are readable: JSON syntax and the list of validation errors', () => {
    expect(() => parseDoc('{')).toThrow(/JSON syntax error/);
    expect(() => parseDoc(JSON.stringify({ ...defaultDoc(), activeVariantId: 'x' }))).toThrow(/activeVariantId/);
  });
});

describe('document ownership', () => {
  it('a document of another project is rejected (never adapted) — in both directions', () => {
    const mine = defaultDoc(), theirs = withProject(house, () => defaultDoc());
    expect(theirs.projectId).toBe('sample-house');
    expect(docErrors(theirs)).toEqual(['the document belongs to project "sample-house", the open project is "demo-apartment"']);
    expect(() => parseDoc(serializeDoc(theirs))).toThrow(/sample-house/);
    expect(withProject(house, () => docErrors(mine)).join(' ')).toMatch(/belongs to project "demo-apartment"/);
    expect(withProject(house, () => docErrors(theirs))).toEqual([]);
    // a document without a project id belongs to no project
    const { projectId: _p, ...anonymous } = mine;
    expect(docErrors(anonymous).join(' ')).toMatch(/belongs to project "undefined"/);
  });
});
