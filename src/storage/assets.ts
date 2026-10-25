// User files on the device (IndexedDB): imported GLB / glTF models, their thumbnails, photos for camera matching. The file URL
// (/user-assets/…) is the same online and offline: the service worker fetches the file from the server and, when the server
// is unavailable, serves it from this store (src/pwa/sw.ts). Files added offline wait (pending) and are uploaded to the PC when
// the connection returns (syncAssets).
import { t } from '../i18n';
import { idbAll, idbDelete, idbGet, idbPut, STORE } from './db';

export const USER_ASSET_PREFIX = '/user-assets/';
export interface StoredAsset {
  /** URL under which the app reads the file (key) */
  url: string;
  blob: Blob;
  type: string;
  bytes: number;
  savedAt: string;
  /** added offline — waiting to be uploaded to `api` */
  pending: boolean;
  api: string | null;
}
const typeOf = (url: string, blob: Blob) => blob.type || ({ glb: 'model/gltf-binary', gltf: 'model/gltf+json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[url.split('.').pop()!.toLowerCase()] || 'application/octet-stream';

export async function putAsset(url: string, blob: Blob, opts: { pending?: boolean; api?: string | null } = {}): Promise<boolean> {
  return idbPut(STORE.assets, { url, blob, type: typeOf(url, blob), bytes: blob.size, savedAt: new Date().toISOString(), pending: !!opts.pending, api: opts.api ?? null } satisfies StoredAsset);
}
export const getAsset = (url: string) => idbGet<StoredAsset>(STORE.assets, url);
export const listAssets = () => idbAll<StoredAsset>(STORE.assets);
export const deleteAsset = (url: string) => idbDelete(STORE.assets, url);

export interface UploadResult { ok: boolean; file?: string; url?: string; /** stored on the device only (offline) */ offline?: boolean; error?: string }
/**
 * Upload of a user file: online — to the server (plus a copy on the device so the file is available offline); without a
 * connection — to the device only, marked for a later upload. `url` — the URL under which the file will be read.
 */
export async function uploadUserFile(api: string, url: string, body: Blob): Promise<UploadResult> {
  let r: Response | null = null;
  try { r = await fetch(api, { method: 'POST', body }); } catch { r = null; }
  if (r) {
    const j = await r.json().catch(() => ({})) as { file?: string; url?: string; errors?: string[] };
    if (!r.ok) return { ok: false, error: (j.errors ?? [r.statusText]).join('; ') };
    await putAsset(j.url ?? url, body);
    return { ok: true, file: j.file, url: j.url ?? url };
  }
  if (await putAsset(url, body, { pending: true, api })) return { ok: true, file: decodeURIComponent(url.split('/').pop()!), url, offline: true };
  return { ok: false, error: t('storage.uploadFailedOffline') };
}
/** upload of files added offline; returns the number uploaded */
export async function syncAssets(): Promise<number> {
  let n = 0;
  for (const a of await listAssets()) {
    if (!a.pending || !a.api) continue;
    let r: Response | null = null;
    try { r = await fetch(a.api, { method: 'POST', body: a.blob }); } catch { return n; }           // still offline
    if (r.ok || r.status === 409) { await idbPut(STORE.assets, { ...a, pending: false }); n++; }
  }
  return n;
}
/** device storage used by the app (browser estimate) and persistence (whether the browser may delete the data) */
export async function storageInfo(): Promise<{ usage: number | null; quota: number | null; persisted: boolean | null; assets: number; assetBytes: number; pending: number }> {
  const all = await listAssets();
  let usage: number | null = null, quota: number | null = null, persisted: boolean | null = null;
  try { const e = await navigator.storage?.estimate?.(); usage = e?.usage ?? null; quota = e?.quota ?? null; persisted = (await navigator.storage?.persisted?.()) ?? null; } catch { /* no API */ }
  return { usage, quota, persisted, assets: all.length, assetBytes: all.reduce((s, a) => s + a.bytes, 0), pending: all.filter((a) => a.pending).length };
}
/** request for persistent storage (without it the browser may clear the data when space runs low) */
export async function requestPersistence(): Promise<boolean | null> { try { return (await navigator.storage?.persist?.()) ?? null; } catch { return null; } }
