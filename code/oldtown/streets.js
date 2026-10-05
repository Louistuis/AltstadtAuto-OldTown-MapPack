import * as THREE from 'three';
import { addWalkBox, physBoxAt } from '../engine/collision.js';
import { BOX, PLANE } from '../engine/parts.js';
import { T, CH, B, END, RIVER, PROM, inside } from './plan.js';

/*
  The old town's ground: the plateau the town stands on (its collision), and every surface on
  top of it - cobbled lanes with a drain gutter down the middle, granite setts on the squares
  laid in panels between flagstone bands, flagstone pavements behind granite kerbs (rounded at
  the junctions), asphalt on the traffic streets with zebra crossings, setts in the parking bays,
  the tram rails set into the avenue, gravel courtyards. Surfaces never overlap: each one is cut
  round the next, so nothing z-fights however far off.
*/

export const DISC = new THREE.CylinderGeometry(0.5, 0.5, 1, 40);
const BO = 9;          // kerb buildouts: the pavement runs out to the carriageway this far either side of a junction
const CORNER_R = 2;    // kerb radius at the junction corners
const ZEBRA = 0.6;     // gap between the crossing street's carriageway and the zebra
const ZW = 3;          // zebra width

/** Every walk/physics box of the plateau: 16 m tiles, the river cut out. */
export function plateau(C) {
  const { colliders } = C;
  const tile = (x0, x1, z0, z1) => {
    // split into equal tiles of at most 16 m a side
    const cols = Math.ceil((x1 - x0) / 16), rows = Math.ceil((z1 - z0) / 16);
    const xAt = (i) => x0 + (x1 - x0) * i / cols, zAt = (j) => z0 + (z1 - z0) * j / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const ax = xAt(i), bx = xAt(i + 1), az = zAt(j), bz = zAt(j + 1);
      // (topOnly: only the top is a surface; cam: the camera stays above it)
      addWalkBox(colliders, ax, bx, az, bz, T, { noSeat: true, topOnly: true });
      physBoxAt(colliders, (ax + bx) / 2, T / 2, (az + bz) / 2, bx - ax, T, bz - az, { topOnly: true, cam: true });
    }
  };
  tile(-B, B, -B, RIVER.z0);
  tile(-B, B, RIVER.z1, B);
}

/** Lay every surface of the plan. */
export function layGround(C, P) {
  const { M, batch } = C;
  const G = {
    cobble: batch('g.cobble', PLANE, M.cobble, { cast: false }),
    setts: batch('g.setts', PLANE, M.setts, { cast: false }),
    flag: batch('g.flag', PLANE, M.flagstone, { cast: false }),
    asphalt: batch('g.asphalt', PLANE, M.asphalt, { cast: false }),
    gravel: batch('g.gravel', PLANE, M.gravel, { cast: false }),
    grass: batch('g.grass', PLANE, M.grass, { cast: false }),
  };
  C.G = G;
  const pave = C.box('pave', 'flagstone');
  const kerb = C.box('kerb', 'curb');
  const discPave = C.batch('paveDisc', DISC, M.flagstone);
  const rail = C.box('rail', 'rail', { cast: false });
  /** A flat surface rect at height y, cut into tiles of at most 24 m (so it culls by chunk). */
  const plane = (b, x0, x1, z0, z1, c = 0xffffff, y = T) => {
    if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return;
    const nx = Math.ceil((x1 - x0) / 24), nz = Math.ceil((z1 - z0) / 24);
    for (let a = 0; a < nx; a++) for (let k = 0; k < nz; k++) {
      const ax = x0 + (x1 - x0) * a / nx, bx = x0 + (x1 - x0) * (a + 1) / nx;
      const az = z0 + (z1 - z0) * k / nz, bz = z0 + (z1 - z0) * (k + 1) / nz;
      b.add((ax + bx) / 2, y, (az + bz) / 2, bx - ax, 1, bz - az, c);
    }
  };
  C.plane = plane;
  /** A raised pavement slab (walk + physics), at most 16 m a piece. */
  const slab = (x0, x1, z0, z1, top = T + CH) => {
    if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return;
    const nx = Math.ceil((x1 - x0) / 16), nz = Math.ceil((z1 - z0) / 16);
    for (let a = 0; a < nx; a++) for (let k = 0; k < nz; k++) {
      const ax = x0 + (x1 - x0) * a / nx, bx = x0 + (x1 - x0) * (a + 1) / nx;
      const az = z0 + (z1 - z0) * k / nz, bz = z0 + (z1 - z0) * (k + 1) / nz;
      pave.add((ax + bx) / 2, top - CH / 2, (az + bz) / 2, bx - ax, CH, bz - az);
      C.solidBox(ax, bx, az, bz, T, top, { topOnly: true, noSeat: true });
    }
  };
  C.slab = slab;
  // kerb stone along an edge, on side s of it: the granite band at the pavement's street face (2 cm proud, so the faces never coincide)
  const kerbX = (x0, x1, z, s) => kerb.add((x0 + x1) / 2, T + CH / 2 + 0.005, z + s * 0.13 - s * 0.01, x1 - x0, CH + 0.01, 0.26);
  const kerbZ = (z0, z1, x, s) => kerb.add(x + s * 0.13 - s * 0.01, T + CH / 2 + 0.005, (z0 + z1) / 2, 0.26, CH + 0.01, z1 - z0);
  C.kerbLine = (x, z0, z1, side) => kerbZ(z0, z1, x, side);

  // ---------- lanes: cobbles, a drain gutter down the middle ----------
  for (const l of P.lanes) {
    const mat = l.square ? G.setts : G.cobble;
    if (l.axis === 'x') {
      const c = (l.z0 + l.z1) / 2;
      if (l.square) plane(mat, l.x0, l.x1, l.z0, l.z1);
      else { plane(mat, l.x0, l.x1, l.z0, c - 0.25); plane(G.setts, l.x0, l.x1, c - 0.25, c + 0.25, 0x8a8478); plane(mat, l.x0, l.x1, c + 0.25, l.z1); }
    } else {
      const c = (l.x0 + l.x1) / 2;
      if (l.square) plane(mat, l.x0, l.x1, l.z0, l.z1);
      else { plane(mat, l.x0, c - 0.25, l.z0, l.z1); plane(G.setts, c - 0.25, c + 0.25, l.z0, l.z1, 0x8a8478); plane(mat, c + 0.25, l.x1, l.z0, l.z1); }
    }
  }
  for (const y of P.yards) plane(G.cobble, y.x0, y.x1, y.z0, y.z1);
  for (const c of P.courtyards) plane(G.gravel, c.x0, c.x1, c.z0, c.z1, 0xb8ae9c);
  // cobbles under every block (they show where a house stands back from the lane), round its courtyard
  for (const b of P.blocks) {
    const c = P.courtyards.find((q) => q.block === b.id);
    if (!c) { plane(G.cobble, b.x0, b.x1, b.z0, b.z1); continue; }
    plane(G.cobble, b.x0, b.x1, b.z0, c.z0); plane(G.cobble, b.x0, b.x1, c.z1, b.z1);
    plane(G.cobble, b.x0, c.x0, c.z0, c.z1); plane(G.cobble, c.x1, b.x1, c.z0, c.z1);
  }
  for (const s of P.sites) plane(G.setts, s.x0, s.x1, s.z0, s.z1);
  for (const k in P.stores) { const s = P.stores[k]; if (s) plane(G.setts, s.x0, s.x1, s.z0, s.z1); }

  // ---------- squares: setts in panels between flagstone bands ----------
  for (const q of P.squares) {
    if (q.kind === 'promenade') { promenadeGround(q); continue; }
    if (q.kind === 'gate') { plane(G.setts, q.x0, q.x1, q.z0, q.z1, 0x9a9488); continue; }
    panels(q, q.kind === 'cathedral' ? 9 : q.kind === 'market' ? 8 : 6);
  }
  /** Setts panels `cell` m across with 0.45 m flagstone bands between them (no overlaps: the bands along x run through, the ones along z stop at them). */
  function panels(q, cell) {
    const BW = 0.45;
    const W = q.x1 - q.x0, D = q.z1 - q.z0;
    const nx = Math.max(1, Math.round(W / cell)), nz = Math.max(1, Math.round(D / cell));
    const xs = Array.from({ length: nx + 1 }, (_, i) => q.x0 + W * i / nx);
    const zs = Array.from({ length: nz + 1 }, (_, i) => q.z0 + D * i / nz);
    // bands along x at every inner z line (full width); along z between them
    for (let j = 1; j < nz; j++) plane(G.flag, q.x0, q.x1, zs[j] - BW / 2, zs[j] + BW / 2, 0xd8d2c6);
    for (let j = 0; j < nz; j++) {
      const z0 = zs[j] + (j > 0 ? BW / 2 : 0), z1 = zs[j + 1] - (j < nz - 1 ? BW / 2 : 0);
      for (let i = 0; i < nx; i++) {
        const x0 = xs[i] + (i > 0 ? BW / 2 : 0), x1 = xs[i + 1] - (i < nx - 1 ? BW / 2 : 0);
        plane(G.setts, x0, x1, z0, z1, (i + j) % 2 ? 0xffffff : 0xf0ece4);
        if (i < nx - 1) plane(G.flag, xs[i + 1] - BW / 2, xs[i + 1] + BW / 2, z0, z1, 0xd8d2c6);
      }
    }
  }
  /** The promenade: flagstones, a gravel strip down the middle for its row of trees. */
  function promenadeGround(q) {
    plane(G.flag, q.x0, q.x1, q.z0, 60.4);
    plane(G.gravel, q.x0, q.x1, 60.4, 63.6, 0xc8b89c);
    plane(G.flag, q.x0, q.x1, 63.6, q.z1);
  }

  // ---------- traffic streets ----------
  const gateLo = -END + 20, gateHi = END - 20;
  for (const s of P.streets) {
    const cross = s.axis === 'z' ? P.zstreets : P.xstreets;
    // along-stretches between junction bands (and the river, for the streets that bridge it)
    const stops = cross.map((q) => [q.lo, q.hi]);
    if (s.axis === 'z') stops.push([RIVER.z0, RIVER.z1]);
    stops.sort((a, b) => a[0] - b[0]);
    const runs = [];
    let a = gateLo;
    for (const [lo, hi] of stops) { if (lo > a) runs.push([a, lo, hi]); a = Math.max(a, hi); }
    runs.push([a, gateHi]);
    // the zebra crossings at the promenade (street meets the riverside walk)
    const promZ = s.axis === 'z' ? [60.4, 63.6] : null;
    for (const [a0, a1] of runs) street(s, a0, a1, promZ && a0 < PROM.z1 && a1 > PROM.z0 ? promZ : null);
  }
  for (const J of P.junctions) junction(J.xs, J.zs);

  /** Put a rect given in a street's own frame (u across, a along) into the world. */
  function rectOf(s, u0, u1, a0, a1) { return s.axis === 'z' ? [u0, u1, a0, a1] : [a0, a1, u0, u1]; }
  function street(s, a0, a1, zebra) {
    const carr = s.kind === 'avenue' ? G.setts : G.asphalt;
    const carrCol = s.kind === 'avenue' ? 0xd8d0c4 : 0xffffff;
    // carriageway (with a zebra across it at the promenade)
    if (zebra) {
      plane(carr, ...rectOf(s, s.c - s.carr, s.c + s.carr, a0, zebra[0]), carrCol);
      zebraBand(s, zebra[0], zebra[1], carr, carrCol);
      plane(carr, ...rectOf(s, s.c - s.carr, s.c + s.carr, zebra[1], a1), carrCol);
    } else plane(carr, ...rectOf(s, s.c - s.carr, s.c + s.carr, a0, a1), carrCol);
    for (const sd of [-1, 1]) {
      const S = sd < 0 ? s.n : s.p;
      const bl = sd < 0 ? s.lo : s.hi;                   // building line
      const ce = s.c + sd * s.carr;                       // carriageway edge
      const kl = ce + sd * S.park;                        // kerb line (outside the parking lane)
      // the pavement, out to the kerb; over the parking lane near the junctions (buildouts)
      const [u0, u1] = sd < 0 ? [bl, kl] : [kl, bl];
      slab(...rectOf(s, u0, u1, a0, a1));
      if (S.park > 0) {
        const L = a1 - a0;
        const b0 = a0 + Math.min(BO, L / 2), b1 = a1 - Math.min(BO, L / 2);
        const [p0, p1] = sd < 0 ? [ce, kl] : [kl, ce];
        slab(...rectOf(s, p0, p1, a0, b0));
        slab(...rectOf(s, p0, p1, b1, a1));
        if (b1 > b0) plane(G.setts, ...rectOf(s, p0, p1, b0, b1), 0xb0a898);
        // kerbs: along the bay, and the buildouts' ends and noses
        kerbAlong(s, kl, sd, b0, b1);
        kerbAlong(s, ce, sd, a0, b0);
        kerbAlong(s, ce, sd, b1, a1);
        if (b1 > b0) { kerbAcross(s, b0, p0, p1, -1); kerbAcross(s, b1, p0, p1, 1); }
      } else kerbAlong(s, ce, sd, a0, a1);
    }
    // tram rails, both tracks, on the avenue (and on over the bridge: bridges.js)
    if (s.tram) for (const tr of [-1, 1]) for (const g of [-0.7175, 0.7175]) {
      const u = s.c + tr * s.carr * 0.5 + g;
      rail.add(...(s.axis === 'z' ? [u, T + 0.006, (a0 + a1) / 2, 0.07, 0.024, a1 - a0] : [(a0 + a1) / 2, T + 0.006, u, a1 - a0, 0.024, 0.07]));
    }
  }
  /** Kerb along a street at across-coordinate u; side = the side of u the pavement is on. */
  function kerbAlong(s, u, side, a0, a1) {
    if (a1 - a0 < 0.05) return;
    if (s.axis === 'z') kerbZ(a0, a1, u, side); else kerbX(a0, a1, u, side);
  }
  function kerbAcross(s, a, u0, u1, side) {
    if (s.axis === 'z') kerbX(u0, u1, a, side); else kerbZ(u0, u1, a, side);
  }
  /** Zebra stripes across a street's carriageway, along-range [a0, a1]. */
  function zebraBand(s, a0, a1, carr, carrCol) {
    const u0 = s.c - s.carr, u1 = s.c + s.carr, n = Math.round((u1 - u0) / 0.5);
    for (let i = 0; i < n; i++) {
      const v0 = u0 + (u1 - u0) * i / n, v1 = u0 + (u1 - u0) * (i + 1) / n;
      plane(i % 2 ? carr : G.flag, ...rectOf(s, v0, v1, a0, a1), i % 2 ? carrCol : 0xf2efe8);
    }
  }
  /** A junction: the carriageway cross (zebras on all four arms) and the four rounded pavement corners. */
  function junction(xs, zs) {
    const carr = (s) => (s.kind === 'avenue' ? G.setts : G.asphalt), col = (s) => (s.kind === 'avenue' ? 0xd8d0c4 : 0xffffff);
    // centre, then each street's arms through the other's band, a zebra on each
    plane(G.asphalt, xs.c - xs.carr, xs.c + xs.carr, zs.c - zs.carr, zs.c + zs.carr);
    for (const [s, q] of [[xs, zs], [zs, xs]]) {
      for (const sd of [-1, 1]) {
        const e = q.c + sd * q.carr, far = sd < 0 ? q.lo : q.hi;
        const z0 = e + sd * ZEBRA, z1 = e + sd * (ZEBRA + ZW);
        const seg = (a, b) => plane(carr(s), ...rectOf(s, s.c - s.carr, s.c + s.carr, Math.min(a, b), Math.max(a, b)), col(s));
        seg(e, z0);
        zebraBand(s, Math.min(z0, z1), Math.max(z0, z1), carr(s), col(s));
        seg(z1, far);
        // tram rails through the junction
        if (s.tram) for (const tr of [-1, 1]) for (const g of [-0.7175, 0.7175]) {
          const u = s.c + tr * s.carr * 0.5 + g, a = (q.c + far) / 2, L = Math.abs(far - q.c);
          rail.add(...(s.axis === 'z' ? [u, T + 0.006, a, 0.07, 0.024, L] : [a, T + 0.006, u, L, 0.024, 0.07]));
        }
      }
    }
    // pavement corners: x in [xs edge, xs building line], z likewise; rounded toward the junction
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const ex = xs.c + sx * xs.carr, bx = sx < 0 ? xs.lo : xs.hi;
      const ez = zs.c + sz * zs.carr, bz = sz < 0 ? zs.lo : zs.hi;
      const r = CORNER_R;
      const cx = ex + sx * r, cz = ez + sz * r; // the round's centre
      const xa = Math.min(ex, bx), xb = Math.max(ex, bx), za = Math.min(ez, bz), zb = Math.max(ez, bz);
      // the slab minus the r x r corner square (collision: the whole rect), then the quarter disc
      pave.add((Math.min(cx, bx) + Math.max(cx, bx)) / 2, T + CH / 2, (za + zb) / 2, Math.abs(bx - cx), CH, zb - za);
      pave.add((xa + xb) / 2 + 0, T + CH / 2, (Math.min(cz, bz) + Math.max(cz, bz)) / 2, xb - xa, CH, Math.abs(bz - cz));
      discPave.add(cx, T + CH / 2, cz, 2 * r, CH, 2 * r);
      C.solidBox(xa, xb, za, zb, T, T + CH, { topOnly: true, noSeat: true });
      // kerbs: straight runs, then the arc in short pieces
      kerbZ(Math.min(cz, bz), Math.max(cz, bz), ex, sx);
      kerbX(Math.min(cx, bx), Math.max(cx, bx), ez, sz);
      const N = 7;
      for (let i = 0; i < N; i++) {
        const t0 = (i / N) * Math.PI / 2, t1 = ((i + 1) / N) * Math.PI / 2, tm = (t0 + t1) / 2;
        // the arc from (ex, cz) round to (cx, ez): angle measured from the -sx axis toward -sz
        const px = cx - sx * Math.cos(tm) * (r - 0.12), pz = cz - sz * Math.sin(tm) * (r - 0.12);
        const len = 2 * r * Math.sin((t1 - t0) / 2) + 0.04;
        kerb.add(px, T + CH / 2 + 0.005, pz, 0.26, CH + 0.01, len, 0xffffff, Math.atan2(sx * Math.sin(tm), -sz * Math.cos(tm)));
      }
    }
  }
  return G;
}

export { BO, ZEBRA, ZW };
export const inRect = inside;
