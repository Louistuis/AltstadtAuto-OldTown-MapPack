/*
  Roofs on any convex footprint, as the lower envelope of planes: each sloped plane rises from
  one footprint edge (k = rise per metre in from that edge, off = height at the edge), a flat
  cap is a plane with k = 0. Every point of the roof is the lowest plane over it, so each
  plane's face is the footprint clipped by "this plane is below every other one" - convex
  pieces, no special cases for hips, gables, mansards, chamfered corners or turrets.
  An edge with no plane of its own is a gable: a vertical wall up to the roof line above it.
*/

/** Footprint polygon [[x, z]...] (counter-clockwise seen from above): each edge's outward unit normal. */
export function edgeNormals(poly) {
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    return [-tz / l, tx / l];
  });
}

/** The polygon with each edge pushed out by offs[i] (convex: intersect neighbouring lines). */
export function offsetPoly(poly, offs) {
  const N = edgeNormals(poly), n = poly.length;
  const line = (i) => { const a = poly[i]; return [a[0] + N[i][0] * offs[i], a[1] + N[i][1] * offs[i], N[i]]; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const j = (i + n - 1) % n;
    const [ax, az, na] = line(j), [bx, bz, nb] = line(i);
    // point on both lines: n . p = n . a
    const ca = na[0] * ax + na[1] * az, cb = nb[0] * bx + nb[1] * bz;
    const det = na[0] * nb[1] - na[1] * nb[0];
    if (Math.abs(det) < 1e-6) out.push([bx, bz]);
    else out.push([(ca * nb[1] - cb * na[1]) / det, (na[0] * cb - nb[0] * ca) / det]);
  }
  return out;
}

/**
 * The roof over `poly` from height y0. planes: [{ e (edge index, or -1 for a level cap), k, off,
 * L (layer), col }]. Returns { h(x, z) world roof height, faces: [{ plane, pts: [[x, y, z]...] }],
 * gables: [{ e, pts }] } without emitting anything (see emitRoof).
 */
export function roofEnvelope(poly, planes, y0) {
  const N = edgeNormals(poly);
  // each plane as h = c + gx x + gz z
  const P = planes.map((p) => {
    if (p.e < 0) return { ...p, gx: 0, gz: 0, c: p.off };
    const a = poly[p.e], n = N[p.e];
    return { ...p, gx: -p.k * n[0], gz: -p.k * n[1], c: p.off + p.k * (a[0] * n[0] + a[1] * n[1]) };
  });
  const hAt = (x, z) => { let m = Infinity; for (const q of P) m = Math.min(m, q.c + q.gx * x + q.gz * z); return y0 + m; };
  const faces = [];
  P.forEach((q, j) => {
    let reg = poly.slice();
    for (let i = 0; i < P.length && reg.length >= 3; i++) {
      if (i === j) continue;
      const r = P[i];
      const ax = q.gx - r.gx, az = q.gz - r.gz, ac = q.c - r.c;
      if (Math.abs(ax) + Math.abs(az) + Math.abs(ac) < 1e-7) { if (i < j) reg = []; continue; } // the same plane twice
      reg = clipHalf(reg, ax, az, ac, i < j);
    }
    reg = dedupe(reg);
    if (reg.length < 3 || area(reg) < 1e-4) return;
    faces.push({ plane: q, pts: reg.map(([x, z]) => [x, y0 + q.c + q.gx * x + q.gz * z, z]) });
  });
  // gables: edges without a plane, a wall up to the roof line along them
  const gables = [];
  const has = new Set(P.filter((q) => q.e >= 0).map((q) => q.e));
  poly.forEach((a, e) => {
    if (has.has(e)) return;
    const b = poly[(e + 1) % poly.length];
    const tx = b[0] - a[0], tz = b[1] - a[1], len = Math.hypot(tx, tz);
    if (len < 1e-3) return;
    const ts = [0, 1];
    for (const f of faces) for (const p of f.pts) {
      const t = ((p[0] - a[0]) * tx + (p[2] - a[1]) * tz) / (len * len);
      const dx = a[0] + tx * t - p[0], dz = a[1] + tz * t - p[2];
      if (t > 1e-4 && t < 1 - 1e-4 && dx * dx + dz * dz < 1e-6) ts.push(t);
    }
    ts.sort((p, q) => p - q);
    const top = [];
    for (const t of ts) if (!top.length || t - top[top.length - 1] > 1e-4) top.push(t);
    const pt = (t) => [a[0] + tx * t, a[1] + tz * t];
    const pts = [[a[0], y0, a[1]], [b[0], y0, b[1]]];
    for (let i = top.length - 1; i >= 0; i--) { const [x, z] = pt(top[i]); pts.push([x, hAt(x, z), z]); }
    const peak = Math.max(...pts.map((p) => p[1]));
    const clean = pts.filter((p, i) => { const q = pts[(i + pts.length - 1) % pts.length]; return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) > 1e-4; });
    if (peak - y0 > 0.02 && clean.length >= 3) gables.push({ e, pts: clean, n: N[e] });
  });
  return { h: hAt, faces, gables, N };
}

/** Clip convex poly [[x, z]] to ax x + az z + ac <= 0 (strict drops the boundary ties). */
function clipHalf(poly, ax, az, ac, strict) {
  const eps = strict ? -1e-7 : 1e-7;
  const f = (p) => ax * p[0] + az * p[1] + ac;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], fp = f(p), fq = f(q);
    const ip = fp <= eps, iq = fq <= eps;
    if (ip) out.push(p);
    if (ip !== iq) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
function dedupe(poly) {
  return poly.filter((p, i) => { const q = poly[(i + poly.length - 1) % poly.length]; return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 1e-5; });
}
function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

/** Emit an envelope's faces (each in its plane's layer) and gable walls (in gableL). */
export function emitRoof(env, gableL, gableCol) {
  for (const f of env.faces) f.plane.L.poly(f.pts, f.plane.col, [0, 1, 0]);
  if (gableL) for (const g of env.gables) gableL.poly(g.pts, gableCol, [g.n[0], 0, g.n[1]]);
}
