// Mobile layout: the order in which the system "Back" button closes things (backNav.ts), the layout rule (layout.ts), the
// camera near plane against depth precision and thinning of trees between the camera and the building (seeThrough.ts).
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backStep } from '../backNav';
import { cameraNear, depthResolution } from '../scene/sceneMode';
import { MOBILE_QUERY } from '../store/layout';
import { SEE_THROUGH, seeThroughKeep } from '../three/seeThrough';
import { ui } from '../store/ui';

describe('system Back on a phone', () => {
  const ui0 = ui.get();
  beforeEach(() => ui.set({ section: 'look', settingsOpen: false, onboardingDone: true, menu: null, sheet: 'collapsed', selection: null, compare: null, roomId: null, roomView: '3d', houseView: 'exterior', level: 'L1' }));
  afterEach(() => ui.set(ui0));
  const snap = () => { const s = ui.get(); return `${s.settingsOpen ? 'dialog' : '-'}/${s.sheet}/${s.selection ? s.selection.kind : '-'}/${s.roomId ?? '-'}/${s.roomView}/${s.houseView}`; };

  it('nothing to close → false (Back leaves the app)', () => {
    expect(backStep(true)).toBe(false);
    expect(backStep()).toBe(false);
  });
  it('order: dialog → expanded sheet → selection → sheet → room walk → room → level section', () => {
    ui.set({ settingsOpen: true, sheet: 'expanded', selection: { kind: 'floor', roomId: 'R1' }, roomId: 'R1', roomView: 'walk', houseView: 'interior' });
    const seq = [snap()];
    while (backStep()) seq.push(snap());
    expect(seq).toEqual([
      'dialog/expanded/floor/R1/walk/interior',
      '-/expanded/floor/R1/walk/interior',
      '-/medium/floor/R1/walk/interior',
      '-/medium/-/R1/walk/interior',
      '-/collapsed/-/R1/walk/interior',
      '-/collapsed/-/R1/3d/interior',
      '-/collapsed/-/-/3d/interior',
      '-/collapsed/-/-/3d/exterior',
    ]);
  });
  it('the welcome screen and an A/B comparison are closed before leaving the room', () => {
    ui.set({ onboardingDone: false, compare: { kind: 'variants', a: 'a', b: 'b' }, roomId: 'R1', houseView: 'interior' });
    expect(backStep()).toBe(true); expect(ui.get().onboardingDone).toBe(true);
    expect(backStep()).toBe(true); expect(ui.get().compare).toBeNull();
    expect(ui.get().roomId).toBe('R1');
  });
  it('a dry run changes nothing', () => {
    ui.set({ selection: { kind: 'floor', roomId: 'R1' }, roomId: 'R1' });
    const before = snap();
    expect(backStep(true)).toBe(true);
    expect(snap()).toBe(before);
  });
  it('a walk through the home ends before leaving the app', () => {
    ui.set({ houseView: 'walk' });
    expect(backStep()).toBe(true);
    expect(ui.get().houseView).toBe('exterior');
    expect(backStep()).toBe(false);
  });
  it('Electrical mode: selection, then leaving the mode to the first section', () => {
    ui.set({ section: 'electrical', selection: { kind: 'electrical', id: 'S1' } });
    expect(backStep()).toBe(true); expect(ui.get().selection).toBeNull();
    expect(backStep()).toBe(true); expect(ui.get().section).toBe('look');
  });
  it('mobile layout rule: a narrow window or a phone in landscape (coarse pointer, low screen)', () => {
    expect(MOBILE_QUERY).toBe('(max-width: 760px), ((pointer: coarse) and (max-height: 540px))');
  });
});

// floors and walls "flickered" when zooming out of a section on a phone (finishes 3 mm in front of the slab / wall, a fixed
// 0.1 m near plane)
describe('camera near plane and depth precision', () => {
  const OFFSET = 0.003;                                                     // SURFACE_OFFSET (three/surfaces.ts — a three.js module)
  it('close up the mode base value stays', () => {
    expect(cameraNear(2, 0.05)).toBe(0.05);
    expect(cameraNear(4, 0.1)).toBe(0.1);
  });
  it('grows with the distance (2%) and is capped at 4 m', () => {
    expect(cameraNear(60, 0.1)).toBeCloseTo(1.2, 6);
    expect(cameraNear(600, 0.1)).toBe(4);
  });
  it('over the whole section and room range the finish offset is ≥ 5 × the depth resolution (a fixed 0.1 m: less than 1 × at 90 m)', () => {
    for (const d of [5, 15, 35, 60, 90]) expect(OFFSET / depthResolution(d, cameraNear(d, d <= 35 ? 0.05 : 0.1))).toBeGreaterThan(5);
    expect(OFFSET / depthResolution(90, 0.1)).toBeLessThan(1);
  });
});

// when the camera stands among bushes, trees between the camera and the building are thinned out — the building shows through
describe('tree transparency between the camera and the building (camera → building cone)', () => {
  const F = SEE_THROUGH.focus, cam = new THREE.Vector3(F.x + 40, F.y + 4, F.z);
  const on = (t: number, off = 0) => cam.clone().lerp(F, t).add(new THREE.Vector3(0, 0, off));
  it('a tree on the view axis to the building: minimum opacity; outside the cone — unchanged', () => {
    expect(seeThroughKeep(cam, on(0.3))).toBeCloseTo(SEE_THROUGH.minKeep, 6);
    expect(seeThroughKeep(cam, on(0.9))).toBeCloseTo(SEE_THROUGH.minKeep, 6);
    expect(seeThroughKeep(cam, on(0.5, 0.5 * SEE_THROUGH.radius * 1.05))).toBe(1);      // just outside the cone radius there
    expect(seeThroughKeep(cam, on(0.5, 0.5 * SEE_THROUGH.radius * 0.8))).toBeGreaterThan(SEE_THROUGH.minKeep);
    expect(seeThroughKeep(cam, on(0.5, 0.5 * SEE_THROUGH.radius * 0.8))).toBeLessThan(1);  // a soft edge
  });
  it('the cone narrows towards the camera: a branch 1 m in front of the lens disappears only where it hides the building', () => {
    const t = 1 / cam.distanceTo(F), r = t * SEE_THROUGH.radius;
    expect(seeThroughKeep(cam, on(t, r * 0.3))).toBeCloseTo(SEE_THROUGH.minKeep, 6);
    expect(seeThroughKeep(cam, on(t, r * 1.5))).toBe(1);
  });
  it('trees behind the camera and beyond the building are left alone', () => {
    expect(seeThroughKeep(cam, on(-0.2))).toBe(1);
    expect(seeThroughKeep(cam, on(1.3))).toBe(1);
  });
});
