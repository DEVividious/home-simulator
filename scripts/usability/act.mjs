// One persona action in a usability session (ADR 0045). The persona sees only the screenshot whose path is printed, and acts only
// through these commands; the state, the element under the pointer and the checker's verdict are written to hidden/. The
// session process (session.mjs) owns the browser page — its screen size and touch emulation live as long as it does — and runs
// the command; this script only passes it on.
// Usage: node scripts/usability/act.mjs --session <dir> <command> [args] [--say "what I think"]
//   start                      begin the first task (prints its goal and the first screenshot)
//   click X Y | tap X Y        mouse click / finger tap at a screenshot pixel
//   drag X1 Y1 X2 Y2           press, move, release (mouse or finger)
//   scroll X Y DY              mouse wheel at a point (DY > 0 scrolls down)
//   type "text" | key Enter    keyboard (key combinations as Control+z)
//   hold KEY S | hold X Y S    press and hold a key, or a finger / the mouse button at a point, for S seconds (at most 10)
//   wait                       look again after a moment
//   done | giveup              finish the task (the next task starts by itself)
//   note "text" [--dead-end] [--too-much-text]   something confusing, for the report
//   sus 1,2,3,4,5,1,2,3,4,5    the ten System Usability Scale answers (1 = strongly disagree … 5 = strongly agree)
//   end                        close the session
import { resolve } from 'node:path';
import { ROOT } from '../verify/browser.mjs';
import { readJson, sessionFile } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = (k) => { const i = argv.indexOf(`--${k}`); if (i < 0) return false; argv.splice(i, 1); return true; };
const dir = resolve(ROOT, opt('session') ?? process.env.USABILITY_SESSION ?? '');
const say = opt('say'), deadEnd = flag('dead-end'), tooMuch = flag('too-much-text');
const [cmd, ...args] = argv;
const S = readJson(sessionFile(dir));
if (!S?.control) { console.error(`no running session in ${dir} — start one with scripts/usability/session.mjs`); process.exit(2); }
try {
  const r = await fetch(`http://127.0.0.1:${S.control}/`, { method: 'POST', body: JSON.stringify({ cmd, args, say, deadEnd, tooMuch }), signal: AbortSignal.timeout(300000) });
  const out = await r.json();
  console.log(out.text);
  process.exit(out.ok ? 0 : 2);
} catch (e) {
  console.error(cmd === 'end' ? 'Session closed.' : `the session does not answer (${String(e).slice(0, 120)})`);
  process.exit(cmd === 'end' ? 0 : 2);
}
