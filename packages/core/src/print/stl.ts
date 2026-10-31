// Binary STL of a print part, and the check of a file read back (ADR 0030, 0033): the bytes depend only on the mesh — no time, no
// random header — so the same input gives the same file in the CLI, the plugin and the app. A file is accepted only when, read
// back, it is closed (every edge twice, in opposite directions, vertices compared bit for bit), has no degenerate triangle and
// encloses a positive volume.

/**
 * Needles out of a closed mesh: a triangle whose corner lies on its longest edge (height below `hMin`) is dropped and the
 * triangle across that edge is split at the corner — the surface and the edges around stay as they are, the mesh stays closed.
 * The boolean leaves a few such triangles where a vertex of one input lies on an edge of another.
 */
export function splitNeedles(P: ArrayLike<number>, index: Uint32Array, hMin: number): Uint32Array {
  const tris: number[][] = [];
  for (let t = 0; t < index.length / 3; t++) tris.push([index[t * 3], index[t * 3 + 1], index[t * 3 + 2]]);
  const at = (v: number) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  const len2 = (a: number, b: number) => { const p = at(a), q = at(b); return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; };
  const height = (t: number[]) => {
    const [a, b, c] = t.map(at), ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const twice = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx), long = Math.sqrt(Math.max(len2(t[0], t[1]), len2(t[1], t[2]), len2(t[2], t[0])));
    return long ? twice / long : 0;
  };
  const edgeOf = new Map<string, number>(), key = (a: number, b: number) => `${a},${b}`;
  const index3 = (i: number) => { const t = tris[i]; for (let k = 0; k < 3; k++) edgeOf.set(key(t[k], t[(k + 1) % 3]), i); };
  tris.forEach((_, i) => index3(i));
  const alive = tris.map(() => true);
  for (let pass = 0, changed = true; changed && pass < 10; pass++) {
    changed = false;
    for (let i = 0, end = tris.length; i < end; i++) {
      if (!alive[i] || height(tris[i]) >= hMin) continue;
      const t = tris[i];
      // the longest edge a → b and the corner c on it
      let k = 0;
      for (let j = 1; j < 3; j++) if (len2(t[j], t[(j + 1) % 3]) > len2(t[k], t[(k + 1) % 3])) k = j;
      const a = t[k], b = t[(k + 1) % 3], c = t[(k + 2) % 3], o = edgeOf.get(key(b, a));
      if (o === undefined || !alive[o] || o === i) continue;
      const u = tris[o], d = u.find((v) => v !== a && v !== b)!;
      // (a, b, c) and (b, a, d) become (c, a, d) and (c, d, b); a → d, d → b, b → c, c → a stay — only when neither is a needle
      // a flat triangle (no area at all) is flipped even when the new ones are thin — only not into flat ones again
      const flat = height(t) < 1e-9, h1 = height([c, a, d]), h2 = height([c, d, b]);
      if (flat ? h1 < 1e-9 || h2 < 1e-9 : h1 < hMin || h2 < hMin) continue;
      alive[i] = alive[o] = false;
      for (const x of [t, u]) for (let j = 0; j < 3; j++) if (edgeOf.get(key(x[j], x[(j + 1) % 3])) === (x === t ? i : o)) edgeOf.delete(key(x[j], x[(j + 1) % 3]));
      tris.push([c, a, d], [c, d, b]); alive.push(true, true);
      index3(tris.length - 2); index3(tris.length - 1);
      changed = true;
    }
  }
  const out: number[] = [];
  tris.forEach((t, i) => { if (alive[i]) out.push(...t); });
  return new Uint32Array(out);
}

/** a binary STL: 80-byte header, the triangle count, then per triangle its normal, three corners (float32, mm) and 0 */
export function writeStl(positions: Float32Array, index: Uint32Array, header: string): Uint8Array {
  const n = index.length / 3, out = new Uint8Array(84 + n * 50), dv = new DataView(out.buffer);
  const h = header.slice(0, 80);
  for (let i = 0; i < h.length; i++) out[i] = h.charCodeAt(i) < 128 ? h.charCodeAt(i) : 63;
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50, a = index[t * 3] * 3, b = index[t * 3 + 1] * 3, c = index[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    for (let k = 0; k < 3; k++) {
      const v = index[t * 3 + k] * 3;
      dv.setFloat32(o + 12 + k * 12, positions[v], true); dv.setFloat32(o + 16 + k * 12, positions[v + 1], true); dv.setFloat32(o + 20 + k * 12, positions[v + 2], true);
    }
    dv.setUint16(o + 48, 0, true);
  }
  return out;
}

export interface StlCheck {
  ok: boolean;
  triangles: number;
  /** enclosed volume [mm³] */
  volume: number;
  /** what is wrong (empty when ok) */
  problems: string[];
}

/** reads a binary STL back and checks it can be printed as one closed solid */
export function checkStl(bytes: Uint8Array): StlCheck {
  const problems: string[] = [];
  if (bytes.length < 84) return { ok: false, triangles: 0, volume: 0, problems: ['shorter than an STL header'] };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), n = dv.getUint32(80, true);
  if (bytes.length !== 84 + n * 50) return { ok: false, triangles: n, volume: 0, problems: [`length ${bytes.length} does not match ${n} triangles`] };
  // vertices by their bits
  const ids = new Map<string, number>(), coords: number[] = [], tri = new Uint32Array(n * 3);
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
    const o = 84 + t * 50 + 12 + k * 12, key = `${dv.getUint32(o, true)},${dv.getUint32(o + 4, true)},${dv.getUint32(o + 8, true)}`;
    let id = ids.get(key);
    if (id === undefined) { id = coords.length / 3; ids.set(key, id); coords.push(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)); }
    tri[t * 3 + k] = id;
  }
  let degenerate = 0, volume = 0;
  const edges = new Map<number, number>(), V = ids.size, key = (a: number, b: number) => a * V + b;
  for (let t = 0; t < n; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    const A = [coords[a * 3], coords[a * 3 + 1], coords[a * 3 + 2]], B = [coords[b * 3], coords[b * 3 + 1], coords[b * 3 + 2]], C = [coords[c * 3], coords[c * 3 + 1], coords[c * 3 + 2]];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    if (a === b || b === c || a === c || Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) === 0) degenerate++;
    volume += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) edges.set(key(p, q), (edges.get(key(p, q)) ?? 0) + 1);
  }
  let open = 0, repeated = 0;
  for (const [e, count] of edges) {
    if (count > 1) repeated++;
    if (edges.get((e % V) * V + Math.floor(e / V)) !== 1) open++;
  }
  if (degenerate) problems.push(`${degenerate} degenerate triangle(s)`);
  if (repeated) problems.push(`${repeated} edge(s) used twice in one direction`);
  if (open) problems.push(`${open} edge(s) without an opposite edge (not closed)`);
  if (!(volume > 0)) problems.push(`volume ${volume.toFixed(3)} mm³ is not positive`);
  return { ok: !problems.length, triangles: n, volume, problems };
}
