// Texts drawn into the previews, from the app's dictionaries (src/i18n/<lang>/print.json and preview.json), bundled into the
// plugin. Everything else the CLI prints is English; the skill translates labels for the user and keeps every value as printed.
import enPreview from '../../../src/i18n/en/preview.json' with { type: 'json' };
import enPrint from '../../../src/i18n/en/print.json' with { type: 'json' };
import plPreview from '../../../src/i18n/pl/preview.json' with { type: 'json' };
import plPrint from '../../../src/i18n/pl/print.json' with { type: 'json' };
import type { PlanLabels } from '@home-sim/core/preview/plan';
import type { PreviewLabels } from '@home-sim/core/print/preview';

const DICTS: Record<string, Record<string, string>> = { en: { ...enPrint, ...enPreview }, pl: { ...plPrint, ...plPreview } };
export const LANGS = Object.keys(DICTS);

const pick = (lang: string, prefix: string) => Object.fromEntries(Object.entries(DICTS[lang] ?? DICTS.en).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
export const printLabels = (lang: string): Partial<PreviewLabels> => pick(lang, 'print.preview.');
export const planLabels = (lang: string): Partial<PlanLabels> => pick(lang, 'preview.plan.');
