// Names in several languages (A3 of the usability tests): every name a person reads in the app — the house, its levels, rooms,
// walk places and views — may carry `names` (language code → text) next to the name written in the package's own language
// (manifest.language). localizePackage gives the package as seen in one UI language: each name replaced by its translation
// when there is one, the rest untouched (ids, geometry and every other field stay the same).
import type { Names, ProjectPackage } from './types.ts';

/** the text in a language: its translation, else the text itself */
export const inLang = (text: string, names: Names | undefined, lang: string): string => names?.[lang] ?? text;

/** the package as seen in `lang`; the same object when nothing in it has a translation into that language */
export function localizePackage(p: ProjectPackage, lang: string): ProjectPackage {
  const has = (n?: Names) => !!n && lang in n;
  const m = p.manifest, rooms = p.building.rooms.rooms;
  const any = has(m.names) || m.levels.some((l) => has(l.names)) || rooms.some((r) => has(r.names))
    || (p.viewpoints ?? []).some((v) => has(v.names) || has(v.hints)) || (p.views?.presets ?? []).some((v) => has(v.labels) || has(v.hints));
  if (!any) return p;
  return {
    ...p,
    manifest: { ...m, name: inLang(m.name, m.names, lang), levels: m.levels.map((l) => ({ ...l, name: inLang(l.name, l.names, lang) })) },
    // the level names of the building data (what the engine shows) follow the manifest's levels
    building: { ...p.building, rooms: { ...p.building.rooms,
      levels: Object.fromEntries(Object.entries(p.building.rooms.levels).map(([id, l]) => { const ml = m.levels.find((x) => x.id === id); return [id, ml && has(ml.names) ? { ...l, name: ml.names![lang] } : l]; })),
      rooms: rooms.map((r) => (has(r.names) ? { ...r, name: r.names![lang], label: r.names![lang] } : r)) } },
    ...(p.viewpoints ? { viewpoints: p.viewpoints.map((v) => ({ ...v, name: inLang(v.name, v.names, lang), hint: inLang(v.hint, v.hints, lang) })) } : {}),
    ...(p.views ? { views: { ...p.views, presets: p.views.presets.map((v) => ({ ...v, label: inLang(v.label, v.labels, lang), hint: inLang(v.hint, v.hints, lang) })) } } : {}),
  };
}
