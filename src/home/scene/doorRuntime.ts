// Transient door state in the scene (outside React): the animated opening amount (diagnostics, tests) and the passage span of
// exterior doors opened in walk mode (per the current variant). A separate module — no circular dependency actions ↔ scene layers.
import type { Vec2 } from '../model/types';

/** current (animated) door opening amount — window.__home3d.doors() */
export const doorMotion: { angle: Record<string, number> } = { angle: {} };
/** passage span [point, point] (LCS) of entrance doors and lift-and-slide doors */
export const exteriorSpans: { current: Record<string, [Vec2, Vec2]> } = { current: {} };
