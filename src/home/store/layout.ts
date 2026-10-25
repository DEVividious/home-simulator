// UI layout: desktop or phone (the same code, a different panel arrangement). Rule (docs/MOBILE_UX.md):
//  • mobile = window narrower than 760 px OR a touch-only pointer on a low screen (phone in landscape: height ≤ 540 px),
//  • landscape = width > height (phone in landscape: navigation as a vertical rail, context panel on the right),
//  • coarse = the primary pointer is a finger (larger touch targets, touch hints instead of mouse hints).
// ?layout=mobile|desktop forces the layout (tests). Components read useLayout(); CSS — data-layout / data-orient attributes on .hm.
import { createStore, useStore } from './createStore';

export interface Layout { mobile: boolean; landscape: boolean; coarse: boolean }
export const MOBILE_QUERY = '(max-width: 760px), ((pointer: coarse) and (max-height: 540px))';

const mq = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
const forced = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('layout') : null;

export function computeLayout(): Layout {
  const landscape = typeof window !== 'undefined' ? window.innerWidth > window.innerHeight : true;
  const coarse = mq('(pointer: coarse)');
  const mobile = forced === 'mobile' ? true : forced === 'desktop' ? false : mq(MOBILE_QUERY);
  return { mobile, landscape, coarse: coarse || forced === 'mobile' };
}

export const layout = createStore<Layout>(computeLayout());
if (typeof window !== 'undefined') {
  const update = () => { const n = computeLayout(), o = layout.get(); if (n.mobile !== o.mobile || n.landscape !== o.landscape || n.coarse !== o.coarse) layout.set(n); };
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  if (typeof matchMedia === 'function') for (const q of [MOBILE_QUERY, '(pointer: coarse)']) matchMedia(q).addEventListener?.('change', update);
}
export const useLayout = <T,>(sel: (s: Layout) => T) => useStore(layout, sel);
export const isMobile = () => layout.get().mobile;
export const isCoarse = () => layout.get().coarse;
