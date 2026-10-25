// Material catalog (data/materialCatalog.json): wall / floor / ceiling finishes, furniture and rug materials.
// Real scale: surface UVs in metres, texture repeat = 1 / pattern repeat size (physicalSize, with the user's layout).
// Catalog names are English; names in the UI language come from the dictionaries (keys material.<id>,
// materialCategory.<id>) with the English name as fallback.
import { lang, tOr } from '../../i18n';
import { projectCatalogs } from '../../project/catalogs';
import catalog from '../../../data/materialCatalog.json';
import type { FinishLayout, FinishRef } from '../model/types';

export type Surface = 'wall' | 'floor' | 'ceiling' | 'furniture' | 'rug';
export type PlankPattern = NonNullable<FinishLayout['pattern']>;

export interface TextureSet {
  type: 'solid' | 'tiles' | 'planks' | 'herringbone' | 'chevron' | 'brick' | 'panels' | 'fluted' | 'slats' | 'wallpaper' | 'noise' | 'weave' | 'terrazzo' | 'rug' | 'file';
  grout?: number;
  groutColor?: string;
  variation?: number;
  pattern?: string;
  noise?: number;
  boardWidth?: number;
  boardLength?: number;
  grain?: number;
  gap?: number;
  gapColor?: string;
  motif?: string;
  accent?: string;
  groove?: number;
  inset?: number;
  slat?: number;
  scale?: number;
  amount?: number;
  chips?: string[];
  /** type 'file': PBR maps (groundwork for file-based materials) */
  maps?: { color?: string; normal?: string; roughness?: string };
}

export interface MaterialDef {
  id: string;
  name: string;
  category: string;
  surfaces: Surface[];
  baseColor: string;
  textureSet: TextureSet;
  physicalSize: [number, number];
  repeat: [number, number];
  rotation: number;
  roughness: number;
  metalness: number;
  normalScale: number;
  emissive?: string;
  emissiveIntensity?: number;
  /** opacity (glass, water); absent — opaque */
  opacity?: number;
  thumbnail: string;
  source: string;
}

export interface MaterialCategory { id: string; name: string; surfaces: Surface[] }

/** replaces `name` with a getter: dictionary value in the UI language, the catalog English name as fallback */
function localized<T extends { name: string }>(o: T, key: string): T {
  const en = o.name;
  return Object.defineProperty(o, 'name', { get: () => tOr(key, en), enumerable: true, configurable: true });
}

const C = catalog as unknown as { categories: MaterialCategory[]; materials: MaterialDef[] };
/** project material / category: the name in the UI language from its own `names`, the English name otherwise */
function projectNamed<T extends { name: string; names?: Record<string, string> }>(o: T): T {
  const en = o.name, names = o.names;
  return Object.defineProperty(o, 'name', { get: () => names?.[lang()] ?? en, enumerable: true, configurable: true });
}
const X = projectCatalogs().materials;
export const MATERIAL_CATEGORIES: MaterialCategory[] = [
  ...C.categories.map((c) => localized({ ...c }, `materialCategory.${c.id}`)),
  ...X.categories.map((c) => projectNamed({ ...(c as unknown as MaterialCategory & { names?: Record<string, string> }) })),
];
export const MATERIALS: MaterialDef[] = [
  ...C.materials.map((m) => localized({ ...m }, `material.${m.id}`)),
  ...X.materials.map((m) => projectNamed({ ...(m as unknown as MaterialDef & { names?: Record<string, string> }) })),
];
const BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));
export const materialById = (id: string | null | undefined): MaterialDef | null => (id ? BY_ID.get(id) ?? null : null);
/** material category name in the UI language */
export const categoryName = (id: string) => { const c = MATERIAL_CATEGORIES.find((x) => x.id === id); return c ? c.name : tOr(`materialCategory.${id}`, id); };
/** material name in the UI language */
export const materialName = (m: Pick<MaterialDef, 'id' | 'name'>): string => tOr(`material.${m.id}`, m.name);

/** materials for a surface (optionally only the given categories) */
export const materialsFor = (surface: Surface, categories?: string[]) =>
  MATERIALS.filter((m) => m.surfaces.includes(surface) && (!categories || categories.includes(m.category)));

/** categories available for a surface (catalog order) */
export const categoriesFor = (surface: Surface) => MATERIAL_CATEGORIES.filter((c) => c.surfaces.includes(surface) && MATERIALS.some((m) => m.category === c.id && m.surfaces.includes(surface)));

export const PLANK_ROWS: Record<PlankPattern, number> = { straight: 1, half: 2, third: 3, random: 5 };
export const isTiled = (m: MaterialDef) => m.textureSet.type === 'tiles' || m.textureSet.type === 'terrazzo';
export const isPlanks = (m: MaterialDef) => m.textureSet.type === 'planks';
/** classic / French herringbone (parquet) */
export const isParquet = (m: MaterialDef) => m.textureSet.type === 'herringbone' || m.textureSet.type === 'chevron';

/** herringbone pattern repeat [m] (x, y) for a block of width w and length l: classic (blocks at right angles, 45°) —
 *  [√2·l, √2·w]; French / chevron (ends cut at 45°, joined on the axis) — [√2·l, √2·w] per column pair */
export const parquetModule = (type: string, w: number, l: number): [number, number] => (type === 'chevron' ? [Math.SQRT2 * l, Math.SQRT2 * w] : [Math.SQRT2 * l, Math.SQRT2 * w]);

/** effective pattern parameters: catalog ← user layout */
export function effectiveTexture(m: MaterialDef, layout?: FinishLayout | null): TextureSet & { size: [number, number] } {
  const t = { ...m.textureSet };
  if (isPlanks(m)) {
    const bw = layout?.boardWidth ?? t.boardWidth!, bl = layout?.boardLength ?? t.boardLength!, pat = (layout?.pattern ?? t.pattern ?? 'straight') as PlankPattern;
    return { ...t, boardWidth: bw, boardLength: bl, pattern: pat, size: [bl, bw * PLANK_ROWS[pat]] };
  }
  if (isTiled(m)) return { ...t, grout: layout?.grout ?? t.grout ?? 0, size: layout?.size ?? m.physicalSize };
  if (t.type === 'brick') {
    // repeat: two brick courses (half bond) — length + joint × 2 × (height + joint)
    const bl = t.boardLength ?? 0.25, bh = t.boardWidth ?? 0.065, j = layout?.grout ?? t.grout ?? 0.01;
    return { ...t, grout: j, size: [bl + j, 2 * (bh + j)] };
  }
  if (isParquet(m)) {
    const bw = layout?.boardWidth ?? t.boardWidth!, bl = layout?.boardLength ?? t.boardLength!;
    return { ...t, boardWidth: bw, boardLength: bl, size: parquetModule(t.type, bw, bl) };
  }
  return { ...t, size: m.physicalSize };
}

/** pattern module size on the surface [m] — real scale (a 0.60 × 0.60 tile = 0.60 × 0.60); the catalog repeat densifies the pattern */
export function physicalSize(m: MaterialDef, layout?: FinishLayout | null): [number, number] {
  const s = effectiveTexture(m, layout).size;
  return [s[0] / (m.repeat?.[0] || 1), s[1] / (m.repeat?.[1] || 1)];
}

/** how many modules one texture covers (tile / board shade variation between repeats) */
export function textureCover(m: MaterialDef): [number, number] {
  const t = m.textureSet.type;
  if (t === 'tiles' || t === 'terrazzo') return [4, 4];
  if (t === 'planks') return [2, 1];
  if (t === 'herringbone' || t === 'chevron') return [2, 6];
  if (t === 'brick') return [4, 6];
  if (t === 'fluted' || t === 'slats') return [10, 10];
  return [1, 1];
}

/** texture size on the surface [m] = module × number of modules */
export function textureExtent(m: MaterialDef, layout?: FinishLayout | null): [number, number] {
  const [w, h] = physicalSize(m, layout), [nx, ny] = textureCover(m);
  return [w * nx, h * ny];
}

/** texture repeats per 1 m (surface UVs in metres) */
export const repeatPerMeter = (m: MaterialDef, layout?: FinishLayout | null): [number, number] => {
  const [w, h] = textureExtent(m, layout);
  return [1 / w, 1 / h];
};

/** pattern rotation [°]: catalog + user layout */
export const patternRotation = (m: MaterialDef, layout?: FinishLayout | null) => (m.rotation ?? 0) + (layout?.rotation ?? 0);

/** layout parameters worth editing for the given material */
export function editableLayout(m: MaterialDef): ('size' | 'grout' | 'rotation' | 'offset' | 'boardWidth' | 'boardLength' | 'pattern')[] {
  if (isPlanks(m)) return ['boardWidth', 'boardLength', 'pattern', 'rotation', 'offset'];
  if (isParquet(m)) return ['boardWidth', 'boardLength', 'rotation', 'offset'];
  if (isTiled(m)) return ['size', 'grout', 'rotation', 'offset'];
  if (m.textureSet.type === 'brick') return ['grout', 'offset'];
  if (m.textureSet.type === 'solid') return [];
  return ['rotation', 'offset'];
}

export const LAYOUT_LIMITS = {
  size: [0.05, 1.6], grout: [0, 0.01], boardWidth: [0.06, 0.4], boardLength: [0.3, 3.0], offset: [-2, 2],
} as const;

/** default room finishes by room kind */
export function defaultFinish(kind: string, surface: 'wall' | 'floor' | 'ceiling'): FinishRef {
  if (surface === 'wall') return { materialId: kind === 'bath' ? 'walltile-white-30x60' : 'paint-white' };
  if (surface === 'ceiling') return { materialId: 'paint-white' };
  if (kind === 'bath' || kind === 'tech' || kind === 'hall') return { materialId: 'tile-60-grey' };
  if (kind === 'garage') return { materialId: 'concrete-microcement' };
  return { materialId: 'laminate-oak-light' };
}

/**
 * Neutral interior finish (preview, not stored in the project): warm white walls (bathrooms — 30 × 60
 * tiles, garages and technical rooms — light grey paint), white ceiling, floor by room kind.
 */
export function neutralFinish(kind: string, surface: 'wall' | 'floor' | 'ceiling'): FinishRef {
  if (surface === 'ceiling') return { materialId: 'paint-white' };
  if (surface === 'wall') return { materialId: kind === 'bath' ? 'walltile-white-30x60' : kind === 'garage' || kind === 'tech' ? 'paint-light-grey' : 'paint-warm-white' };
  if (kind === 'living' || kind === 'bed' || kind === 'office' || kind === 'room' || kind === 'storage') return { materialId: 'wood-floor-oak' };
  return defaultFinish(kind, 'floor');
}

/** resulting colour (paints: the user's colour) */
export const finishColor = (m: MaterialDef, ref?: Pick<FinishRef, 'color'> | null) => ref?.color || m.baseColor;
