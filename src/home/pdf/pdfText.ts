// TEXT IN PDF: jsPDF silently drops a character the embedded font does not have ("resistance 10 kΩ" came out as
// "resistance 10 k"). Every text drawn in the PDF goes through pdfSafe(): a character in the font stays, a known one gets a
// readable spelling (Ω → Ohm), any other becomes "?" — and the export reports how many characters were replaced. The character
// set is NOT a hand-written list: it comes from the cmap table of the TTF file embedded in the document (DejaVu Sans subset).
// Pure TS — no jsPDF and no browser.
import { t } from '../../i18n';

/** code points for which a TrueType font has a glyph (cmap table, format 4 and 12 subtables) */
export function fontCodePoints(ttf: Uint8Array): Set<number> {
  const v = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength), out = new Set<number>();
  let cmap = -1;
  for (let i = 0, n = v.getUint16(4); i < n; i++) if (v.getUint32(12 + 16 * i) === 0x636d6170) cmap = v.getUint32(12 + 16 * i + 8);     // 'cmap'
  if (cmap < 0) return out;
  for (let i = 0, n = v.getUint16(cmap + 2); i < n; i++) {
    const so = cmap + v.getUint32(cmap + 8 + 8 * i), format = v.getUint16(so);
    if (format === 4) {
      const seg = v.getUint16(so + 6) / 2, ends = so + 14, starts = ends + 2 * seg + 2, deltas = starts + 2 * seg, ranges = deltas + 2 * seg;
      for (let k = 0; k < seg; k++) {
        const end = v.getUint16(ends + 2 * k), start = v.getUint16(starts + 2 * k), delta = v.getInt16(deltas + 2 * k), ro = v.getUint16(ranges + 2 * k);
        for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
          let g = ro === 0 ? cp + delta : v.getUint16(ranges + 2 * k + ro + 2 * (cp - start));
          if (ro !== 0 && g) g += delta;
          if (g & 0xffff) out.add(cp);
        }
      }
    } else if (format === 12) {
      for (let k = 0, n12 = v.getUint32(so + 12); k < n12; k++) for (let cp = v.getUint32(so + 16 + 12 * k), end = v.getUint32(so + 20 + 12 * k); cp <= end; cp++) out.add(cp);
    }
  }
  return out;
}
/** font from its base64 form (as passed to jsPDF) → bytes */
export const base64Bytes = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * Readable spellings of characters the font subset lacks but which occur in installation descriptions: units and Greek
 * letters, "checked / warning" signs, sub- and superscripts, arrows, dash and diameter variants. Every spelling consists of
 * font characters (tested).
 */
export const PDF_CHAR_MAP: Record<string, string> = {
  'Ω': 'Ohm', 'Ω': 'Ohm', 'μ': 'µ', '≈': '~', '≅': '~', '∼': '~', '≠': '=/=', '€': 'EUR', '℃': '°C', '∅': '⌀', '№': 'No.',
  '✓': 'OK', '✔': 'OK', '☑': 'OK', '✗': 'x', '✘': 'x', '⚠': '(!)',
  'Δ': 'delta', '∆': 'delta', 'δ': 'delta', 'φ': 'phi', 'ϕ': 'phi', 'Φ': 'phi', 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'ε': 'epsilon', 'η': 'eta', 'θ': 'theta', 'λ': 'lambda', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'Σ': 'sum', '∑': 'sum', 'τ': 'tau', 'ω': 'omega',
  '⇒': '→', '➜': '→', '➔': '→', '➡': '→', '⇐': '←', '⇔': '↔', '●': '•', '◦': '•', '▪': '•', '■': '•', '∙': '·', '⋅': '·',
  '‐': '-', '‑': '-', '‒': '–', '―': '—', '′': "'", '″': '"', '‹': '<', '›': '>',
  ...Object.fromEntries([...'₀₁₂₃₄₅₆₇₈₉'].map((c, i) => [c, String(i)])), ...Object.fromEntries([...'⁰⁴⁵⁶⁷⁸⁹'].map((c, i) => [c, String(i ? i + 3 : 0)])),
};
/** spaces and invisible characters: a plain space or nothing — tidied without reporting (not a "replaced character"); null — visible character */
function blank(cp: number): string | null {
  if (cp === 9 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x202f || cp === 0x205f || cp === 0x3000 || cp === 0x2028 || cp === 0x2029) return ' ';
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0) || (cp >= 0x200b && cp <= 0x200f) || cp === 0x2060 || cp === 0xfeff || (cp >= 0xfe00 && cp <= 0xfe0f)) return '';
  return null;
}

export interface PdfSafe { text: string; /** replaced visible characters: [character in the text, spelling in the PDF] — in order of occurrence */ replaced: [string, string][] }
/**
 * Text ready to be drawn with a font whose character set is `has`: font characters (and line breaks) unchanged, known ones —
 * spelling from PDF_CHAR_MAP, the rest — "?". A letter with a separate combining accent is first composed into one (NFC). The
 * result contains font characters only, so calling it again changes nothing.
 */
export function pdfSafe(text: string, has: (cp: number) => boolean): PdfSafe {
  let out = '';
  const replaced: [string, string][] = [];
  for (const ch of text.normalize('NFC')) {
    const cp = ch.codePointAt(0)!;
    if (cp === 10 || has(cp)) { out += ch; continue; }
    const b = blank(cp);
    if (b !== null) { out += b; continue; }
    const to = PDF_CHAR_MAP[ch] ?? '?';
    out += to; replaced.push([ch, to]);
  }
  return { text: out, replaced };
}

export interface PdfReplaced { /** number of replaced characters in the document texts */ count: number; /** distinct replaced characters with their spelling */ chars: [string, string][] }
/** report for the user: how many characters in the given texts will be replaced, and which */
export function pdfReplaced(texts: string[], has: (cp: number) => boolean): PdfReplaced {
  const seen = new Map<string, string>();
  let count = 0;
  for (const s of texts) for (const [from, to] of pdfSafe(s, has).replaced) { count++; if (!seen.has(from)) seen.set(from, to); }
  return { count, chars: [...seen] };
}
/** "1 character", "3 characters", "5 characters" (the dictionaries hold the one / few / many forms) */
const charCount = (n: number) => t(n === 1 ? 'pdf.charsOne' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'pdf.charsFew' : 'pdf.charsMany', { n });
/** sentence for the user after an export; '' — nothing was replaced */
export const replacedText = (r: PdfReplaced, max = 6): string =>
  (r.count ? t('pdf.replacedChars', { count: charCount(r.count), list: r.chars.slice(0, max).map(([a, b]) => `${a} → ${b}`).join(', '), more: r.chars.length > max ? ' …' : '' }) : '');
