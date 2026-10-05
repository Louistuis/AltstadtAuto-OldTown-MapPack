import { T, CH, QY, B, END, RIVER, PROM, inside } from './plan.js';

/*
  Where people walk in the Old Town, as plain line segments: down every pavement, along the
  middle of every lane and alley, round and across the squares, along the promenade and the
  quays (down the stairs to them), over the bridges, and zebra crossings at the junctions.
  The generator uses them to keep street furniture off the walking routes; a game can build its
  pedestrian graph from them (split each line where it meets another, link the pieces).
  Exported in data/oldtown-plan.json as walkLines / crossings.
*/

const WALK = (pave) => Math.min(1.6, pave / 2 - 0.05) + (pave > 4 ? 0.4 : 0); // walking line, in from the building line
const RING = 2.4;   // round a square, in from its edge
export const QUAY_LINE = { s: 25.2, n: 52.8 }; // along the quays (clear of the stairs against the walls)

/** The walking lines of the plan: { lines: [[x0, z0, x1, z1, y]], cross: [[x0, z0, x1, z1, y, group, wait0, wait1]] }. */
export function navLines(P) {
  const lines = [], cross = [], lanesL = [], sqCross = [];
  const L = (x0, z0, x1, z1, y = T, arr = lines) => { if (Math.hypot(x1 - x0, z1 - z0) > 0.3) arr.push([x0, z0, x1, z1, y]); };
  const gate = END - 14;
  // ---------- street pavements, stopping at each crossing carriageway; crosswalks over them ----------
  for (const s of P.streets) {
    const crossers = s.axis === 'z' ? P.zstreets : P.xstreets;
    for (const sd of [-1, 1]) {
      const S = sd < 0 ? s.n : s.p;
      const bl = sd < 0 ? s.lo : s.hi;
      const u = s.kind === 'embankment' && sd > 0 ? RIVER.z0 - 1.6 : bl - sd * WALK(S.pave);
      // stops: each crossing street's carriageway (its kerbs), the river for the bridging streets
      const stops = crossers.map((q) => [q.c - q.carr - 0.6, q.c + q.carr + 0.6]);
      if (s.axis === 'z') stops.push([RIVER.z0 - 0.5, RIVER.z1 + 0.5]);
      stops.sort((a, b) => a[0] - b[0]);
      let a = -gate;
      for (const [lo, hi] of stops) { if (lo > a) seg(s, u, a, lo); a = Math.max(a, hi); }
      seg(s, u, a, gate);
    }
  }
  function seg(s, u, a0, a1, y = T + CH) {
    if (s.axis === 'z') L(u, a0, u, a1, y); else L(a0, u, a1, u, y);
  }
  // zebras at every junction, one on each arm beyond the crossing carriageway: walkers go
  // from one of the arm street's walking lines to the other, waiting at its kerbs
  for (const J of P.junctions) {
    for (const [s, q] of [[J.xs, J.zs], [J.zs, J.xs]]) {
      const sLo = s.lo + WALK(s.n.pave), sHi = s.kind === 'embankment' ? RIVER.z0 - 1.6 : s.hi - WALK(s.p.pave);
      const u0 = s.c - s.carr - 0.7, u1 = s.c + s.carr + 0.7;
      const group = s.axis === 'z' ? 'x' : 'z'; // over a street running along z = walking along x
      for (const sd of [-1, 1]) {
        const a = q.c + sd * (q.carr + 0.6 + 1.5);
        if (s.axis === 'z') cross.push([sLo, a, sHi, a, T + CH, group, [u0, a], [u1, a]]);
        else cross.push([a, sLo, a, sHi, T + CH, group, [a, u0], [a, u1]]);
      }
    }
  }
  // ---------- the bridges: a walking line on each pavement, jogged onto the street's at both ends ----------
  for (const b of P.bridges) {
    if (b.kind === 'foot') { L(b.x, RIVER.z0 - 1.6, b.x, PROM.z0 + 2.6, T + CH); continue; }
    const s = b.street, pw = (b.w - 2 * b.carr) / 2;
    for (const sd of [-1, 1]) {
      const ub = s.c + sd * (s.carr + pw / 2), us = sd < 0 ? s.lo + WALK(s.n.pave) : s.hi - WALK(s.p.pave);
      L(ub, RIVER.z0 - 1.2, ub, RIVER.z1 + 1.2, T + CH);
      L(us, RIVER.z0 - 1.2, ub, RIVER.z0 - 1.2, T + CH);
      L(us, RIVER.z1 + 1.2, ub, RIVER.z1 + 1.2, T + CH);
    }
  }
  // ---------- the promenade: a line by the river, one by the houses, and across between the trees ----------
  for (const q of P.squares.filter((q) => q.kind === 'promenade')) {
    const n = Math.max(1, Math.round((q.x1 - q.x0) / 24));
    for (let i = 0; i <= n; i++) {
      const x = q.x0 + 3 + (q.x1 - q.x0 - 6) * i / n;
      L(x, 58.4, x, 66.1);
    }
    lanesL.push([q.x0, 58.4, q.x1, 58.4, T], [q.x0, 66.1, q.x1, 66.1, T]);
  }
  // plain zebras where the promenade crosses the bridging streets (no signal: cross = null)
  for (const s of P.xstreets) {
    const sLo = s.lo + WALK(s.n.pave), sHi = s.hi - WALK(s.p.pave);
    cross.push([sLo, 62, sHi, 62, T + CH, null]);
  }
  // ---------- squares: a ring inside the edge, cross lines between, kept off the landmarks ----------
  const obstacles = [...P.sites, ...(P.obstacles || [])].map((r) => ({ x0: r.x0 - 1.6, x1: r.x1 + 1.6, z0: r.z0 - 1.6, z1: r.z1 + 1.6 }));
  for (const q of P.squares) {
    if (q.kind === 'promenade' || q.kind === 'gate') continue;
    const x0 = q.x0 + RING, x1 = q.x1 - RING, z0 = q.z0 + RING, z1 = q.z1 - RING;
    for (const l of [[x0, z0, x1, z0], [x0, z1, x1, z1], [x0, z0, x0, z1], [x1, z0, x1, z1]]) for (const p of cut(l, obstacles)) L(...p);
    const W = q.x1 - q.x0, D = q.z1 - q.z0, nx = Math.max(1, Math.round(W / 16)), nz = Math.max(1, Math.round(D / 16));
    for (let i = 1; i < nx; i++) { const x = q.x0 + W * i / nx; for (const p of cut([x, q.z0, x, q.z1], obstacles)) sqCross.push([...p, T]); }
    for (let j = 1; j < nz; j++) { const z = q.z0 + D * j / nz; for (const p of cut([q.x0, z, q.x1, z], obstacles)) sqCross.push([...p, T]); }
  }
  // round the landmarks in the squares (and their obstacles): a ring just clear of each
  for (const o of obstacles) {
    if (!P.squares.some((q) => q.kind !== 'promenade' && q.kind !== 'gate' && inside(q, (o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2))) continue;
    for (const l of [[o.x0, o.z0, o.x1, o.z0], [o.x0, o.z1, o.x1, o.z1], [o.x0, o.z0, o.x0, o.z1], [o.x1, o.z0, o.x1, o.z1]]) L(...l);
  }
  // ---------- lanes and alleys: down the middle ----------
  for (const l of P.lanes) {
    if (l.axis === 'x') { const z = (l.z0 + l.z1) / 2; lanesL.push([l.x0, z, l.x1, z, T]); } else { const x = (l.x0 + l.x1) / 2; lanesL.push([x, l.z0, x, l.z1, T]); }
  }
  // ---------- quays, and the stairs down to them ----------
  for (const q of P.quays) {
    const z = q.side < 0 ? QUAY_LINE.s : QUAY_LINE.n;
    L(q.x0 + 0.6, z, q.x1 - 0.6, z, QY);
  }
  for (const st of P.stairs) {
    const zs = st.side < 0 ? st.z + 0.9 : st.z - 0.9, top = st.side < 0 ? T + CH : T;
    const zq = st.side < 0 ? QUAY_LINE.s : QUAY_LINE.n, zt = st.side < 0 ? RIVER.z0 - 1.6 : PROM.z0 + 2.4;
    const xt = st.x + st.dir * st.landing / 2, xb = st.x + st.dir * (st.len + 0.6);
    L(xt, zt, xt, zs, top);           // through the gap in the parapet onto the landing
    L(xt, zs, xb, zs, (top + QY) / 2); // down the flight
    L(xb, zs, xb, zq, QY);            // off onto the quay
  }

  // lanes and square cross lines run on to the nearest walking line beyond each end (up to 9 m)
  const all = [...lines, ...lanesL, ...sqCross];
  const extend = (l) => {
    const [x0, z0, x1, z1, y] = l;
    const alongX = Math.abs(z1 - z0) < 1e-6;
    const ends = alongX ? [[Math.min(x0, x1), z0, -1], [Math.max(x0, x1), z0, 1]] : [[x0, Math.min(z0, z1), -1], [x0, Math.max(z0, z1), 1]];
    let [a, b] = alongX ? [Math.min(x0, x1), Math.max(x0, x1)] : [Math.min(z0, z1), Math.max(z0, z1)];
    for (const [ex, ez, dir] of ends) {
      let best = Infinity;
      for (const m of all) {
        if (m === l || Math.abs(m[4] - y) > 0.3) continue;
        const mAlongX = Math.abs(m[3] - m[1]) < 1e-6, mAlongZ = Math.abs(m[2] - m[0]) < 1e-6;
        if (alongX && mAlongZ) {
          const x = m[0], d = (x - ex) * dir;
          if (d < -0.05 || d > 9 || ez < Math.min(m[1], m[3]) - 0.05 || ez > Math.max(m[1], m[3]) + 0.05) continue;
          best = Math.min(best, d);
        } else if (!alongX && mAlongX) {
          const z = m[1], d = (z - ez) * dir;
          if (d < -0.05 || d > 9 || ex < Math.min(m[0], m[2]) - 0.05 || ex > Math.max(m[0], m[2]) + 0.05) continue;
          best = Math.min(best, d);
        }
      }
      if (best < Infinity && best > 0.02) { if (dir < 0) a -= best; else b += best; }
    }
    return alongX ? [a, z0, b, z0, y] : [x0, a, x0, b, y];
  };
  for (const l of lanesL) lines.push(extend(l));
  for (const l of sqCross) lines.push(extend(l));
  return { lines, cross };
}

/** Segment [x0, z0, x1, z1] (axis-aligned) minus the rects. */
function cut(l, rects) {
  let parts = [l];
  for (const r of rects) {
    const next = [];
    for (const [x0, z0, x1, z1] of parts) {
      const alongX = Math.abs(z1 - z0) < 1e-6;
      const a0 = Math.min(alongX ? x0 : z0, alongX ? x1 : z1), a1 = Math.max(alongX ? x0 : z0, alongX ? x1 : z1);
      const c = alongX ? z0 : x0, [r0, r1] = alongX ? [r.x0, r.x1] : [r.z0, r.z1], [c0, c1] = alongX ? [r.z0, r.z1] : [r.x0, r.x1];
      if (c <= c0 || c >= c1 || r1 <= a0 || r0 >= a1) { next.push([x0, z0, x1, z1]); continue; }
      const mk = (p, q) => (alongX ? [p, c, q, c] : [c, p, c, q]);
      if (r0 > a0 + 0.3) next.push(mk(a0, r0));
      if (r1 < a1 - 0.3) next.push(mk(r1, a1));
    }
    parts = next;
  }
  return parts;
}

