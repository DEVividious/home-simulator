// Electrical plan exports from the current project: PDF (plans + legend + table), JSON and CSV. The files are created in
// the browser (also on a phone / in the PWA) and downloaded as ordinary files. The last export is described in
// window.__homeExport (E2E tests).
import { projectTitle } from '../../project/active';
import { electricalScope, planNow } from '../actions';
import { toCsv, toJson, type ElectricalPlan } from '../model/electrical';
import { allLevels } from '../model/rooms';
import { furnitureOutlines } from '../plan/planData';
import { docOf, design, variantOf } from '../store/design';
import { toast } from '../store/ui';
import { pdfCharSet, pdfFileName, pdfModel, pdfTexts, renderPdf, type PdfGroup, type PdfOptions } from './electricalPdf';
import { pdfReplaced, replacedText, type PdfReplaced } from './pdfText';
import regularUrl from './fonts/DejaVuSans-subset.ttf?url';
import boldUrl from './fonts/DejaVuSans-Bold-subset.ttf?url';
import { t } from '../../i18n';

export const b64 = (buf: ArrayBuffer) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const scopeText = () => (electricalScope() === 'variant' ? t('pdf.scopeVariant', { name: variantOf(design.get()).name }) : t('pdf.scopeShared'));

export function download(name: string, data: BlobPart, type: string): number {
  const blob = new Blob([data], { type }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  return blob.size;
}
export const note = (x: Record<string, unknown>) => { (window as unknown as Record<string, unknown>).__homeExport = x; };

export interface ExportPdfOptions { format: 'a4' | 'a3'; groups: PdfGroup[]; furniture: boolean }
/** PDF document options for the current project */
export function pdfOptions(o: ExportPdfOptions): PdfOptions {
  const s = design.get();
  return { format: o.format, groups: o.groups, project: projectTitle(), date: today(), scope: scopeText(), furniture: o.furniture ? Object.fromEntries(allLevels().map((l) => [l.id, furnitureOutlines(l.id, s)])) : undefined };
}
/** EXPORT THE ELECTRICAL PLAN AS PDF; `replaced` — description characters the print font lacks (in the PDF they get a substitute spelling or "?") */
export async function exportElectricalPdf(o: ExportPdfOptions, plan: ElectricalPlan = planNow(), save = true): Promise<{ name: string; bytes: ArrayBuffer; pages: number; replaced: PdfReplaced } | null> {
  try {
    const opts = pdfOptions(o), pages = pdfModel(plan, opts);
    const [regular, bold] = await Promise.all([regularUrl, boldUrl].map(async (u) => b64(await (await fetch(u)).arrayBuffer())));
    const fonts = { regular, bold }, bytes = await renderPdf(pages, opts, fonts), name = pdfFileName(opts.date);
    const replaced = pdfReplaced(pdfTexts(pages, opts), pdfCharSet(fonts));
    if (save) download(name, bytes, 'application/pdf');
    const n = (new TextDecoder('latin1').decode(bytes).match(/\/Type\s*\/Page\b/g) ?? []).length;
    note({ kind: 'pdf', name, size: bytes.byteLength, pages: n, format: o.format, groups: o.groups, points: plan.points.length, replaced: replaced.count, replacedChars: replaced.chars });
    if (save) toast(`${t('pdf.exportDone', { name, pages: n })}${replaced.count ? `. ${replacedText(replaced, 3)}` : ''}`, replaced.count ? 'warn' : 'info');
    return { name, bytes, pages: n, replaced };
  } catch (e) { toast(t('pdf.exportFailed', { error: (e as Error).message }), 'error'); return null; }
}
export function exportElectricalJson(plan: ElectricalPlan = planNow()): string {
  const text = toJson(plan, { project: projectTitle(), exportedAt: new Date().toISOString(), scope: scopeText() });
  note({ kind: 'json', name: 'electrical-points.json', size: download('electrical-points.json', text, 'application/json'), points: plan.points.length });
  return text;
}
export function exportElectricalCsv(plan: ElectricalPlan = planNow()): string {
  const text = toCsv(plan);
  note({ kind: 'csv', name: 'electrical-points.csv', size: download('electrical-points.csv', text, 'text/csv;charset=utf-8'), points: plan.points.length });
  return text;
}
export const hasGlobalPlan = () => !!docOf(design.get()).electrical;
