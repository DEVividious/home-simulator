// Printer beds (ADR 0032): the table the print export and the plugin look a printer up in, by a phrase ("k1c", "bambu a1
// mini") or as a size ("220x220", "220x220x250"). The build volume is X × Y × Z in mm. The plugin's references/printers.md is
// generated from this table (same rows), so an agent can read it and the command finds the same printer.

export interface Printer { maker: string; model: string; x: number; y: number; z: number; note?: string }

export const PRINTERS: readonly Printer[] = [
  { maker: 'Creality', model: 'K1', x: 220, y: 220, z: 250 },
  { maker: 'Creality', model: 'K1C', x: 220, y: 220, z: 250 },
  { maker: 'Creality', model: 'K1 SE', x: 220, y: 220, z: 250 },
  { maker: 'Creality', model: 'K1 Max', x: 300, y: 300, z: 300 },
  { maker: 'Creality', model: 'K2 Plus', x: 350, y: 350, z: 350 },
  { maker: 'Creality', model: 'Ender-3', x: 220, y: 220, z: 250, note: 'also Pro, V2, Neo' },
  { maker: 'Creality', model: 'Ender-3 V2', x: 220, y: 220, z: 250 },
  { maker: 'Creality', model: 'Ender-3 V3 SE', x: 220, y: 220, z: 250 },
  { maker: 'Creality', model: 'Ender-3 V3 KE', x: 220, y: 220, z: 240 },
  { maker: 'Creality', model: 'Ender-3 V3', x: 220, y: 220, z: 250 },
  { maker: 'Creality', model: 'Ender-3 S1', x: 220, y: 220, z: 270, note: 'also S1 Pro' },
  { maker: 'Creality', model: 'Ender-3 Max', x: 300, y: 300, z: 340 },
  { maker: 'Creality', model: 'Ender-5', x: 220, y: 220, z: 300, note: 'also Pro' },
  { maker: 'Creality', model: 'Ender-5 S1', x: 220, y: 220, z: 280 },
  { maker: 'Creality', model: 'Ender-5 Plus', x: 350, y: 350, z: 400 },
  { maker: 'Creality', model: 'CR-10', x: 300, y: 300, z: 400, note: 'also V2, V3, Smart' },
  { maker: 'Creality', model: 'CR-10 SE', x: 220, y: 220, z: 265 },
  { maker: 'Creality', model: 'Hi', x: 260, y: 260, z: 300 },
  { maker: 'Bambu Lab', model: 'A1 mini', x: 180, y: 180, z: 180 },
  { maker: 'Bambu Lab', model: 'A1', x: 256, y: 256, z: 256 },
  { maker: 'Bambu Lab', model: 'P1P', x: 256, y: 256, z: 256 },
  { maker: 'Bambu Lab', model: 'P1S', x: 256, y: 256, z: 256 },
  { maker: 'Bambu Lab', model: 'P2S', x: 256, y: 256, z: 256 },
  { maker: 'Bambu Lab', model: 'X1C', x: 256, y: 256, z: 256, note: 'also X1, X1E' },
  { maker: 'Bambu Lab', model: 'H2D', x: 350, y: 320, z: 325, note: 'less in X with two nozzles' },
  { maker: 'Bambu Lab', model: 'H2S', x: 340, y: 320, z: 325 },
  { maker: 'Prusa', model: 'MINI', x: 180, y: 180, z: 180, note: 'also MINI+' },
  { maker: 'Prusa', model: 'MK3S', x: 250, y: 210, z: 210, note: 'also MK3S+' },
  { maker: 'Prusa', model: 'MK4', x: 250, y: 210, z: 220, note: 'also MK4S, MK3.5' },
  { maker: 'Prusa', model: 'Core One', x: 250, y: 220, z: 270 },
  { maker: 'Prusa', model: 'XL', x: 360, y: 360, z: 360 },
  { maker: 'Anycubic', model: 'Kobra 2', x: 220, y: 220, z: 250, note: 'also Kobra 2 Neo' },
  { maker: 'Anycubic', model: 'Kobra 2 Pro', x: 220, y: 220, z: 250 },
  { maker: 'Anycubic', model: 'Kobra 2 Max', x: 420, y: 420, z: 500 },
  { maker: 'Anycubic', model: 'Kobra 3', x: 250, y: 220, z: 260, note: 'also Kobra 3 Combo' },
  { maker: 'Anycubic', model: 'Kobra S1', x: 250, y: 250, z: 250 },
  { maker: 'Anycubic', model: 'Kobra 3 Max', x: 420, y: 420, z: 500 },
  { maker: 'Anycubic', model: 'Vyper', x: 245, y: 245, z: 260 },
  { maker: 'Anycubic', model: 'i3 Mega', x: 210, y: 210, z: 205 },
  { maker: 'Elegoo', model: 'Neptune 3', x: 220, y: 220, z: 280 },
  { maker: 'Elegoo', model: 'Neptune 3 Pro', x: 225, y: 225, z: 280 },
  { maker: 'Elegoo', model: 'Neptune 4', x: 225, y: 225, z: 265, note: 'also Neptune 4 Pro' },
  { maker: 'Elegoo', model: 'Neptune 4 Plus', x: 320, y: 320, z: 385 },
  { maker: 'Elegoo', model: 'Neptune 4 Max', x: 420, y: 420, z: 480 },
  { maker: 'Elegoo', model: 'Centauri Carbon', x: 256, y: 256, z: 256, note: 'also Centauri' },
  { maker: 'Flashforge', model: 'Adventurer 5M', x: 220, y: 220, z: 220, note: 'also 5M Pro' },
  { maker: 'Flashforge', model: 'AD5X', x: 220, y: 220, z: 220 },
  { maker: 'Flashforge', model: 'Adventurer 3', x: 150, y: 150, z: 150 },
  { maker: 'Qidi', model: 'Q1 Pro', x: 245, y: 245, z: 240 },
  { maker: 'Qidi', model: 'Plus 4', x: 305, y: 305, z: 280 },
  { maker: 'Qidi', model: 'X-Plus 3', x: 280, y: 280, z: 270 },
  { maker: 'Qidi', model: 'X-Max 3', x: 325, y: 325, z: 315 },
  { maker: 'Sovol', model: 'SV06', x: 220, y: 220, z: 250, note: 'also SV06 Plus: 300 × 300 × 340' },
  { maker: 'Sovol', model: 'SV07', x: 220, y: 220, z: 250 },
  { maker: 'Sovol', model: 'SV08', x: 350, y: 350, z: 345 },
  { maker: 'Artillery', model: 'Sidewinder X2', x: 300, y: 300, z: 400, note: 'also X1, X3' },
  { maker: 'Artillery', model: 'Genius', x: 220, y: 220, z: 250, note: 'also Genius Pro' },
  { maker: 'AnkerMake', model: 'M5', x: 235, y: 235, z: 250, note: 'also M5C' },
  { maker: 'Voron', model: '2.4 250', x: 250, y: 250, z: 250 },
  { maker: 'Voron', model: '2.4 300', x: 300, y: 300, z: 300 },
  { maker: 'Voron', model: '2.4 350', x: 350, y: 350, z: 350 },
  { maker: 'Voron', model: '0.2', x: 120, y: 120, z: 120 },
  { maker: 'Kingroon', model: 'KP3S', x: 180, y: 180, z: 180 },
  { maker: 'Snapmaker', model: 'A350', x: 320, y: 350, z: 330 },
  { maker: 'Ultimaker', model: 'S5', x: 330, y: 240, z: 300 },
  { maker: 'Ultimaker', model: '2+', x: 223, y: 223, z: 205 },
  { maker: 'Toybox', model: 'Toybox', x: 70, y: 80, z: 90 },
];

/** a print bed: its size [mm] (height null — not given, not limited) and the printer it belongs to */
export interface Bed { name: string | null; x: number; y: number; z: number | null }

const norm = (s: string) => s.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
export const printerName = (p: Printer): string => `${p.maker} ${p.model}`;

/** printers whose maker and model contain every word of the phrase; a model named exactly by the phrase wins */
export function findPrinters(phrase: string): Printer[] {
  const words = norm(phrase).split(' ').filter(Boolean);
  if (!words.length) return [];
  const found = PRINTERS.filter((p) => { const text = norm(printerName(p)); return words.every((w) => text.includes(w)); });
  const exact = found.filter((p) => norm(p.model) === norm(phrase) || norm(printerName(p)) === norm(phrase));
  return exact.length === 1 ? exact : found;
}

/** a bed from "WxD", "WxDxH" (mm; × accepted) or a printer phrase; throws with the candidates when the phrase is ambiguous or unknown */
export function parseBed(text: string): Bed {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?\s*(?:mm)?\s*$/i.exec(text);
  if (m) {
    const bed: Bed = { name: null, x: Number(m[1]), y: Number(m[2]), z: m[3] ? Number(m[3]) : null };
    if (!(bed.x > 0 && bed.y > 0 && (bed.z === null || bed.z > 0))) throw new Error(`bed size must be positive: ${text}`);
    return bed;
  }
  const found = findPrinters(text);
  if (found.length === 1) return { name: printerName(found[0]), x: found[0].x, y: found[0].y, z: found[0].z };
  if (found.length > 1) throw new Error(`printer "${text}" is ambiguous: ${found.slice(0, 8).map(printerName).join(', ')}${found.length > 8 ? ', …' : ''}`);
  throw new Error(`unknown printer "${text}"; give the bed size as WIDTHxDEPTH or WIDTHxDEPTHxHEIGHT in mm, e.g. 220x220x250`);
}
