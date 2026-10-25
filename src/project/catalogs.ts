// PROJECT CATALOG EXTENSIONS (ADR 0012): a package may bring its own furniture and materials in the files named by
// `catalog.furniture` / `catalog.materials` (paths relative to the project directory). The files have the shape of the engine
// catalogs (data/furnitureCatalog.json, data/materialCatalog.json); every id is prefixed "<projectId>:" so a project never
// overrides an engine item. Model and texture URLs inside are relative to the project directory. Optional `names`
// ({ "pl": "…" }) translate an item name; without it the English `name` is shown in every language.
// Environment-neutral: the browser loader (registry.ts) fetches the files, Node tools read them (node.ts); the catalog
// modules of the engine (src/home/catalog) append the active extension when they are first imported.
import { z } from 'zod';
import { schemaErrors } from './schema';

const num = z.number().finite();
const names = z.record(z.string(), z.string()).optional();
const dims = z.strictObject({ w: num.positive(), d: num.positive(), h: num.positive() });

const FurnitureItemSchema = z.looseObject({
  id: z.string(), name: z.string().min(1), names, category: z.string(), tags: z.array(z.string()).default([]),
  dimensions: dims,
  runtimeModel: z.looseObject({ type: z.enum(['parametric', 'glb']), generator: z.string().optional(), url: z.string().optional() })
    .refine((m) => (m.type === 'glb' ? !!m.url : !!m.generator), 'parametric needs "generator", glb needs "url"'),
  thumbnail: z.string().default('auto:parametric'),
  defaultMaterial: z.string(), mainSlot: z.string().default('main'), materialCategories: z.array(z.string()).default([]),
  materialSlots: z.record(z.string(), z.string()).default({}),
  placement: z.enum(['wall', 'free', 'under', 'floor']), clearance: z.looseObject({}).default({}),
  source: z.string(), license: z.string(),
});
const MaterialSchema = z.looseObject({
  id: z.string(), name: z.string().min(1), names, category: z.string(),
  surfaces: z.array(z.enum(['wall', 'floor', 'ceiling', 'furniture', 'rug'])).min(1),
  baseColor: z.string(), textureSet: z.looseObject({ type: z.string() }),
  physicalSize: z.tuple([num, num]).default([1, 1]), repeat: z.tuple([num, num]).default([1, 1]), rotation: num.default(0),
  roughness: num.default(0.8), metalness: num.default(0), normalScale: num.default(0), thumbnail: z.string().default('auto:procedural'),
  source: z.string(),
});
export const ProjectFurnitureFileSchema = z.looseObject({
  categories: z.array(z.strictObject({ id: z.string(), name: z.string(), names, icon: z.string().default('box') })).default([]),
  items: z.array(FurnitureItemSchema),
});
export const ProjectMaterialFileSchema = z.looseObject({
  categories: z.array(z.strictObject({ id: z.string(), name: z.string(), names, surfaces: z.array(z.string()) })).default([]),
  materials: z.array(MaterialSchema),
});
export type ProjectFurnitureFile = z.output<typeof ProjectFurnitureFileSchema>;
export type ProjectMaterialFile = z.output<typeof ProjectMaterialFileSchema>;
export interface ProjectCatalogs { furniture: ProjectFurnitureFile; materials: ProjectMaterialFile }
export const EMPTY_CATALOGS: ProjectCatalogs = { furniture: { categories: [], items: [] }, materials: { categories: [], materials: [] } };

/** ids of the engine catalogs a project extension may refer to */
export interface EngineCatalogIds { furniture: ReadonlySet<string>; furnitureCategories: ReadonlySet<string>; materials: ReadonlySet<string>; materialCategories: ReadonlySet<string> }

/**
 * Parses the raw extension files (undefined — the package names no such file) and checks them against the engine catalogs.
 * Returns the parsed catalogs with defaults filled in, or the list of errors.
 */
export function parseProjectCatalogs(projectId: string, raw: { furniture?: unknown; materials?: unknown }, engine: EngineCatalogIds): { catalogs: ProjectCatalogs; errors: string[] } {
  const errors: string[] = [];
  const parse = <T,>(schema: z.ZodType<T>, data: unknown, what: string, empty: T): T => {
    if (data === undefined) return empty;
    const e = schemaErrors(schema, data);
    if (e.length) { errors.push(...e.map((x) => `${what}: ${x}`)); return empty; }
    return schema.parse(data);
  };
  const furniture = parse(ProjectFurnitureFileSchema, raw.furniture, 'catalog.furniture', EMPTY_CATALOGS.furniture);
  const materials = parse(ProjectMaterialFileSchema, raw.materials, 'catalog.materials', EMPTY_CATALOGS.materials);
  const prefix = `${projectId}:`;
  const own = (kind: string, ids: string[], engineIds: ReadonlySet<string>) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!id.startsWith(prefix) || id.length === prefix.length) errors.push(`${kind} "${id}": project ids start with "${prefix}"`);
      else if (engineIds.has(id)) errors.push(`${kind} "${id}": overrides an engine id`);
      if (seen.has(id)) errors.push(`${kind} "${id}": duplicate id`);
      seen.add(id);
    }
  };
  own('furniture category', furniture.categories.map((c) => c.id), engine.furnitureCategories);
  own('furniture item', furniture.items.map((i) => i.id), engine.furniture);
  own('material category', materials.categories.map((c) => c.id), engine.materialCategories);
  own('material', materials.materials.map((m) => m.id), engine.materials);
  const fCats = new Set([...engine.furnitureCategories, ...furniture.categories.map((c) => c.id)]);
  const mCats = new Set([...engine.materialCategories, ...materials.categories.map((c) => c.id)]);
  const mats = new Set([...engine.materials, ...materials.materials.map((m) => m.id)]);
  for (const i of furniture.items) {
    if (!fCats.has(i.category)) errors.push(`furniture item "${i.id}": unknown category "${i.category}"`);
    for (const m of [i.defaultMaterial, ...Object.values(i.materialSlots)]) if (!mats.has(m)) errors.push(`furniture item "${i.id}": unknown material "${m}"`);
    for (const c of i.materialCategories) if (!mCats.has(c)) errors.push(`furniture item "${i.id}": unknown material category "${c}"`);
  }
  for (const m of materials.materials) if (!mCats.has(m.category)) errors.push(`material "${m.id}": unknown category "${m.category}"`);
  return { catalogs: { furniture, materials }, errors };
}

/** rewrites file references inside the catalogs (GLB model URLs, texture maps) with `toUrl` (relative → project URL) */
export function resolveCatalogUrls(c: ProjectCatalogs, toUrl: (rel: string) => string): ProjectCatalogs {
  return {
    furniture: { ...c.furniture, items: c.furniture.items.map((i) => (i.runtimeModel.url ? { ...i, runtimeModel: { ...i.runtimeModel, url: toUrl(i.runtimeModel.url) } } : i)) },
    materials: {
      ...c.materials,
      materials: c.materials.materials.map((m) => {
        const maps = (m.textureSet as { maps?: Record<string, string> }).maps;
        return maps ? { ...m, textureSet: { ...m.textureSet, maps: Object.fromEntries(Object.entries(maps).map(([k, v]) => [k, toUrl(v)])) } } : m;
      }),
    },
  };
}

let active: ProjectCatalogs = EMPTY_CATALOGS;
/** catalog extension of the active project (empty when the package brings none) */
export const projectCatalogs = (): ProjectCatalogs => active;
export function setProjectCatalogs(c: ProjectCatalogs | null) { active = c ?? EMPTY_CATALOGS; }
