// Visual fidelity: site surface styles on a model (no geometry change), real scale of finishes, neutral interior preset,
// glass tuned by graphics quality.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MATERIALS, materialById, neutralFinish, physicalSize, textureExtent } from '../catalog/materials';
import { allRooms } from '../model/rooms';
import { tuneJoinery } from '../three/glass';
import { applySiteStyle, SITE_KINDS } from '../three/siteStyle';

/** geometry checksum: triangle count and a weighted sum of world vertex coordinates — independent of indexing */
function geometrySignature(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  let count = 0, sum = 0;
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, pos = g.getAttribute('position');
    count += pos.count / 3;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); sum += v.x + v.y * 3 + v.z * 7; }
  });
  return { count, sum };
}

describe('site and surroundings surfaces', () => {
  // a site model following the convention: materials named with the SITE_KINDS keys, plus one material outside the convention
  const make = () => {
    const root = new THREE.Group(), box = new THREE.BoxGeometry(2, 0.1, 3);
    const mats = [...Object.keys(SITE_KINDS).slice(0, 5), 'MAT_Fence'].map((name) => new THREE.MeshStandardMaterial({ name, color: '#336633', metalness: 0.4 }));
    mats.forEach((m, i) => { const mesh = new THREE.Mesh(box, m); mesh.position.set(i * 2.5, 0, -i); root.add(mesh); });
    // a material shared by two meshes is styled once
    root.add(new THREE.Mesh(box, mats[0]));
    return { root, mats };
  };
  it('materials named by the convention get a surface kind; geometry unchanged; the style is idempotent', () => {
    const { root, mats } = make(), sig = geometrySignature(root);
    applySiteStyle(root);
    const keys = mats.map((m) => m.customProgramCacheKey());
    for (const m of mats.slice(0, 5)) {
      expect(m.customProgramCacheKey(), m.name).toContain(`site-${SITE_KINDS[m.name]}`);
      expect(m.metalness, m.name).toBe(0);
    }
    // outside the convention: untouched
    expect(mats[5].customProgramCacheKey()).not.toContain('site-');
    expect(mats[5].metalness).toBe(0.4);
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) expect(o.receiveShadow).toBe(true); });
    applySiteStyle(root);
    expect(mats.map((m) => m.customProgramCacheKey())).toEqual(keys);
    expect(geometrySignature(root)).toEqual(sig);
  });
});

describe('real scale of finishes', () => {
  it('brick: module = 250 × 65 brick + 10 mm joint (two-course repeat 0.26 × 0.15 m); joint editable', () => {
    const m = materialById('brick-red-klinker')!;
    expect(physicalSize(m)[0]).toBeCloseTo(0.26, 9); expect(physicalSize(m)[1]).toBeCloseTo(0.15, 9);
    const t = physicalSize(m, { grout: 0.005 });
    expect(t[0]).toBeCloseTo(0.255, 9); expect(t[1]).toBeCloseTo(0.14, 9);
    expect(textureExtent(m)[0]).toBeCloseTo(1.04, 9);
  });
  it('wallpapers: the pattern repeat fits the 53 cm roll width (½, 1 or whole rolls)', () => {
    for (const m of MATERIALS.filter((x) => x.category === 'wallpaper' && x.textureSet.type === 'wallpaper')) {
      const w = m.physicalSize[0], k = 0.53 / w;
      expect(Math.abs(k - Math.round(k)) < 1e-6 || Math.abs(w / 0.53 - Math.round(w / 0.53)) < 1e-6, m.id).toBe(true);
    }
  });
  it('no material is scaled by eye: repeat = 1, modules 4 cm – 3.2 m', () => {
    for (const m of MATERIALS) {
      expect(m.repeat ?? [1, 1], m.id).toEqual([1, 1]);
      for (const s of m.physicalSize) { expect(s, m.id).toBeGreaterThanOrEqual(0.04); expect(s, m.id).toBeLessThanOrEqual(3.2); }
    }
  });
  it('classic herringbone has boards of real proportions (length 5–8 × width)', () => {
    const m = materialById('wood-floor-herringbone')!;
    expect(m.textureSet.type).toBe('herringbone');
    const r = m.textureSet.boardLength! / m.textureSet.boardWidth!;
    expect(r).toBeGreaterThanOrEqual(5); expect(r).toBeLessThanOrEqual(8);
  });
});

describe('neutral interior preset', () => {
  it('light walls, white ceiling, floor by room function; all materials exist', () => {
    for (const r of allRooms()) {
      const k = r.kind;
      for (const s of ['wall', 'floor', 'ceiling'] as const) {
        const f = neutralFinish(k, s), m = materialById(f.materialId);
        expect(m, `${r.id} ${s}`).toBeTruthy();
        expect(m!.surfaces.includes(s === 'ceiling' ? 'ceiling' : s) || m!.surfaces.includes('wall'), `${r.id} ${s} ${f.materialId}`).toBe(true);
      }
    }
    expect(neutralFinish('living', 'wall').materialId).toBe('paint-warm-white');
    expect(neutralFinish('living', 'ceiling').materialId).toBe('paint-white');
    expect(neutralFinish('bed', 'floor').materialId).toBe('wood-floor-oak');
    expect(neutralFinish('bath', 'wall').materialId).toBe('walltile-white-30x60');
  });
});

describe('glass by graphics quality', () => {
  const make = () => {
    const g = new THREE.Group();
    const glass = new THREE.MeshPhysicalMaterial({ name: 'MAT_Window_Glass', color: '#9fc6dd', transparent: true, opacity: 0.35 });
    const frame = new THREE.MeshStandardMaterial({ name: 'MAT_Window_Frame', color: '#383e42', roughness: 0.7, metalness: 0.1 });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(), glass), new THREE.Mesh(new THREE.BoxGeometry(), frame));
    return { g, glass, frame };
  };
  it('high: transmission (glass refracts light, not a mirror); medium / low: opacity 25–45 %', () => {
    const { g, glass, frame } = make();
    tuneJoinery(g, 'high');
    expect(glass.transmission).toBe(1); expect(glass.transparent).toBe(false); expect(glass.roughness).toBeLessThan(0.1); expect(glass.metalness).toBe(0);
    expect(frame.metalness).toBeGreaterThanOrEqual(0.3);
    tuneJoinery(g, 'medium');
    expect(glass.transmission).toBe(0); expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeGreaterThanOrEqual(0.25); expect(glass.opacity).toBeLessThanOrEqual(0.45);
    const c1 = glass.color.getHexString();
    tuneJoinery(g, 'high'); tuneJoinery(g, 'medium');
    expect(glass.color.getHexString()).toBe(c1); // changes do not accumulate
  });
  it('all joinery parts sharing a material cast shadows (not only the first one), panes do not', () => {
    const frameMat = new THREE.MeshStandardMaterial({ name: 'MAT_Window_Frame' }), glassMat = new THREE.MeshPhysicalMaterial({ name: 'MAT_Window_Glass' });
    const g = new THREE.Group(), box = new THREE.BoxGeometry();
    const parts = [0, 1, 2].map(() => new THREE.Mesh(box, frameMat)), panes = [0, 1].map(() => new THREE.Mesh(box, glassMat));
    g.add(...parts, ...panes);
    tuneJoinery(g, 'high'); tuneJoinery(g, 'high');
    expect(parts.every((m) => m.castShadow && m.receiveShadow)).toBe(true);
    expect(panes.every((m) => !m.castShadow)).toBe(true);
  });
  it('panes cast no shadow (light enters the interior)', () => {
    const { g } = make();
    tuneJoinery(g, 'high');
    const glassMesh = g.children[0] as THREE.Mesh;
    expect(glassMesh.castShadow).toBe(false);
  });
});
