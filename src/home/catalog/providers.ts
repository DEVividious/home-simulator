// Furniture catalog architecture: providers → one item registry. The app does not depend on external APIs:
// 'builtin' — parametric furniture from data/furnitureCatalog.json; 'imported' — GLB / glTF models imported by the
// user (metadata in the project: ConfiguratorDoc.importedAssets, files in assets/furniture/imported/).
// Further providers (e.g. manufacturer catalogs — once licences / APIs exist) implement the same interface and register
// via registerProvider(); their items then have runtimeModel.type = 'glb' and their own source / licence.
import { fmtNum, t } from '../../i18n';
import type { ImportedAsset } from '../model/types';
import { BUILTIN_ITEMS, type CatalogItem } from './furniture';

export interface FurnitureProvider {
  id: string;
  name: string;
  /** provider items (may depend on the project — e.g. imported models) */
  items(ctx: { importedAssets: ImportedAsset[] }): CatalogItem[];
}

export const IMPORTED_URL = '/user-assets/furniture/imported/';
export const IMPORTED_THUMB_URL = '/user-assets/thumbnails/imported/';

export const builtinProvider: FurnitureProvider = { id: 'builtin', get name() { return t('catalog.provider.builtin'); }, items: () => BUILTIN_ITEMS };

/** imported model → catalog item (GLB, dimensions after normalization, materials from the file) */
export function importedItem(a: ImportedAsset): CatalogItem {
  return {
    id: `imported:${a.id}`, name: a.name, category: a.category || 'decor', tags: ['import', 'glb'], dimensions: a.dims,
    runtimeModel: { type: 'glb', url: IMPORTED_URL + a.file, scale: a.scale, offset: a.offset, rotation: a.rotation ?? 0 }, thumbnail: a.thumbnail ? IMPORTED_THUMB_URL + a.thumbnail : 'auto:glb',
    defaultMaterial: '', mainSlot: 'file', materialCategories: [], materialSlots: {}, placement: 'free', clearance: {},
    source: t('catalog.importedSource', { file: a.file, triangles: fmtNum(a.triangles, 0) }), license: t('catalog.userFile'), provider: 'imported',
  };
}

export const importedProvider: FurnitureProvider = { id: 'imported', get name() { return t('catalog.provider.imported'); }, items: ({ importedAssets }) => importedAssets.map(importedItem) };

const PROVIDERS: FurnitureProvider[] = [builtinProvider, importedProvider];

// imported models of the current project (working copy of ConfiguratorDoc.importedAssets — set by the project store
// so that model functions (collisions, placement) find imported items without passing the document around)
let IMPORTED: ImportedAsset[] = [];
let importedItems = new Map<string, CatalogItem>();
export function setImportedAssets(list: ImportedAsset[]) {
  if (list === IMPORTED) return;
  IMPORTED = list;
  importedItems = new Map(list.map((a) => { const i = importedItem(a); return [i.id, i]; }));
}
export const currentImported = () => IMPORTED;
export function registerProvider(p: FurnitureProvider) { if (!PROVIDERS.some((q) => q.id === p.id)) PROVIDERS.push(p); }
export const providers = () => [...PROVIDERS];

/** all catalog items for the project */
export function catalogItems(importedAssets: ImportedAsset[] = IMPORTED): CatalogItem[] {
  return PROVIDERS.flatMap((p) => p.items({ importedAssets }));
}

const builtinById = new Map(BUILTIN_ITEMS.map((i) => [i.id, i]));
/** item by id (built-in or imported) */
export function itemById(id: string, importedAssets?: ImportedAsset[]): CatalogItem | null {
  const b = builtinById.get(id);
  if (b) return b;
  if (!importedAssets || importedAssets === IMPORTED) return importedItems.get(id) ?? catalogItems().find((i) => i.id === id) ?? null;
  return catalogItems(importedAssets).find((i) => i.id === id) ?? null;
}
