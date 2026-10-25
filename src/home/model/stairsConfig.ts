// Stair configuration: the structure is reinforced concrete (default state — bare concrete), while the finish —
// tread and riser cladding, handrail, balustrade — is the user's choice stored in the project variant
// (Variant.stairs, optional field). The flight geometry (number and size of steps, landing, outline — model/stairs.ts) is NOT
// configurable: it is building data. Pure TS (tests without a browser).
import { t } from '../../i18n';

/** finish entry; `name` is a getter so it is translated in the current UI language */
const look = (id: string, color: string, roughness: number, metalness: number) => ({ get name(): string { return t(`stairs.finish.${id}`); }, color, roughness, metalness });
/** ready-made finishes; every finish field also accepts a custom #rrggbb colour */
export const STAIR_FINISHES = {
  concrete: look('concrete', '#c9c3b8', 0.85, 0),
  oak: look('oak', '#c49a6c', 0.55, 0),
  'oak-dark': look('oak-dark', '#8a6240', 0.55, 0),
  walnut: look('walnut', '#6e4a33', 0.5, 0),
  ash: look('ash', '#dcc7a2', 0.55, 0),
  white: look('white', '#f1efea', 0.6, 0),
  graphite: look('graphite', '#3b3e43', 0.5, 0.1),
  black: look('black', '#17181a', 0.4, 0.6),
  steel: look('steel', '#b9bcc0', 0.35, 0.8),
} as const;
export type StairFinishId = keyof typeof STAIR_FINISHES;
/** finish: a palette id or a custom #rrggbb colour */
export type StairFinish = StairFinishId | `#${string}`;

export type HandrailPlace = 'none' | 'outer' | 'inner' | 'both';
export type BalustradeType = 'none' | 'glass' | 'bars' | 'solid';

export interface StairsConfig {
  /** tread and landing cladding */
  tread: StairFinish;
  /** riser cladding; 'none' — no cladding (exposed concrete) */
  riser: StairFinish | 'none';
  /** tread cladding thickness [m] (0 — no cladding: bare concrete) and nosing overhang [m] */
  treadThickness: number;
  nosing: number;
  handrail: {
    /** outer — on the outer side of the flights; inner — by the partition between the flights */
    place: HandrailPlace;
    /** height above the step nosings [m] */
    height: number;
    profile: 'round' | 'rect';
    finish: StairFinish;
  };
  /** partition between the flights, the open side of the lower flight and the railing around the stair opening on the upper level */
  balustrade: { type: BalustradeType; height: number; finish: StairFinish };
}

/** default state: concrete stairs without cladding, handrails or balustrades */
export const DEFAULT_STAIRS: StairsConfig = {
  tread: 'concrete', riser: 'none', treadThickness: 0, nosing: 0,
  handrail: { place: 'none', height: 0.9, profile: 'round', finish: 'oak' },
  balustrade: { type: 'none', height: 0.9, finish: 'black' },
};

export const STAIR_LIMITS = { treadThickness: [0, 0.06, 0.005], nosing: [0, 0.04, 0.005], handrail: [0.8, 1.1, 0.01], balustrade: [0.9, 1.2, 0.01] } as const;

export interface StairsPreset { id: string; name: string; hint: string; config: StairsConfig }
/** preset with `name` / `hint` getters (translated in the current UI language) */
const preset = (id: string, config: StairsConfig): StairsPreset => ({
  id, config,
  get name(): string { return t(`stairs.preset.${id}`); },
  get hint(): string { return t(`stairs.preset.${id}.hint`); },
});
export const STAIRS_PRESETS: StairsPreset[] = [
  preset('concrete', DEFAULT_STAIRS),
  preset('oak-wall', {
    tread: 'oak', riser: 'white', treadThickness: 0.04, nosing: 0.02,
    handrail: { place: 'outer', height: 0.9, profile: 'round', finish: 'oak' }, balustrade: { type: 'bars', height: 0.9, finish: 'white' } }),
  preset('oak-steel', {
    tread: 'oak', riser: 'none', treadThickness: 0.04, nosing: 0.02,
    handrail: { place: 'both', height: 0.9, profile: 'rect', finish: 'black' }, balustrade: { type: 'bars', height: 0.95, finish: 'black' } }),
  preset('ash-glass', {
    tread: 'ash', riser: 'ash', treadThickness: 0.04, nosing: 0.015,
    handrail: { place: 'outer', height: 0.9, profile: 'round', finish: 'ash' }, balustrade: { type: 'glass', height: 1.0, finish: 'steel' } }),
  preset('walnut-solid', {
    tread: 'walnut', riser: 'walnut', treadThickness: 0.04, nosing: 0.02,
    handrail: { place: 'inner', height: 0.9, profile: 'rect', finish: 'walnut' }, balustrade: { type: 'solid', height: 1.0, finish: 'white' } }),
];

const HEX = /^#[0-9a-f]{6}$/i;
export const isFinish = (x: unknown): x is StairFinish => typeof x === 'string' && (x in STAIR_FINISHES || HEX.test(x));
/** colour and surface properties of a finish */
export function finishLook(f: StairFinish): { name: string; color: string; roughness: number; metalness: number } {
  return f in STAIR_FINISHES ? STAIR_FINISHES[f as StairFinishId] : { name: t('stairs.finish.custom', { color: f }), color: f, roughness: 0.6, metalness: 0 };
}

/** full configuration from a partial record (missing fields — default state) */
export function resolveStairs(p?: DeepPartial<StairsConfig> | null): StairsConfig {
  const d = DEFAULT_STAIRS;
  return {
    tread: p?.tread ?? d.tread, riser: p?.riser ?? d.riser, treadThickness: p?.treadThickness ?? d.treadThickness, nosing: p?.nosing ?? d.nosing,
    handrail: { ...d.handrail, ...(p?.handrail ?? {}) }, balustrade: { ...d.balustrade, ...(p?.balustrade ?? {}) },
  };
}
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const inR = (x: unknown, r: readonly [number, number, number]) => fin(x) && x >= r[0] - 1e-9 && x <= r[1] + 1e-9;

/** validation of a stored record (project document, variant import) */
export function stairsErrors(p: unknown): string[] {
  if (p === undefined || p === null) return [];
  if (typeof p !== 'object') return ['stairs: stair configuration object'];
  const x = p as DeepPartial<StairsConfig>, e: string[] = [], L = STAIR_LIMITS;
  if (x.tread !== undefined && !isFinish(x.tread)) e.push('stairs.tread: palette finish or #rrggbb colour');
  if (x.riser !== undefined && x.riser !== 'none' && !isFinish(x.riser)) e.push('stairs.riser: finish, #rrggbb colour or none');
  if (x.treadThickness !== undefined && !inR(x.treadThickness, L.treadThickness)) e.push('stairs.treadThickness: 0–0.06 m');
  if (x.nosing !== undefined && !inR(x.nosing, L.nosing)) e.push('stairs.nosing: 0–0.04 m');
  const h = x.handrail, b = x.balustrade;
  if (h !== undefined && (typeof h !== 'object' || h === null)) e.push('stairs.handrail: object');
  else if (h) {
    if (h.place !== undefined && !['none', 'outer', 'inner', 'both'].includes(h.place)) e.push('stairs.handrail.place: none | outer | inner | both');
    if (h.height !== undefined && !inR(h.height, L.handrail)) e.push('stairs.handrail.height: 0.80–1.10 m');
    if (h.profile !== undefined && !['round', 'rect'].includes(h.profile)) e.push('stairs.handrail.profile: round | rect');
    if (h.finish !== undefined && !isFinish(h.finish)) e.push('stairs.handrail.finish: finish or #rrggbb colour');
  }
  if (b !== undefined && (typeof b !== 'object' || b === null)) e.push('stairs.balustrade: object');
  else if (b) {
    if (b.type !== undefined && !['none', 'glass', 'bars', 'solid'].includes(b.type)) e.push('stairs.balustrade.type: none | glass | bars | solid');
    if (b.height !== undefined && !inR(b.height, L.balustrade)) e.push('stairs.balustrade.height: 0.90–1.20 m');
    if (b.finish !== undefined && !isFinish(b.finish)) e.push('stairs.balustrade.finish: finish or #rrggbb colour');
  }
  return e;
}

/** short description of the configuration (card, list) */
export function stairsSummary(c: StairsConfig): string {
  const clad = c.treadThickness > 0 ? t('stairs.summary.treads', { finish: finishLook(c.tread).name }) : t('stairs.summary.bare');
  const rail = c.handrail.place === 'none' ? t('stairs.summary.noHandrail') : t('stairs.summary.handrail', { place: t(`stairs.handrail.${c.handrail.place}`) });
  const bal = c.balustrade.type === 'none' ? t('stairs.summary.noBalustrade') : t('stairs.summary.balustrade', { type: t(`stairs.balustrade.${c.balustrade.type}`) });
  return `${clad} · ${rail} · ${bal}`;
}
