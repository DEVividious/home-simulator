// DEVICE CATALOG of the electrical / smart home planner (the user-facing layer over point types).
// Device = definition: consumer name, catalog category, icon, mounting type, default height, quick heights,
// allowed surfaces, 3D look, plan symbol and capabilities — ready for a future Smart Home Planner.
// The placement engine (model/elPlacement.ts) and the UI read ONLY these definitions: a new wall device (thermostat,
// blind controller, touch panel…) is a new entry here + a point type, with no changes to the engine or the UI.
// Point data (ElPoint) is unchanged — the catalog stores nothing in the project. Pure TS.
// Names are getters, translated in the current UI language.
import { t } from '../../i18n';
import { EL_TYPES, type ElType } from './electrical';

export type DeviceCategory = 'sockets' | 'lighting' | 'control' | 'smart' | 'data' | 'sensors';
/** mounting type; the placement engine currently supports WALL and CEILING (plan point), the others are reserved */
export type MountType = 'WALL' | 'CEILING' | 'FLOOR' | 'FREE';
export type DeviceSurface = 'wall' | 'facade' | 'ceiling' | 'floor' | 'site';
/** device capabilities — today descriptive (catalog filter, hints), in future smart home linking rules */
export type Capability = 'power' | 'switching' | 'dimming' | 'lighting' | 'network' | 'bus' | 'sensing' | 'security' | 'video' | 'charging' | 'distribution';

export interface HeightPreset { label: string; height: number }
export interface DeviceDef {
  id: ElType;
  /** UI name ("Double socket") and short name (bar, badge) */
  name: string;
  short: string;
  category: DeviceCategory;
  icon: string;
  mountType: MountType;
  /** axis height above the finished floor [m] — a starting point; the user may enter any value */
  defaultHeight: number;
  /** quick heights (suggestions, not installation requirements) */
  heightPresets: HeightPreset[];
  allowedSurfaces: DeviceSurface[];
  /** the 3D look (three/electricalGeometry.ts) and the plan symbol (plan/elPlan.ts) are chosen by point type */
  visualRepresentation: 'device' | 'board';
  planSymbol: 'socket' | 'switch' | 'light' | 'data' | 'smart' | 'sensor' | 'board';
  capabilities: Capability[];
  /** width taken on the wall [m] — collisions with other devices and edge clearance */
  footprint: number;
}

const category = (id: DeviceCategory, icon: string): { id: DeviceCategory; name: string; icon: string } => ({ id, icon, get name(): string { return t(`devices.category.${id}`); } });
export const DEVICE_CATEGORIES: { id: DeviceCategory; name: string; icon: string }[] = [
  category('sockets', 'plug'),
  category('lighting', 'bulb'),
  category('control', 'switch'),
  category('smart', 'chip'),
  category('data', 'wifi'),
  category('sensors', 'sensor'),
];

const cm = (h: number) => `${Math.round(h * 100)} cm`;
const presets = (...hs: (number | HeightPreset)[]): HeightPreset[] => hs.map((h) => (typeof h === 'number' ? { label: cm(h), height: h } : h));
const WALL: DeviceSurface[] = ['wall', 'facade'], CEIL: DeviceSurface[] = ['ceiling', 'site'];
const SOCKET_H = presets(0.3, 1.1, 1.2, { get label(): string { return t('devices.height.aboveWorktop'); }, height: 1.15 });

type Row = [ElType, DeviceCategory, string, HeightPreset[], Capability[], DeviceDef['planSymbol']];
const ROWS: Row[] = [
  ['socket-1', 'sockets', 'plug', SOCKET_H, ['power'], 'socket'],
  ['socket-2', 'sockets', 'plug', SOCKET_H, ['power'], 'socket'],
  ['socket-3', 'sockets', 'plug', SOCKET_H, ['power'], 'socket'],
  ['socket-ext', 'sockets', 'plug', presets(0.3, 0.4, 1.1), ['power'], 'socket'],
  ['power3f', 'sockets', 'plug', presets(0.3, 0.5, 1.1), ['power'], 'socket'],
  ['ev', 'sockets', 'plug', presets(1.0, 1.2, 1.4), ['power', 'charging'], 'socket'],
  ['board', 'sockets', 'grid', presets(1.2, 1.4, 1.6), ['distribution'], 'board'],
  ['light', 'lighting', 'bulb', [], ['lighting', 'switching'], 'light'],
  ['switch', 'control', 'switch', presets(0.9, 1.1, 1.2, 1.4), ['switching'], 'switch'],
  ['keypad', 'control', 'switch', presets(1.1, 1.4, 1.5), ['bus', 'security'], 'smart'],
  ['bus', 'smart', 'chip', presets(0.3, 1.1, 1.4), ['bus'], 'smart'],
  ['ceiling-smart', 'smart', 'chip', [], ['bus'], 'smart'],
  ['rj45', 'data', 'wifi', presets(0.3, 1.1), ['network'], 'data'],
  ['tv', 'data', 'wifi', presets(0.3, 1.1, 1.3), ['network'], 'data'],
  ['wifi', 'data', 'wifi', [], ['network'], 'data'],
  ['motion', 'sensors', 'sensor', [], ['sensing'], 'sensor'],
  ['temp', 'sensors', 'sensor', presets(1.1, 1.5), ['sensing'], 'sensor'],
  ['camera', 'sensors', 'sensor', presets(2.2, 2.4, 2.6), ['video', 'network', 'security'], 'sensor'],
  ['contact', 'sensors', 'sensor', presets(1.0, 2.0), ['sensing', 'security'], 'sensor'],
];

export const DEVICES = Object.fromEntries(ROWS.map(([id, category, icon, heightPresets, capabilities, planSymbol]): [ElType, DeviceDef] => {
  const et = EL_TYPES[id], ceiling = et.mount === 'ceiling';
  return [id, {
    id, category, icon, mountType: ceiling ? 'CEILING' : 'WALL', defaultHeight: et.height, heightPresets, allowedSurfaces: ceiling ? CEIL : WALL,
    visualRepresentation: id === 'board' ? 'board' : 'device', planSymbol, capabilities, footprint: id === 'board' ? 0.6 : Math.max(0.085, et.modules * 0.071 + 0.014),
    get name(): string { return t(`devices.${id}`); },
    get short(): string { return t(`devices.${id}.short`); },
  }];
})) as Record<ElType, DeviceDef>;

export const deviceOf = (t: ElType): DeviceDef => DEVICES[t];
/** devices of a category in catalog order */
export const devicesIn = (c: DeviceCategory): DeviceDef[] => ROWS.filter((r) => r[1] === c).map((r) => DEVICES[r[0]]);
export const isWallDevice = (t: ElType) => DEVICES[t].mountType === 'WALL';
/** height as shown to the user: "30 cm" */
export const heightText = (h: number) => cm(h);

export type { SmartLinks } from './electrical';
