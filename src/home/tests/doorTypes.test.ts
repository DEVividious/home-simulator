// Double and folding doors in the app (the core plan fixture doors.plan.json, compiled): the package passes the app validation,
// every leaf is a mesh of its own width turning about its own hinge (the bifold's second panel about the fold), handles where a
// hand takes the door, the walk through a closed double entrance door is blocked and through an open one free, and furniture in
// front of a bifold is warned only as far as the folded panels reach.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { compilePlan } from '@home-sim/core/authoring/compile';
import { activateProject, project } from '../../project/active';
import { readProjectDir } from '../../project/node';
import { validateProject } from '../../project/validate';
import { resolveDims } from '../catalog/furniture';
import { itemById } from '../catalog/providers';
import { furnitureWarnings } from '../model/collision';
import { doorById, doorLeaves, doorPassable, leafCount, leafWidthOf, setDoorOpen, defaultDoorState } from '../model/doors';
import { roomById } from '../model/rooms';
import { setDoorGate } from '../model/walk';
import { WalkWorld, type WalkPose } from '../model/walkWorld';
import { frameGeometry, leafGeometries, leafMatrix } from '../three/doorGeometry';

const root = path.resolve(__dirname, '..', '..', '..');
const D = (id: string) => doorById(id)!;
const EYE = 1.68;

beforeAll(() => {
  const r = compilePlan(JSON.parse(fs.readFileSync(path.join(root, 'packages/core/tests/fixtures/doors.plan.json'), 'utf8')), { catalog: null });
  activateProject(r.project!);
});
afterEach(() => setDoorGate(null));
afterAll(() => { activateProject(readProjectDir(path.join(root, 'projects', 'demo-apartment'))); });

describe('double and folding doors', () => {
  it('the package passes the app validation; door types as planned', () => {
    expect(validateProject(project())).toEqual([]);
    expect(['D0', 'D1', 'D2', 'D3'].map((id) => D(id).type)).toEqual(['hinged-double', 'hinged-double', 'folding', 'sliding']);
  });
  it('leaf meshes: each half leaf as wide as half the leaves, handles on both double leaves, on the bifold only on its free panel', () => {
    const handles = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!.max.z > 0.05; };
    for (const id of ['D1', 'D2']) {
      const d = D(id);
      expect(leafCount(d)).toBe(2);
      for (let i = 0; i < 2; i++) {
        const g = leafGeometries(d, i).leaf;
        g.computeBoundingBox();
        expect(g.boundingBox!.max.x).toBeLessThanOrEqual(leafWidthOf(d) + 1e-6);
        expect(g.boundingBox!.max.x).toBeGreaterThan(leafWidthOf(d) - 0.01);
      }
    }
    expect([handles(leafGeometries(D('D1'), 0).leaf), handles(leafGeometries(D('D1'), 1).leaf)]).toEqual([true, true]);
    expect([handles(leafGeometries(D('D2'), 0).leaf), handles(leafGeometries(D('D2'), 1).leaf)]).toEqual([false, true]);
    const f = frameGeometry(D('D1'))!; f.computeBoundingBox();
    expect(f.boundingBox!.max.x - f.boundingBox!.min.x).toBeCloseTo(D('D1').opening.width, 6);
  });
  it('leaf matrices: a double door turns both leaves about their own hinges at both jambs; the bifold panel 2 about the fold', () => {
    const d = D('D1'), o = new THREE.Vector3();
    for (const t of [0, 0.5, 1]) for (let i = 0; i < 2; i++) {
      o.set(0, 0, 0).applyMatrix4(leafMatrix(d, t, new THREE.Matrix4(), i));
      const a = doorLeaves(d, 0)[i].a;
      expect(o.x).toBeCloseTo(a[0] - d.openDir![0] * 0.02, 6); expect(-o.z).toBeCloseTo(a[1] - d.openDir![1] * 0.02, 6);
    }
    // the leaf's local +x runs along the leaf in plan
    const f = D('D2'), m = leafMatrix(f, 0.5, new THREE.Matrix4(), 1), x = new THREE.Vector3(1, 0, 0).transformDirection(m), l = doorLeaves(f, 0.5)[1];
    expect(x.x).toBeCloseTo(l.dir[0], 6); expect(-x.z).toBeCloseTo(l.dir[1], 6);
  });
  it('walk: the closed double entrance door blocks, open it lets one out onto the plot', () => {
    const site = project().site!, xs = site.boundary.map((q) => q[0]), ys = site.boundary.map((q) => q[1]);
    const w = new WalkWorld({ footprint: site.footprint, bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], ground: () => site.groundLevel });
    const out = (s = defaultDoorState()) => { setDoorGate((id) => doorPassable(s, id)); let p: WalkPose = { p: [1.5, 5.36], z: 0 }; for (let i = 0; i < 40; i++) p = w.step(p, -0.1, 0, EYE); return p; };
    expect(out().p[0]).toBeGreaterThan(0.3);
    const p = out(setDoorOpen(defaultDoorState(), 'D0', 1));
    expect(p.p[0]).toBeLessThan(-1); expect(w.placeAt(p, EYE).kind).toBe('site');
  });
  it('furniture: in front of the bifold within its folded panels — warned; beyond them not', () => {
    const L = roomById('L')!, it0 = itemById('armchair')!, dims = resolveDims(it0), d = D('D2');
    const kinds = (x: number, y: number, room = L) => furnitureWarnings(room, it0, { id: 'x', catalogId: it0.id, x, y, rot: 0 }, dims, []).map((q) => q.kind);
    const mid = (d.opening.from + d.opening.to) / 2;
    expect(kinds(mid, 4.3 - 0.45)).toContain('door');
    expect(kinds(mid, 4.3 - 0.6 - dims.d / 2 - 0.05)).not.toContain('door');
  });
});
