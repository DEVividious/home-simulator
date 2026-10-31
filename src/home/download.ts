// The Download menu (ADR 0044): everything that leaves the app as a file — a picture of the current view, a model to print (the
// core's STL parts made in the worker with the default bed and nozzle and the automatic scale, zipped with the report and the
// preview; the STL bytes are those of `npm run project:print` for the same bed) and, in advanced mode, the project file.
import { dictionary, lang, t } from '../i18n';
import { project } from '../project/active';
import { corePrint } from './three/coreShell';
import { takeScreenshot } from './screenshot';
import { exportProject } from './store/design';
import { toast } from './store/ui';
import { zipStore } from './zip';

/** the print the app makes: a common 220 × 220 × 250 mm bed, a 0.4 mm nozzle, 10 mm kept free on every side */
export const APP_PRINT = { bed: '220x220x250', nozzle: '0.4', margin: 10 };

function save(bytes: BlobPart, name: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const downloadPicture = () => takeScreenshot();

let printing = false;
/** the print model as one zip: <project>-print-1to<N>.zip with the STL parts, print-report.json and the preview */
export async function downloadPrint(): Promise<boolean> {
  if (printing) return false;
  printing = true;
  toast(t('steps.printMaking'));
  try {
    const name = project().manifest.projectId;
    const P = 'print.preview.', labels = Object.fromEntries(Object.entries({ ...dictionary('en'), ...dictionary(lang()) }).filter(([k]) => k.startsWith(P)).map(([k, v]) => [k.slice(P.length), v]));
    const r = await corePrint(project().building, { ...APP_PRINT, name, meta: { engine: 'app', source: 'Download › Print model' }, labels });
    if (!r.printable) { toast(t('steps.printFailed', { why: r.problems[0] ?? '' }), 'error'); return false; }
    const file = `${name}-print-${r.scale}.zip`;
    save(zipStore(r.files) as Uint8Array<ArrayBuffer>, file, 'application/zip');
    (window as unknown as { __lastPrint?: unknown }).__lastPrint = { file, files: r.files.map((f) => ({ name: f.name, bytes: f.bytes.length })) };
    // where the file is and what the scale in its name means; it stays long enough to be read
    toast(t('steps.printReady', { file, n: (r.scale ?? '').replace(/^1to/, '') }), 'info', 9000);
    return true;
  } catch (e) {
    toast(t('steps.printFailed', { why: (e as Error).message }), 'error');
    return false;
  } finally { printing = false; }
}

/** the project file (advanced mode): the whole document as JSON */
export function downloadProject() {
  save(exportProject(), `project-${project().manifest.projectId}-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
}
