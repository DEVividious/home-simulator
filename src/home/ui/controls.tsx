// Home UI controls: segmented switch, slider with a number field (live preview while dragging, commit = one history
// entry), colour picker (one pick = one entry), inline name field (no browser dialogs), thumbnail tiles,
// empty states and hints.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fmtNum, t } from '../../i18n';

/** number for an editable field: no thousands grouping, decimal separator of the UI language (parsing accepts both "," and ".") */
const fieldNum = (x: number, digits: number) => x.toFixed(digits).replace('.', fmtNum(0.5, 1).replace(/\d/g, '') || '.');

export function Seg<T extends string | number>({ value, options, onChange, testid, wide }: {
  value: T; options: [T, ReactNode, string?][]; onChange: (v: T) => void; testid?: string; wide?: boolean;
}) {
  return (
    <div className={`hm-seg${wide ? ' wide' : ''}`} data-testid={testid} role="radiogroup">
      {options.map(([v, label, title]) => (
        <button key={String(v)} className={value === v ? 'on' : ''} role="radio" aria-checked={value === v} title={title} onClick={() => onChange(v)} data-value={String(v)}>{label}</button>
      ))}
    </div>
  );
}

/** slider for a value in metres shown in cm (or another unit, scaled by k) */
export function Slider({ label, value, min, max, step, unit = 'cm', k = 100, digits = 0, onPreview, onCommit, testid, hint }: {
  label: ReactNode; value: number; min: number; max: number; step: number; unit?: string; k?: number; digits?: number;
  onPreview?: (v: number) => void; onCommit: (v: number) => void; testid?: string; hint?: ReactNode;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [txt, setTxt] = useState<string | null>(null);
  const shown = drag ?? value;
  const commit = (v: number) => { setDrag(null); onCommit(Math.min(max, Math.max(min, v))); };
  return (
    <label className="hm-slider" data-testid={testid}>
      <span className="hm-slider-top">
        <span>{label}</span>
        <span className="hm-num">
          <input value={txt ?? fieldNum(shown * k, digits)} inputMode="decimal" data-testid={testid ? `${testid}-num` : undefined}
            onFocus={(e) => e.target.select()} onChange={(e) => setTxt(e.target.value)}
            onBlur={() => { if (txt !== null) { const v = Number(txt.replace(',', '.')) / k; if (Number.isFinite(v)) commit(v); setTxt(null); } }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTxt(null); (e.target as HTMLInputElement).blur(); } }} />
          <i>{unit}</i>
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={shown}
        onChange={(e) => { const v = Number(e.target.value); setDrag(v); onPreview?.(v); }}
        onPointerUp={() => { if (drag !== null) commit(drag); }} onKeyUp={() => { if (drag !== null) commit(drag); }} onBlur={() => { if (drag !== null) commit(drag); }} />
      {hint && <span className="hm-hint">{hint}</span>}
    </label>
  );
}

export interface Swatch { hex: string; name: string }

/** paint swatch whose name is translated on read (never at module load) */
const paint = (hex: string, key: string): Swatch => ({ hex, get name() { return t(`controls.paint.${key}`); } });

/** interior paint palette (descriptive names; any colour via the picker) */
export const PAINT_COLORS: Swatch[] = [
  paint('#f4f1ea', 'warmWhite'), paint('#ffffff', 'white'), paint('#e9e6df', 'ivory'), paint('#d9d4ca', 'sandBeige'),
  paint('#c9c2b6', 'greige'), paint('#b7b4ad', 'lightGrey'), paint('#8d9096', 'lightGraphite'), paint('#4b4f55', 'anthracite'),
  paint('#c7d1c0', 'lightSage'), paint('#9aa88f', 'sage'), paint('#6f7d62', 'olive'), paint('#3e5a4e', 'bottleGreen'),
  paint('#c9d6e3', 'mistyBlue'), paint('#7f98b2', 'greyBlue'), paint('#2f4157', 'navy'), paint('#e3c9bd', 'powderPink'),
  paint('#c98b6b', 'lightTerracotta'), paint('#a4664a', 'terracotta'), paint('#e6cf9c', 'lightMustard'), paint('#c79a3c', 'mustard'),
];

/** user-facing finish name: paint in a palette colour → colour name, another colour → "custom colour", otherwise the material name */
export function finishLabel(materialName: string | null | undefined, color: string | null | undefined): string {
  if (color) {
    const named = PAINT_COLORS.find((c) => c.hex.toLowerCase() === color.toLowerCase());
    return named ? t('controls.paintNamed', { name: named.name }) : t('controls.paintCustom');
  }
  return materialName ?? '';
}

/**
 * Colour picker (<input type="color">). The native "input" event fires on every move in the colour dialog, "change" — once, when
 * it closes; React's onChange is the native "input". Saving on onChange produced a dozen history entries per colour pick and
 * pushed all "recent colours" out with intermediate shades. Here — as with the slider: onPreview on every move (preview, no
 * history), onCommit ONCE, when the dialog closes. During the pick the field shows the current colour (local state) — also when
 * the caller does no preview.
 */
export function ColorInput({ value, onPreview, onCommit, testid }: { value: string; onPreview?: (hex: string) => void; onCommit: (hex: string) => void; testid?: string }) {
  const [live, setLive] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null), latest = useRef(onCommit);
  // the commit belongs to the element the pick STARTED for: the panel may switch to another element meanwhile (a click in the scene closes the dialog)
  const session = useRef<{ commit: (hex: string) => void; hex: string } | null>(null), finish = useRef(() => {});
  latest.current = onCommit;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const done = () => { const s = session.current; session.current = null; setLive(null); (s?.commit ?? latest.current)(el.value); };
    // dialog closed WITHOUT "change" (colour returned to the original): the preview must not stay open — it would hold autosave
    // until the next change. The field loses focus only after the dialog closes, so an ongoing pick ends with a commit then.
    finish.current = () => { if (session.current) done(); };
    el.addEventListener('change', done);
    // the field unmounts during a pick (no "change"): what the user saw is kept — like a slider released outside the field
    return () => { el.removeEventListener('change', done); const s = session.current; session.current = null; if (s) s.commit(s.hex); };
  }, []);
  return (
    <input ref={ref} type="color" value={live ?? value} data-testid={testid} onBlur={() => finish.current()}
      onChange={(e) => {
        if (e.nativeEvent.type === 'change') return;                       // dialog closed without a prior "input" — handled by the listener above
        const hex = e.target.value;
        session.current = { commit: session.current?.commit ?? onCommit, hex };
        setLive(hex); onPreview?.(hex);
      }} />
  );
}

export function Swatches({ value, colors, onChange, onPreview, testid, allowCustom = true, recent = [] }: {
  value: string | null | undefined; colors: Swatch[]; onChange: (hex: string, name: string) => void; testid?: string; allowCustom?: boolean; recent?: string[];
  /** colour preview while picking (no history entry); onChange arrives once, after the picker dialog closes */
  onPreview?: (hex: string) => void;
}) {
  const v = (value ?? '').toLowerCase();
  const extra = recent.filter((r) => !colors.some((c) => c.hex.toLowerCase() === r.toLowerCase())).slice(0, 4);
  return (
    <div className="hm-swatches" data-testid={testid}>
      {colors.map((c) => (
        <button key={c.hex} className={`hm-sw${v === c.hex.toLowerCase() ? ' on' : ''}`} style={{ background: c.hex }} title={c.name} aria-label={c.name} onClick={() => onChange(c.hex, c.name)} data-hex={c.hex} />
      ))}
      {extra.map((hex) => <button key={hex} className={`hm-sw${v === hex.toLowerCase() ? ' on' : ''}`} style={{ background: hex }} title={t('controls.recentColor', { hex })} onClick={() => onChange(hex, hex)} data-hex={hex} />)}
      {allowCustom && (
        <label className="hm-sw hm-sw-custom" title={t('controls.anyColor')}>
          <ColorInput value={/^#[0-9a-f]{6}$/i.test(v) ? v : '#ffffff'} onPreview={onPreview} onCommit={(hex) => onChange(hex, hex)} testid={testid ? `${testid}-custom` : undefined} />
          <span>+</span>
        </label>
      )}
    </div>
  );
}

/** inline name field (Enter — confirm, Esc — cancel) */
export function NameInput({ initial = '', placeholder, button, onSubmit, onCancel, testid }: {
  initial?: string; placeholder?: string; button?: string; onSubmit: (name: string) => void; onCancel?: () => void; testid?: string;
}) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const ok = () => { if (v.trim()) onSubmit(v.trim()); };
  return (
    <div className="hm-name">
      <input ref={ref} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} data-testid={testid}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') ok(); if (e.key === 'Escape') onCancel?.(); }} />
      <button className="hm-btn primary" onClick={ok} disabled={!v.trim()} data-testid={testid ? `${testid}-ok` : undefined}>{button ?? t('controls.save')}</button>
      {onCancel && <button className="hm-btn ghost" onClick={onCancel}>{t('controls.cancel')}</button>}
    </div>
  );
}

export function Tile({ img, title, sub, active, onClick, onPointerDown, testid, badge, draggable }: {
  img?: string; title: ReactNode; sub?: ReactNode; active?: boolean; onClick?: () => void; onPointerDown?: (e: React.PointerEvent) => void;
  testid?: string; badge?: ReactNode; draggable?: boolean;
}) {
  return (
    <button className={`hm-tile${active ? ' on' : ''}${draggable ? ' drag' : ''}`} onClick={onClick} onPointerDown={onPointerDown} data-testid={testid} title={typeof title === 'string' ? title : undefined}>
      {img && <span className="hm-tile-img"><img src={img} alt="" draggable={false} /></span>}
      <span className="hm-tile-txt"><b>{title}</b>{sub && <small>{sub}</small>}</span>
      {badge && <span className="hm-tile-badge">{badge}</span>}
    </button>
  );
}

export function Empty({ icon, title, children, testid }: { icon: ReactNode; title: ReactNode; children?: ReactNode; testid?: string }) {
  return (
    <div className="hm-empty" data-testid={testid}>
      <div className="hm-empty-icon">{icon}</div>
      <b>{title}</b>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Block({ title, right, children, testid }: { title?: ReactNode; right?: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <section className="hm-block" data-testid={testid}>
      {(title || right) && <header><h3>{title}</h3>{right}</header>}
      {children}
    </section>
  );
}

export function Toggle({ on, label, onChange, testid, hint }: { on: boolean; label: ReactNode; onChange: (v: boolean) => void; testid?: string; hint?: ReactNode }) {
  return (
    <label className="hm-toggle" data-testid={testid}>
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden />
    </label>
  );
}
