// PROJECT DOCUMENT (ConfiguratorDoc) — everything the user designed in one project: variants (furnishing, finishes,
// stairs finishes, own electrical layout, view, sun), camera bookmarks, imported furniture models, the global electrical
// plan. Pure TypeScript — no three.js, tested in vitest.
// A document belongs to exactly one project (projectId — docs/adr/0002); a document of another project is rejected on
// load and on save. Schema home-simulator/document, version 1 (ADR: the engine starts with a fresh document format).
import { t } from '../i18n';
import { planErrors } from '../home/model/electrical';
import { bookmarksErrors, importedErrors, interiorsErrors } from '../home/model/interiors';
import type { CameraBookmark, ImportedAsset } from '../home/model/types';
import { variantExtrasErrors, type Variant } from '../home/model/variantData';
import type { ElectricalPlan } from '../home/model/electrical';
import { projectId } from '../project/active';

export type { Variant } from '../home/model/variantData';

export const DOC_SCHEMA = 'home-simulator/document';
export const DOC_VERSION = 1;

export interface ConfiguratorDoc {
  schema: typeof DOC_SCHEMA;
  version: typeof DOC_VERSION;
  /** project the document belongs to — a document of another project is rejected on load and save */
  projectId: string;
  activeVariantId: string;
  variants: Variant[];
  /** camera bookmarks */
  bookmarks: CameraBookmark[];
  /** furniture models imported by the user (metadata; files in assets/furniture/imported/) */
  importedAssets: ImportedAsset[];
  /** electrical / smart-home plan — GLOBAL (shared by all variants); absent = the points from the project sources.
   *  A variant may have its own layout (Variant.electrical). */
  electrical?: ElectricalPlan | null;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

let counter = 0;
export const newVariantId = () => `v-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** empty variant: furnishing starts from the project defaults (interiors are filled lazily per room) */
export function createVariant(name?: string, id = newVariantId()): Variant {
  return { id, name: name ?? t('document.newVariant'), interiors: {} };
}

export const duplicateVariant = (v: Variant, existing: Variant[]): Variant => {
  let name = t('document.copyOf', { name: v.name }), i = 2;
  while (existing.some((x) => x.name === name)) name = t('document.copyOfN', { name: v.name, n: i++ });
  return { ...clone(v), id: newVariantId(), name };
};

export const renameVariant = (v: Variant, name: string): Variant => ({ ...v, name: name.trim() || v.name });

export function defaultDoc(): ConfiguratorDoc {
  const v = createVariant(t('document.defaultVariant'), 'v-default');
  return { schema: DOC_SCHEMA, version: DOC_VERSION, projectId: projectId(), activeVariantId: v.id, variants: [v], bookmarks: [], importedAssets: [] };
}

// ---------------------------------------------------------------- JSON document
export function docErrors(doc: unknown): string[] {
  const e: string[] = [];
  const d = doc as ConfiguratorDoc;
  if (!d || typeof d !== 'object') return ['expected an object'];
  if (d.schema !== DOC_SCHEMA) e.push(`unknown schema: ${String(d.schema)}`);
  if (d.version !== DOC_VERSION) e.push(`unsupported version: ${String(d.version)}`);
  // project ownership: a document of another project is rejected, never adapted
  if (d.projectId !== projectId()) return [...e, `the document belongs to project "${String(d.projectId)}", the open project is "${projectId()}"`];
  e.push(...bookmarksErrors(d.bookmarks), ...importedErrors(d.importedAssets));
  e.push(...planErrors(d.electrical));
  if (!Array.isArray(d.variants) || !d.variants.length) return [...e, 'no variants'];
  const ids = new Set<string>();
  for (const v of d.variants) {
    if (!v || typeof v.id !== 'string' || !v.id) { e.push('variant without an id'); continue; }
    if (ids.has(v.id)) e.push(`repeated variant id ${v.id}`);
    ids.add(v.id);
    if (typeof v.name !== 'string' || !v.name.trim()) e.push(`${v.id}: no name`);
    e.push(...variantExtrasErrors(v).map((x) => `${v.name} / ${x}`));
    e.push(...interiorsErrors(v.interiors, Array.isArray(d.importedAssets) ? d.importedAssets : []).map((x) => `${v.name} / ${x}`));
  }
  if (!ids.has(d.activeVariantId)) e.push('activeVariantId does not point to an existing variant');
  return e;
}

export function serializeDoc(doc: ConfiguratorDoc): string {
  return JSON.stringify(doc, null, 1) + '\n';
}

export function parseDoc(text: string): ConfiguratorDoc {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (err) { throw new Error(`JSON syntax error: ${(err as Error).message}`); }
  const errs = docErrors(raw);
  if (errs.length) throw new Error(errs.join('; '));
  const d = raw as ConfiguratorDoc;
  return { ...d, variants: d.variants.map((v) => ({ ...v, interiors: v.interiors ?? {} })), bookmarks: d.bookmarks ?? [], importedAssets: d.importedAssets ?? [] };
}
