// Screenshot with variant metadata: the scene image (also an A/B comparison — both halves labelled) + a caption band
// (project, variant / comparison sides, sun date and time, sun position, view and camera, quality, time taken).
// The same metadata is stored in the PNG file as an iTXt chunk (UTF-8, keyword "home-simulator") — readable by programs
// and tests. File: screenshot-<variant>-<YYYYMMDD-HHMM>.png.
import { lang, t } from '../i18n';
import { profileFor } from './quality/profile';
import { hasModule, projectTitle } from '../project/active';
import { fmtTime, sunAt } from './model/sun';
import { roomById } from './model/rooms';
import { sceneApi } from './scene/sceneApi';
import { docOf, design } from './store/design';
import { sidesOf } from './store/sides';
import { toast, ui } from './store/ui';
import type * as THREE from 'three';
import { crc32 } from './zip';

export interface ScreenshotMeta {
  app: 'home-simulator';
  project: string;
  takenAt: string;
  variants: { side: 'A' | 'B'; id: string; name: string; label: string; updatedAt: string | null }[];
  compare: 'variants' | 'room' | null;
  /** environment / sun: null — the project has no environment / sun module (the caption then does not mention them) */
  view: { mode: string; room: string | null; camera: { position: number[]; target: number[] | null; fov: number | null } | null; environment: boolean | null; quality: string; profile?: string };
  sun: { date: string; time: string; azimuth: number; elevation: number } | null;
  image: { width: number; height: number };
}

/** inserts an iTXt chunk (UTF-8) after the IHDR header of a PNG file */
export function pngWithText(png: Uint8Array, keyword: string, text: string): Uint8Array {
  const enc = new TextEncoder(), kw = enc.encode(keyword), tx = enc.encode(text);
  const data = new Uint8Array(kw.length + 5 + tx.length);
  data.set(kw, 0); // keyword \0 compression flag 0, method 0, language \0, translated keyword \0, text
  data.set(tx, kw.length + 5);
  const type = enc.encode('iTXt'), chunk = new Uint8Array(12 + data.length), dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length);
  chunk.set(type, 4); chunk.set(data, 8);
  dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  const ihdrEnd = 8 + 4 + 4 + new DataView(png.buffer, png.byteOffset).getUint32(8) + 4;
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0); out.set(chunk, ihdrEnd); out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

/** reads an iTXt chunk (tests) */
export function pngText(png: Uint8Array, keyword: string): string | null {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength), dec = new TextDecoder();
  for (let p = 8; p + 12 <= png.length;) {
    const len = dv.getUint32(p), type = dec.decode(png.subarray(p + 4, p + 8));
    if (type === 'iTXt') {
      const d = png.subarray(p + 8, p + 8 + len), z = d.indexOf(0);
      if (dec.decode(d.subarray(0, z)) === keyword) { let q = z + 3; q = d.indexOf(0, q) + 1; q = d.indexOf(0, q) + 1; return dec.decode(d.subarray(q)); }
    }
    p += 12 + len;
  }
  return null;
}

export function screenshotMeta(): ScreenshotMeta {
  const s = ui.get(), doc = docOf(design.get()), sides = sidesOf(doc, s.compare), c = sceneApi.camera as THREE.PerspectiveCamera | null, cv = sceneApi.dom;
  const p = sunAt(s.sun.date, s.sun.minutes), r3 = (v: number) => Math.round(v * 1000) / 1000;
  const room = roomById(s.roomId);
  return {
    app: 'home-simulator', project: projectTitle(), takenAt: new Date().toISOString(),
    variants: sides.map((sd) => ({ side: sd.id, id: sd.variant.id, name: sd.variant.name, label: sd.label, updatedAt: sd.variant.updatedAt ?? null })),
    compare: s.compare?.kind ?? null,
    view: {
      mode: s.roomId ? t('screenshot.roomMode', { view: s.roomView }) : s.houseView, room: room ? room.label : null,
      camera: c ? { position: [r3(c.position.x), r3(-c.position.z), r3(c.position.y)], target: sceneApi.target ? [r3(sceneApi.target.x), r3(-sceneApi.target.z), r3(sceneApi.target.y)] : null, fov: c.isPerspectiveCamera ? r3(c.fov) : null } : null,
      environment: hasModule('environment') ? s.environment : null, quality: s.quality, profile: profileFor(s.platform, s.quality).id,
    },
    sun: hasModule('sun') ? { date: s.sun.date, time: fmtTime(s.sun.minutes), azimuth: Math.round(p.azimuth * 10) / 10, elevation: Math.round(p.elevation * 10) / 10 } : null,
    image: { width: cv?.width ?? 0, height: cv?.height ?? 0 },
  };
}

/** second caption line: sun and surroundings only when the project has them */
export function screenshotCaption(meta: ScreenshotMeta): string {
  const cam = meta.view.camera;
  return [
    meta.sun && t('screenshot.sun', { date: meta.sun.date, time: meta.sun.time, azimuth: meta.sun.azimuth, elevation: meta.sun.elevation }),
    `${t('screenshot.view', { mode: meta.view.mode })}${meta.view.room ? ` — ${meta.view.room}` : ''}${cam ? `  ·  ${t('screenshot.camera', { position: cam.position.join(', '), fov: cam.fov ?? '—' })}` : ''}`,
    meta.view.environment !== null && (meta.view.environment ? t('screenshot.environmentOn') : t('screenshot.environmentOff')),
    new Date(meta.takenAt).toLocaleString(lang()),
  ].filter(Boolean).join('  ·  ');
}

/** image with a caption band (PNG with metadata) */
export async function composeScreenshot(): Promise<{ blob: Blob; meta: ScreenshotMeta; name: string } | null> {
  const cv = sceneApi.dom;
  if (!cv) return null;
  const meta = screenshotMeta(), k = Math.max(1, cv.width / Math.max(1, cv.clientWidth || cv.width));
  const band = Math.round(70 * k), out = document.createElement('canvas');
  out.width = cv.width; out.height = cv.height + band;
  const g = out.getContext('2d')!;
  g.drawImage(cv, 0, 0);
  const font = (px: number, w = 600) => `${w} ${Math.round(px * k)}px Inter, "Segoe UI", system-ui, sans-serif`;
  // labels of the comparison sides
  if (meta.variants.length === 2) {
    meta.variants.forEach((v, i) => {
      const x = i === 0 ? 16 * k : cv.width / 2 + 16 * k, text = `${v.side} · ${v.label}`;
      g.font = font(15, 700); const tw = g.measureText(text).width;
      g.fillStyle = 'rgba(255,255,255,0.92)'; g.fillRect(x - 8 * k, 14 * k, tw + 16 * k, 28 * k);
      g.fillStyle = '#1d2533'; g.fillText(text, x, 34 * k);
    });
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(cv.width / 2 - k, 0, 2 * k, cv.height);
  }
  g.fillStyle = '#ffffff'; g.fillRect(0, cv.height, out.width, band);
  g.fillStyle = '#e4e8ee'; g.fillRect(0, cv.height, out.width, Math.max(1, k));
  g.fillStyle = '#1d2533'; g.font = font(15, 700);
  const names = meta.variants.length === 2 ? t('screenshot.comparison', { a: meta.variants[0].label, b: meta.variants[1].label }) : t('screenshot.variant', { name: meta.variants[0].name });
  g.fillText(`${meta.project}  ·  ${names}`, 16 * k, cv.height + 28 * k);
  g.fillStyle = '#5a6475'; g.font = font(12.5, 500);
  g.fillText(screenshotCaption(meta), 16 * k, cv.height + 52 * k);
  const blob0 = await new Promise<Blob | null>((ok) => out.toBlob(ok, 'image/png'));
  if (!blob0) return null;
  const png = pngWithText(new Uint8Array(await blob0.arrayBuffer()), 'home-simulator', JSON.stringify(meta));
  const stamp = meta.takenAt.slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const vname = meta.variants.map((v) => v.name).join('-vs-').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return { blob: new Blob([png as BlobPart], { type: 'image/png' }), meta, name: `screenshot-${vname || 'home'}-${stamp}.png` };
}

/** screenshot to download */
export async function takeScreenshot(): Promise<ScreenshotMeta | null> {
  let r: Awaited<ReturnType<typeof composeScreenshot>> = null;
  try { r = await composeScreenshot(); } catch (e) { toast(t('screenshot.failedWithReason', { message: (e as Error).message }), 'error'); console.error(e); return null; }
  if (!r) { toast(t('screenshot.failed'), 'error'); return null; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(r.blob); a.download = r.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  (window as unknown as { __lastScreenshot?: unknown }).__lastScreenshot = { name: r.name, meta: r.meta, bytes: r.blob.size };
  return r.meta;
}
