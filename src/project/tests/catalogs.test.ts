// Project catalog extensions (ADR 0012): a package brings its own furniture / materials with ids "<projectId>:…"; they are
// checked against the engine catalogs, extend what a package may place and appear in the engine catalogs of that project.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureDir } from '../../test/setup';
import { parseProjectCatalogs, resolveCatalogUrls, setProjectCatalogs } from '../catalogs';
import { projectDirErrors, readProjectCatalogs, readProjectJson } from '../node';
import { engineCatalogs, packageErrors } from '../registry';

const dir = fixtureDir('catalog-ext');

describe('project catalog extensions', () => {
  afterEach(() => { setProjectCatalogs(null); vi.resetModules(); });

  it('a package with its own catalog files is valid and may place its own items', () => {
    expect(projectDirErrors(dir)).toEqual([]);
    const { catalogs } = readProjectCatalogs(dir, readProjectJson(dir));
    expect(catalogs.furniture.items.map((i) => i.id)).toEqual(['catalog-ext:bench', 'catalog-ext:kitchen']);
    // defaults are filled in
    expect(catalogs.furniture.items[1].materialSlots).toEqual({});
    expect(catalogs.materials.materials[0].physicalSize).toEqual([1, 1]);
  });

  it('without its catalog the same placement is an unknown catalog item', () => {
    const errs = packageErrors(readProjectJson(dir), 'catalog-ext');
    expect(errs).toContain('furniture "bench": unknown catalog item "catalog-ext:bench"');
  });

  it('ids must carry the project prefix, never override the engine, and refer to existing materials and categories', () => {
    const r = parseProjectCatalogs('p', {
      furniture: { items: [
        { id: 'sofa', name: 'Sofa', category: 'living', dimensions: { w: 1, d: 1, h: 1 }, runtimeModel: { type: 'parametric', generator: 'sofa' }, defaultMaterial: 'fabric-grey', placement: 'wall', source: 's', license: 'l' },
        { id: 'p:x', name: 'X', category: 'nowhere', dimensions: { w: 1, d: 1, h: 1 }, runtimeModel: { type: 'glb' }, defaultMaterial: 'p:missing', placement: 'free', source: 's', license: 'l' },
        { id: 'p:x', name: 'X2', category: 'living', dimensions: { w: 1, d: 1, h: 1 }, runtimeModel: { type: 'parametric', generator: 'table' }, defaultMaterial: 'fabric-grey', placement: 'free', source: 's', license: 'l' },
      ] },
    }, engineCatalogs());
    expect(r.errors.some((e) => e.includes('glb needs "url"'))).toBe(true);
    const r2 = parseProjectCatalogs('p', {
      furniture: { items: [
        { id: 'sofa', name: 'Sofa', category: 'living', dimensions: { w: 1, d: 1, h: 1 }, runtimeModel: { type: 'parametric', generator: 'sofa' }, defaultMaterial: 'fabric-grey', placement: 'wall', source: 's', license: 'l' },
        { id: 'p:x', name: 'X', category: 'nowhere', dimensions: { w: 1, d: 1, h: 1 }, runtimeModel: { type: 'glb', url: 'm.glb' }, defaultMaterial: 'p:missing', placement: 'free', source: 's', license: 'l' },
        { id: 'p:x', name: 'X2', category: 'living', dimensions: { w: 1, d: 1, h: 1 }, runtimeModel: { type: 'parametric', generator: 'table' }, defaultMaterial: 'fabric-grey', placement: 'free', source: 's', license: 'l' },
      ] },
      materials: { materials: [{ id: 'p:paint-white', name: 'W', category: 'wall-paint', surfaces: ['wall'], baseColor: '#fff', textureSet: { type: 'solid' }, source: 's' }, { id: 'paint-white', name: 'W', category: 'wall-paint', surfaces: ['wall'], baseColor: '#fff', textureSet: { type: 'solid' }, source: 's' }] },
    }, engineCatalogs());
    expect(r2.errors).toEqual(expect.arrayContaining([
      'furniture item "sofa": project ids start with "p:"',
      'furniture item "p:x": duplicate id',
      'furniture item "p:x": unknown category "nowhere"',
      'furniture item "p:x": unknown material "p:missing"',
      'material "paint-white": project ids start with "p:"',
    ]));
    expect(r2.errors.some((e) => e.includes('p:paint-white'))).toBe(false);
  });

  it('model and texture paths become project URLs', () => {
    const { catalogs } = readProjectCatalogs(dir, readProjectJson(dir));
    const c = resolveCatalogUrls(catalogs, (rel) => `/projects/catalog-ext/${rel}`);
    expect(c.furniture.items[1].runtimeModel.url).toBe('/projects/catalog-ext/models/kitchen.glb');
  });

  it('the engine catalogs of the project list its items, categories and materials, named in the UI language', async () => {
    const ext = readProjectCatalogs(dir, readProjectJson(dir)).catalogs;
    vi.resetModules();
    // the fresh module graph (as at app start: the loader sets the extension before the engine catalogs are imported)
    (await import('../catalogs')).setProjectCatalogs(ext);
    const i18n = await import('../../i18n');
    const { itemById } = await import('../../home/catalog/providers');
    const { FURNITURE_CATEGORIES, furnitureCategoryName } = await import('../../home/catalog/furniture');
    const { materialById } = await import('../../home/catalog/materials');
    const bench = itemById('catalog-ext:bench');
    expect(bench?.provider).toBe('project');
    expect(bench?.name).toBe('Entry bench');
    expect(itemById('sofa')?.provider).toBe('builtin');
    expect(FURNITURE_CATEGORIES.some((c) => c.id === 'catalog-ext:entry')).toBe(true);
    expect(materialById('catalog-ext:oak-oiled')?.baseColor).toBe('#b08a5a');
    i18n.initLang('pl');
    expect(bench?.name).toBe('Lawka');
    expect(furnitureCategoryName('catalog-ext:entry')).toBe('Wejscie');
    expect(materialById('catalog-ext:oak-oiled')?.name).toBe('Oiled oak');
    i18n.initLang('en');
  });
});
