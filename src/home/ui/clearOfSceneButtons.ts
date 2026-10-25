// Bars above the scene (walk bar, context hint) versus the buttons in the top-right corner of the scene (sun, doors).
import { useLayoutEffect, type RefObject } from 'react';

/**
 * The bar and the buttons sit above the scene independently, and the buttons' width depends on their content and layout — so the
 * room for the bar is MEASURED, not guessed: the bar keeps its stylesheet position while it fits; when it would reach under the
 * buttons (scene narrowed by the selection's property panel, narrow phone), it ends before them — narrowed, and when centred
 * also shifted left (the `--hm-clear-shift` variable in the stylesheet transform).
 */
export function useClearOfSceneButtons(ref: RefObject<HTMLDivElement | null>, key: unknown) {
  useLayoutEffect(() => {
    const el = ref.current, stage = el?.closest<HTMLElement>('.hm-stage');
    if (!el || !stage || typeof ResizeObserver === 'undefined') return;
    const GAP = 10, EDGE = 16;                                                 // gap to the buttons and to the scene edge [px]
    const fit = () => {
      el.style.maxWidth = ''; el.style.removeProperty('--hm-clear-shift');     // initial layout (stylesheet)
      const bar = stage.querySelector('.hm-sun-bar')?.getBoundingClientRect();
      let r = el.getBoundingClientRect();
      if (!bar || bar.width === 0 || r.bottom <= bar.top || r.top >= bar.bottom || r.right <= bar.left - GAP) return;   // another row, or it fits
      const limit = bar.left - GAP, centred = getComputedStyle(el).transform !== 'none';                                // touch: bar starts at the left edge
      el.style.maxWidth = `${Math.max(96, Math.floor(limit - (centred ? stage.getBoundingClientRect().left + EDGE : r.left)))}px`;
      if (!centred) return;
      r = el.getBoundingClientRect();
      if (r.right > limit) el.style.setProperty('--hm-clear-shift', `${Math.floor(limit - r.right)}px`);
    };
    fit();
    const ro = new ResizeObserver(fit), bar = stage.querySelector('.hm-sun-bar');
    ro.observe(stage); ro.observe(el); if (bar) ro.observe(bar);
    return () => ro.disconnect();
  }, [ref, key]);
}
