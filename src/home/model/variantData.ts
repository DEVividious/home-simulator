// A complete design variant: besides interiors (arrangements, furniture, finishes, rugs) a variant remembers:
//   • stairs finishes (treads, handrail, balustrade), its own electrical layout (when split from the global plan),
//   • the view (camera, FOV, surroundings) and the sun (date, time),
//   • a thumbnail (JPEG ~320 px, data URL) and when it was saved.
// All of these fields are optional. Export / import of a single variant: JSON file { schema: 'home-simulator/variant',
// version: 1, variant, importedAssets } validated with the same rules as the project document (docErrors).
import { t } from '../../i18n';
import type { ConfiguratorDoc } from '../../document/model';
import { project } from '../../project/active';
import { planErrors, type ElectricalPlan } from './electrical';
import { stairsErrors, type DeepPartial, type StairsConfig } from './stairsConfig';
import type { ImportedAsset, RoomInterior, Vec3 } from './types';

export interface VariantView { position: Vec3; target: Vec3; fov: number; environment: boolean }
export interface VariantSun { date: string; minutes: number }

export interface Variant {
  id: string;
  name: string;
  /** interiors — per-room arrangements: furniture, wall / floor / ceiling finishes */
  interiors: Record<string, RoomInterior>;
  /** stairs finishes: cladding, handrail, balustrade (model/stairsConfig.ts) — absent = bare concrete */
  stairs?: DeepPartial<StairsConfig> | null;
  /** own electrical layout of the variant (when the user split the plan); absent = the document's global plan */
  electrical?: ElectricalPlan | null;
  view?: VariantView | null;
  sun?: VariantSun | null;
  thumbnail?: string | null;
  updatedAt?: string | null;
}

/** @deprecated identity kept while the port settles — a Variant carries all fields */
export type FullVariant = Variant;
/** @deprecated identity kept while the port settles */
export const extrasOf = (v: Variant): Variant => v;

const fin = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const v3 = (x: unknown) => Array.isArray(x) && x.length === 3 && x.every(fin);

/** validation of the optional fields of one variant */
export function variantExtrasErrors(v: Variant): string[] {
  const e: string[] = [];
  e.push(...stairsErrors(v.stairs));
  e.push(...planErrors(v.electrical, 'electrical (variant)'));
  if (v.view && (!v3(v.view.position) || !v3(v.view.target) || !fin(v.view.fov) || v.view.fov < 10 || v.view.fov > 120 || typeof v.view.environment !== 'boolean')) e.push('view: position, target, fov 10–120, environment');
  if (v.sun && (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.sun.date)) || !fin(v.sun.minutes) || v.sun.minutes < 0 || v.sun.minutes >= 1440)) e.push('sun: date YYYY-MM-DD, minutes 0–1439');
  if (v.thumbnail !== undefined && v.thumbnail !== null && !(typeof v.thumbnail === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(v.thumbnail) && v.thumbnail.length < 400_000)) e.push('thumbnail: image data URL (≤ 300 kB)');
  return e;
}

// ------------------------------------------------------------------ variant export / import
export const VARIANT_SCHEMA = 'home-simulator/variant';

export interface VariantFile {
  schema: typeof VARIANT_SCHEMA;
  version: 1;
  exportedAt: string;
  /** origin: project id, project description (informative), document version */
  project: { id: string; name: string; docVersion: number };
  variant: Variant;
  /** furniture models imported by the user and used by the variant's arrangements (metadata; GLB files separately) */
  importedAssets: ImportedAsset[];
}

/** variant furniture that refers to imported models */
function usedAssetIds(v: Variant): Set<string> {
  const ids = new Set<string>();
  for (const ri of Object.values(v.interiors ?? {})) for (const a of ri.arrangements) for (const f of a.furniture) ids.add(f.catalogId);
  return ids;
}

export function exportVariant(doc: ConfiguratorDoc, id: string, now = new Date()): VariantFile {
  const v = doc.variants.find((x) => x.id === id);
  if (!v) throw new Error(`no variant ${id}`);
  const used = usedAssetIds(v);
  return {
    schema: VARIANT_SCHEMA, version: 1, exportedAt: now.toISOString(), project: { id: doc.projectId, name: project().manifest.name, docVersion: doc.version },
    variant: JSON.parse(JSON.stringify(v)) as Variant,
    importedAssets: (doc.importedAssets ?? []).filter((a) => used.has(`imported:${a.id}`) || used.has(a.id)),
  };
}

/**
 * Variant import from a file: schema and version check, validation of the whole document after adding the variant (the
 * same rules as loading the project — interiors, furniture, materials, optional fields). The variant gets a new id when the
 * id exists and a unique name. Imported models missing in the project are added.
 */
export function importVariant(text: string, doc: ConfiguratorDoc, validate: (d: ConfiguratorDoc) => string[], newId: () => string, fallbackName: string):
  { ok: true; doc: ConfiguratorDoc; variantId: string; name: string; warnings: string[] } | { ok: false; errors: string[] } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { return { ok: false, errors: [`JSON syntax error: ${(e as Error).message}`] }; }
  const f = raw as Partial<VariantFile>;
  if (!f || typeof f !== 'object') return { ok: false, errors: ['expected a JSON object'] };
  if (f.schema !== VARIANT_SCHEMA) return { ok: false, errors: [`unknown schema: ${String(f.schema)} (expected ${VARIANT_SCHEMA})`] };
  if (f.version !== 1) return { ok: false, errors: [`unsupported variant file version: ${String(f.version)}`] };
  if (!f.variant || typeof f.variant !== 'object') return { ok: false, errors: ['no variant in the file'] };
  // a variant belongs to one project: a foreign one is rejected
  const from = f.project?.id;
  if (from !== doc.projectId) return { ok: false, errors: [`the file contains a variant of project "${String(from)}" — it does not match project "${doc.projectId}"`] };
  const v = JSON.parse(JSON.stringify(f.variant)) as Variant;
  const warnings: string[] = [];
  if (typeof v.id !== 'string' || doc.variants.some((x) => x.id === v.id)) v.id = newId();
  let name = typeof v.name === 'string' && v.name.trim() ? v.name.trim() : fallbackName, i = 2;
  const base = name;
  while (doc.variants.some((x) => x.name === name)) name = `${base} (${i++})`;
  if (name !== base) warnings.push(t('interiors.importRenamed', { name }));
  v.name = name;
  const assets = [...(doc.importedAssets ?? []), ...(Array.isArray(f.importedAssets) ? f.importedAssets : []).filter((a) => !(doc.importedAssets ?? []).some((q) => q.id === a.id))];
  const next: ConfiguratorDoc = { ...doc, importedAssets: assets, variants: [...doc.variants, v], activeVariantId: v.id };
  const errors = validate(next);
  if (errors.length) return { ok: false, errors };
  if (Array.isArray(f.importedAssets) && f.importedAssets.length) warnings.push(t('interiors.importModels', { count: f.importedAssets.length }));
  return { ok: true, doc: next, variantId: v.id, name, warnings };
}
