// Module worker of the core (ADR 0026): loads the solid kernel (manifold-3d WASM, a bundled asset) on the first request.
//  • shell — builds the level and roof solids of a package's building block and sends back three.js arrays (transferred),
//    the wall mass in plan of every level (the section of its solid) and the parts the kernel failed on;
//  • print — the printable scale model (core print/, ADR 0030–0032): the STL parts, the report and the preview picture — the same
//    STL bytes as `npm run project:print` for the same building block, bed, profile and scale (ADR 0044).
// The main thread never loads the kernel (three/coreShell.ts).
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { building, type BuildingData } from '@home-sim/core/model/building';
import { printModel } from '@home-sim/core/print/model';
import { printPreview, type PreviewLabels } from '@home-sim/core/print/preview';
import { parseBed } from '@home-sim/core/print/printers';
import { profileOf } from '@home-sim/core/print/profiles';
import { scaleTag } from '@home-sim/core/print/scale';
import { shellMeshes, type ShellFailure } from '@home-sim/core/solid/levels';
import { kernelMessage, loadGeometry } from '@home-sim/core/solid/wasm';
import { levelArrays, levelBuffers, type LevelArrays } from './coreMesh';
import type { WallSections } from '../model/shell';

export interface PrintRequest { bed: string; nozzle: string; margin: number; name: string; meta: Record<string, string>; labels: Partial<PreviewLabels> }
export type CoreRequest = { id: number; kind?: 'shell'; data: BuildingData } | { id: number; kind: 'print'; data: BuildingData; print: PrintRequest };
export interface PrintFile { name: string; bytes: Uint8Array }
export type CoreReply =
  | { id: number; ok: true; kind?: 'shell'; levels: LevelArrays[]; roofs: LevelArrays[]; sections: WallSections; failed: ShellFailure[]; triangles: number; ms: number; loadMs: number }
  | { id: number; ok: true; kind: 'print'; printable: boolean; scale: string | null; files: PrintFile[]; problems: string[] }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as { onmessage: ((e: MessageEvent<CoreRequest>) => void) | null; postMessage: (m: CoreReply, transfer?: ArrayBuffer[]) => void };
let loadMs = 0;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** the print model as files: the STL parts, print-report.json (as the CLI writes it) and the preview picture */
async function printFiles(data: BuildingData, o: PrintRequest, geo: Awaited<ReturnType<typeof loadGeometry>>) {
  const bed = parseBed(o.bed), profile = profileOf(o.nozzle);
  const m = printModel(data, geo, { bed, profile, scale: null, margin: o.margin, eaves: 'keep', name: o.name, meta: o.meta });
  const files: PrintFile[] = [], listed: { file: string; bytes: number; sha256: string }[] = [];
  for (const p of m.parts) if (p.stl) {
    files.push({ name: p.file, bytes: p.stl });
    listed.push({ file: p.file, bytes: p.stl.length, sha256: hex(await crypto.subtle.digest('SHA-256', p.stl as Uint8Array<ArrayBuffer>)) });
  }
  files.push({ name: 'print-report.json', bytes: new TextEncoder().encode(JSON.stringify({ ...m.report, files: listed }, null, 1) + '\n') });
  if (m.n && m.parts.length && typeof OffscreenCanvas !== 'undefined') {
    const img = printPreview(m, { bed, margin: o.margin, title: o.name, labels: o.labels });
    const rgba = new Uint8ClampedArray(img.width * img.height * 4);
    for (let i = 0, j = 0; i < img.rgb.length; i += 3, j += 4) { rgba[j] = img.rgb[i]; rgba[j + 1] = img.rgb[i + 1]; rgba[j + 2] = img.rgb[i + 2]; rgba[j + 3] = 255; }
    const cv = new OffscreenCanvas(img.width, img.height);
    cv.getContext('2d')!.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
    files.push({ name: `preview-${scaleTag(m.n)}.png`, bytes: new Uint8Array(await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer()) });
  }
  return { printable: m.ok && listed.length > 0, scale: m.n ? scaleTag(m.n) : null, files, problems: [...m.problems, ...m.parts.flatMap((p) => p.problems.map((x) => `${p.id}: ${x}`))] };
}

ctx.onmessage = async ({ data: req }) => {
  const { id } = req;
  try {
    const t0 = performance.now();
    const geo = await loadGeometry({ locateFile: () => new URL(wasmUrl, self.location.href).href });
    if (!loadMs) loadMs = performance.now() - t0;
    if (req.kind === 'print') {
      const r = await printFiles(req.data, req.print, geo);
      ctx.postMessage({ id, ok: true, kind: 'print', ...r }, r.files.map((f) => f.bytes.buffer as ArrayBuffer));
      return;
    }
    const t1 = performance.now(), shell = shellMeshes(geo, building(req.data)), levels = shell.levels.map(levelArrays), roofs = shell.roofs.map(levelArrays);
    const sections = Object.fromEntries(shell.levels.map((l) => [l.level, l.section]));
    ctx.postMessage({ id, ok: true, levels, roofs, sections, failed: shell.failed, triangles: shell.triangles, ms: performance.now() - t1, loadMs }, [...levels, ...roofs].flatMap(levelBuffers));
  } catch (e) {
    ctx.postMessage({ id, ok: false, error: kernelMessage(e) });
  }
};
