// Furniture catalog (data/furnitureCatalog.json): items, variants, parameter ranges, part materials.
// Dimensions in metres: w — width, d — depth (back → front), h — height. Outline centre at (0, 0), bottom on the floor.
// Catalog names are English; names in the UI language come from the dictionaries (keys furniture.<id>,
// furniture.<id>.variant.<variantId>, furnitureCategory.<id>, catalog.slot.<slot>) with the English name as fallback.
// The active project's own items and categories (projects/<id>/…, ids "<projectId>:…") follow the engine ones; their
// translations come with them (`names`).
import { lang, tOr } from '../../i18n';
import { projectCatalogs } from '../../project/catalogs';
import catalog from '../../../data/furnitureCatalog.json';
import type { Dims, FurniturePlacement } from '../model/types';

export type Range = [number, number, number]; // [min, max, step]
export type Placement = 'wall' | 'free' | 'under' | 'floor';

export interface CatalogVariant { id: string; name: string; dimensions?: Partial<Dims>; options?: Record<string, unknown> }

export interface RuntimeModel {
  type: 'parametric' | 'glb';
  generator?: string;
  options?: Record<string, unknown>;
  /** type glb: model URL (imported / external) and normalization */
  url?: string;
  scale?: number;
  offset?: [number, number, number];
  /** model rotation about the vertical axis [°] (file front → item front) */
  rotation?: number;
}

export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  tags: string[];
  dimensions: Dims;
  variants?: CatalogVariant[];
  defaultVariant?: string;
  parametric?: Partial<Record<keyof Dims, Range>>;
  runtimeModel: RuntimeModel;
  thumbnail: string;
  defaultMaterial: string;
  mainSlot: string;
  materialCategories: string[];
  materialSlots: Record<string, string>;
  placement: Placement;
  tuckUnder?: string[];
  flat?: boolean;
  clearance: { front?: number; sides?: number; around?: number };
  /** wall object: hangs on a mounting surface — position stored relative to the wall (model/mountDrag.ts); absent — freestanding item */
  mount?: 'wall';
  /** mounting above the floor (wall cabinets, hood, mirror, wall TV): range [min, max, step] and default value [m] */
  elevation?: Range;
  defaultElevation?: number;
  /** height that obstructs a window (e.g. a sink worktop — the tap above it does not cover the window); absent — full height */
  obstructHeight?: number;
  /** the element stands in a door / passage opening (e.g. a flush pantry door) — no passage-blocking warning */
  inDoorway?: boolean;
  /** additional parts with a material choice (e.g. a kitchen unit worktop) */
  extraSlots?: { slot: string; label: string; categories: string[] }[];
  source: string;
  license: string;
  /** item origin (provider) — builtin / imported / …; filled in by the registry */
  provider?: string;
}

export interface CatalogCategory { id: string; name: string; icon: string }

/** replaces `name` (or another text field) with a getter: dictionary value in the UI language, the catalog English text as fallback */
function localized<T extends object>(o: T, field: keyof T & string, key: string): T {
  const en = String(o[field]);
  return Object.defineProperty(o, field, { get: () => tOr(key, en), enumerable: true, configurable: true });
}

const C = catalog as unknown as { categories: CatalogCategory[]; items: CatalogItem[] };
/** project item / category: the name in the UI language from its own `names`, the English name otherwise */
function projectNamed<T extends { name: string; names?: Record<string, string> }>(o: T): T {
  const en = o.name, names = o.names;
  return Object.defineProperty(o, 'name', { get: () => names?.[lang()] ?? en, enumerable: true, configurable: true });
}
const X = projectCatalogs().furniture;
export const FURNITURE_CATEGORIES: CatalogCategory[] = [
  ...C.categories.map((c) => localized({ ...c }, 'name', `furnitureCategory.${c.id}`)),
  ...X.categories.map((c) => projectNamed({ ...c })),
];
export const BUILTIN_ITEMS: CatalogItem[] = [
  ...C.items.map((i) => localized({
    ...i, provider: 'builtin',
    ...(i.variants ? { variants: i.variants.map((v) => localized({ ...v }, 'name', `furniture.${i.id}.variant.${v.id}`)) } : {}),
    ...(i.extraSlots ? { extraSlots: i.extraSlots.map((s) => localized({ ...s }, 'label', `catalog.slot.${s.slot}`)) } : {}),
  }, 'name', `furniture.${i.id}`)),
  ...X.items.map((i) => projectNamed({ ...(i as unknown as CatalogItem & { names?: Record<string, string> }), provider: 'project' })),
];

const r = (x: number, step = 0.001) => Math.round(x / step) * step;
const round4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0;

export function variantOf(item: CatalogItem, variant?: string | null): CatalogVariant | null {
  if (!item.variants?.length) return null;
  return item.variants.find((v) => v.id === variant) ?? item.variants.find((v) => v.id === item.defaultVariant) ?? item.variants[0];
}

/** clamps a dimension to its parametric range (rounded to the step); non-parametric dimensions — from the catalog / variant */
export function clampDim(item: CatalogItem, key: keyof Dims, value: number): number {
  const rg = item.parametric?.[key];
  if (!rg) return value;
  const [lo, hi, step] = rg;
  return round4(Math.min(hi, Math.max(lo, r(value, step))));
}

/** item dimensions: catalog ← variant ← user override (only parameters with a range) */
export function resolveDims(item: CatalogItem, p?: Pick<FurniturePlacement, 'variant' | 'dims'> | null): Dims {
  const v = variantOf(item, p?.variant);
  const base: Dims = { ...item.dimensions, ...(v?.dimensions ?? {}) };
  const out = { ...base };
  for (const k of ['w', 'd', 'h'] as (keyof Dims)[]) {
    const o = p?.dims?.[k];
    if (typeof o === 'number' && Number.isFinite(o) && item.parametric?.[k]) out[k] = clampDim(item, k, o);
  }
  return out;
}

/** generator options: model ← variant */
export const generatorOptions = (item: CatalogItem, variant?: string | null): Record<string, unknown> => ({ ...(item.runtimeModel.options ?? {}), ...(variantOf(item, variant)?.options ?? {}) });

/** part materials: catalog ← material chosen by the user (main part, additional parts) */
export function slotMaterials(item: CatalogItem, p?: Pick<FurniturePlacement, 'materialId' | 'slots'> | null): Record<string, string> {
  const m = { ...item.materialSlots, ...(p?.slots ?? {}) };
  if (p?.materialId) m[item.mainSlot] = p.materialId;
  return m;
}

/** item mounting height above the floor [m] */
export const elevationOf = (item: CatalogItem, p?: Pick<FurniturePlacement, 'elevation'> | null) => p?.elevation ?? item.defaultElevation ?? 0;
/** whether a catalog item is a wall object (hangs on the wall rather than standing at it) */
export const isWallMounted = (item: Pick<CatalogItem, 'mount'> | null | undefined): boolean => item?.mount === 'wall';

export const mainMaterial = (item: CatalogItem, p?: Pick<FurniturePlacement, 'materialId'> | null) => p?.materialId ?? item.materialSlots[item.mainSlot] ?? item.defaultMaterial;

const cm = (x: number) => Math.round(x * 100);
/** "140 × 70 × 75 cm" */
export const sizeLabel = (d: Dims) => `${cm(d.w)} × ${cm(d.d)} × ${cm(d.h)} cm`;
/** item name in the UI language (imported models keep the user's name) */
export const itemName = (item: Pick<CatalogItem, 'id' | 'name'>): string => tOr(`furniture.${item.id}`, item.name);
/** variant name in the UI language */
export const variantName = (item: Pick<CatalogItem, 'id'>, v: Pick<CatalogVariant, 'id' | 'name'>): string => tOr(`furniture.${item.id}.variant.${v.id}`, v.name);
/** furniture category name in the UI language */
export const furnitureCategoryName = (id: string): string => { const c = FURNITURE_CATEGORIES.find((x) => x.id === id); return c ? c.name : tOr(`furnitureCategory.${id}`, id); };
/** label of an additional material part (e.g. the worktop) in the UI language */
export const slotLabel = (s: { slot: string; label: string }): string => tOr(`catalog.slot.${s.slot}`, s.label);
/** user-facing name: "Bed 140 × 200", "3-seater sofa · 210 cm" */
export function displayName(item: CatalogItem, p?: Pick<FurniturePlacement, 'variant'> | null): string {
  const v = variantOf(item, p?.variant);
  return v ? `${itemName(item)} ${variantName(item, v)}` : itemName(item);
}

/** items of a category (main category or a tag equal to the category id) */
export const inCategory = (item: CatalogItem, category: string) => item.category === category || item.tags.includes(category);

/** whether two items may overlap (chair tucked under a table / desk, rug under furniture) */
export function mayOverlap(a: CatalogItem, b: CatalogItem): boolean {
  if (a.flat || b.flat) return true;
  return !!(a.tuckUnder?.includes(b.id) || b.tuckUnder?.includes(a.id));
}
