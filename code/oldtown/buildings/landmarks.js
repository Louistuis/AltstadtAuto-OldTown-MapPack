import * as THREE from 'three';
import { addSolid, addCyl } from '../../engine/collision.js';
import { rng } from '../../engine/rng.js';
import { Frame, beginBody, endBody, shadeCol, CTX } from './merge.js';
import { roofEnvelope, emitRoof } from './roof.js';
import { backFrame, pane, AWNINGS } from './kit.js';
import { buildSingle, paneFrame } from './house.js';

/*
  The landmarks (all invented): a Gothic cathedral - nave and aisles, flying buttresses with
  pinnacles, a polygonal apse, a transept with roses, a west front of two towers with copper
  spires, a rose window and a portal of stepped archivolts; an iron-and-glass market hall on
  cast-iron columns between brick end walls with great lunettes; and a town hall (the house
  grammar at civic scale: arcade, piano nobile, balustrade) under a clock tower with gold
  faces, an open belfry and a copper dome. A site is { kind, x0, x1, z0, z1, base, front }.
*/

const NORMAL = { zp: [0, 1], xp: [1, 0], zn: [0, -1], xn: [-1, 0] };
const SIDE_PTS = {
  zp: (l) => [[l.x0, l.z1], [l.x1, l.z1]], xp: (l) => [[l.x1, l.z1], [l.x1, l.z0]],
  zn: (l) => [[l.x1, l.z0], [l.x0, l.z0]], xn: (l) => [[l.x0, l.z0], [l.x0, l.z1]],
};
const M4 = (x, y, z, sx, sy, sz, ry = 0, rx = 0) => {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ'));
  m.scale(new THREE.Vector3(sx, sy, sz)); m.setPosition(x, y, z);
  return m;
};
const PI = Math.PI;

/**
 * The site in local (s, y, t): s along the front from its left end (seen from outside), t in
 * from the front line. Frames for the front, sections across, and the long sides.
 */
function siteGeom(site) {
  const f = NORMAL[site.front] ? site.front : 'zp';
  const [nx, nz] = NORMAL[f];
  const [a, b] = SIDE_PTS[f](site);
  const W = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const D = f === 'zp' || f === 'zn' ? site.z1 - site.z0 : site.x1 - site.x0;
  const F0 = new Frame(a[0], a[1], nx, nz, W);
  const g = {
    W, D, F0, base: site.base || 0,
    P: (s, y, t) => F0.P(s, y, -t),
    /** across the site at depth t, facing the front (u = s, w = toward the front) */
    sec: (t) => F0.shifted(0, -t, W),
    /** the back of a section: facing away from the front, u = W - s */
    back: (t) => backFrame(F0, W, -t),
    /** a long wall at s facing out left (u from t1 back toward t0) */
    left: (s, t0, t1) => { const [x, , z] = F0.P(s, 0, -t1); return new Frame(x, z, -F0.ux, -F0.uz, t1 - t0); },
    /** a long wall at s facing out right (u from t0 in toward t1) */
    right: (s, t0, t1) => { const [x, , z] = F0.P(s, 0, -t0); return new Frame(x, z, F0.ux, F0.uz, t1 - t0); },
    /** world rectangle [x0, x1, z0, z1] of a local one */
    rect: (s0, s1, t0, t1) => {
      const p = F0.P(s0, 0, -t0), q = F0.P(s1, 0, -t1);
      return [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[2], q[2]), Math.max(p[2], q[2])];
    },
    /** footprint polygon (counter-clockwise from above) of a local rectangle */
    poly: (s0, s1, t0, t1) => [[s0, t0], [s1, t0], [s1, t1], [s0, t1]].map(([s, t]) => { const p = F0.P(s, 0, -t); return [p[0], p[2]]; }),
  };
  return g;
}

/** A prism: convex outline [[u, y]...] in F's plane from w0 back to w1 front (front, back, sides). */
function slab(F, L, pts, w0, w1, col) {
  L.poly(pts.map(([u, y]) => F.P(u, y, w1)), col, F.dir(0, 0, 1));
  L.poly(pts.map(([u, y]) => F.P(u, y, w0)), col, F.dir(0, 0, -1));
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const cu = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    L.quad(F.P(a[0], a[1], w0), F.P(b[0], b[1], w0), F.P(b[0], b[1], w1), F.P(a[0], a[1], w1), col, F.dir((a[0] + b[0]) / 2 - cu, (a[1] + b[1]) / 2 - cy, 0));
  }
}

/**
 * An opening of any convex outline (CCW in (u, y)) cut as its bounding rectangle: the wall's
 * hole is the rect (returned), the corners between rect and outline are filled at wf, the
 * outline's skin runs back to wb, and the pane (GL) closes it there.
 */
function opening(F, L, outline, c, wf, wb, col, GL, gcol) {
  const us = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
  const r = { u0: Math.min(...us), u1: Math.max(...us), y0: Math.min(...ys), y1: Math.max(...ys) };
  const corners = [[r.u0, r.y1, -1, 1], [r.u1, r.y1, 1, 1], [r.u1, r.y0, 1, -1], [r.u0, r.y0, -1, -1]];
  for (const [cu, cy, su, sy] of corners) {
    const chain = outline.filter(([u, y]) => (u - c[0]) * su >= -1e-6 && (y - c[1]) * sy >= -1e-6)
      .sort((p, q) => Math.atan2(p[1] - c[1], p[0] - c[0]) - Math.atan2(q[1] - c[1], q[0] - c[0]));
    for (let i = 0; i < chain.length - 1; i++) {
      L.poly([F.P(cu, cy, wf), F.P(chain[i][0], chain[i][1], wf), F.P(chain[i + 1][0], chain[i + 1][1], wf)], col, F.dir(0, 0, 1));
    }
  }
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    L.quad(F.P(a[0], a[1], wf), F.P(b[0], b[1], wf), F.P(b[0], b[1], wb), F.P(a[0], a[1], wb), col, F.dir(c[0] - (a[0] + b[0]) / 2, c[1] - (a[1] + b[1]) / 2, 0));
  }
  if (GL) GL.poly(outline.map(([u, y]) => F.P(u, y, wb)), gcol, F.dir(0, 0, 1));
  return r;
}
/** Outline of a pointed (equilateral-ish, k = radius / span) arch window u0..u1 from y0 springing at ys. */
function pointedOutline(u0, u1, y0, ys, k = 1, n = 6) {
  const pts = Frame.archPts(u0, u1, ys, (u1 - u0) * k, n);
  return [[u0, y0], [u1, y0], ...pts.slice().reverse()];
}
const roundOutline = (u0, u1, y0, ys, n = 8) => [[u0, y0], [u1, y0], ...Frame.archPts(u0, u1, ys, (u1 - u0) / 2, n).reverse()];
const circleOutline = (cu, cy, r, n = 20) => Array.from({ length: n }, (_, i) => [cu + r * Math.cos(2 * PI * i / n), cy + r * Math.sin(2 * PI * i / n)]);

/** A Gothic window in F (hole returned for the wall, dressing done after): stained glass, mullions, a hood mould. */
function gothicWindow(B, F, u0, u1, y0, ys, d, col, jobs, opts = {}) {
  const { L } = B;
  const outline = pointedOutline(u0, u1, y0, ys, opts.k ?? 0.85);
  const crown = Math.max(...outline.map((p) => p[1]));
  const hole = { u0, u1, y0, y1: crown };
  jobs.push(() => {
    opening(F, opts.WL || L.stone, outline, [(u0 + u1) / 2, ys], 0, -d, shadeCol(col, 0.85), opts.GL || L.stainedGlass, opts.gcol ?? 0xffffff);
    const span = u1 - u0, mid = (u0 + u1) / 2, R = span * (opts.k ?? 0.85);
    // hood mould round the head
    const a = Math.acos((mid - (u0 + R)) / R);
    F.ring(L.stone, u0 + R, ys, R + 0.02, R + 0.2, a, PI, 0, 0.1, col, 6, 'fo');
    F.ring(L.stone, u1 - R, ys, R + 0.02, R + 0.2, 0, PI - a, 0, 0.1, col, 6, 'fo');
    // tracery: mullions, two lancet heads and a roundel
    if (span > 1.4) {
      const n = span > 3 ? 3 : 2, w = -d + 0.12;
      for (let i = 1; i < n; i++) F.box(L.stone, u0 + span * i / n - 0.07, u0 + span * i / n + 0.07, y0, ys + 0.1, w - 0.12, w, col, 'b');
      for (let i = 0; i < n; i++) {
        const a0 = u0 + span * i / n, a1 = a0 + span / n, rr = (a1 - a0) * 0.85, m = (a0 + a1) / 2;
        const t = Math.acos((m - (a0 + rr)) / rr);
        F.ring(L.stone, a0 + rr, ys + 0.1, rr - 0.12, rr, t, PI, w - 0.12, w, col, 5, 'fo');
        F.ring(L.stone, a1 - rr, ys + 0.1, rr - 0.12, rr, 0, PI - t, w - 0.12, w, col, 5, 'fo');
      }
      const rr = span * 0.2;
      F.ring(L.stone, mid, ys + span * 0.55, rr - 0.1, rr, 0, 2 * PI, w - 0.12, w, col, 12, 'foi');
    }
    F.box(L.stone, u0 - 0.15, u1 + 0.15, y0 - 0.2, y0, 0, 0.18, col, 'b');
  });
  return hole;
}

/** A pinnacle: a little square shaft and a steep pyramid with a finial, at world (x, z) from y. */
function pinnacle(B, x, z, y, s, h, col) {
  const { L } = B;
  const F = new Frame(x - s / 2, z + s / 2, 0, 1, s);
  F.box(L.stone, 0, s, y, y + h * 0.4, -s, 0, col, 'd');
  const pts = [[x - s / 2, z + s / 2], [x + s / 2, z + s / 2], [x + s / 2, z - s / 2], [x - s / 2, z - s / 2]];
  const env = roofEnvelope(pts, pts.map((_, e) => ({ e, k: (h * 0.6) / (s / 2), off: 0, L: L.stone, col })), y + h * 0.4);
  emitRoof(env);
  L.gold.geo(B.G.ball, M4(x, y + h + 0.08, z, 0.18, 0.18, 0.18), 0xffffff);
}

/** A rose window at (cu, cy) radius r in F: filled corners, deep skin, stained glass, stone tracery. */
function rose(B, F, cu, cy, r, d, col, jobs) {
  const { L } = B;
  const outline = circleOutline(cu, cy, r, 24);
  jobs.push(() => {
    opening(F, L.stone, outline, [cu, cy], 0, -d, shadeCol(col, 0.85), L.stainedGlass, 0xffffff);
    const w = -d + 0.2;
    F.ring(L.stone, cu, cy, r, r + 0.45, 0, 2 * PI, 0, 0.18, col, 24, 'fo');
    F.ring(L.stone, cu, cy, r * 0.16, r * 0.3, 0, 2 * PI, w - 0.2, w, col, 12, 'foi');
    F.ring(L.stone, cu, cy, r * 0.93, r, 0, 2 * PI, w - 0.2, w, col, 24, 'fi');
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = 2 * PI * i / n, ca = Math.cos(a), sa = Math.sin(a);
      const p0 = [cu + ca * r * 0.3, cy + sa * r * 0.3], p1 = [cu + ca * r * 0.95, cy + sa * r * 0.95];
      slab(F, L.stone, [[p0[0] - sa * 0.06, p0[1] + ca * 0.06], [p0[0] + sa * 0.06, p0[1] - ca * 0.06], [p1[0] + sa * 0.06, p1[1] - ca * 0.06], [p1[0] - sa * 0.06, p1[1] + ca * 0.06]], w - 0.18, w, col);
      const b = a + PI / n, pr = r * 0.17;
      F.ring(L.stone, cu + Math.cos(b) * r * 0.7, cy + Math.sin(b) * r * 0.7, pr - 0.07, pr, 0, 2 * PI, w - 0.18, w, col, 8, 'fo');
    }
  });
  return { u0: cu - r, u1: cu + r, y0: cy - r, y1: cy + r };
}

// ---------- the cathedral ----------
export function buildCathedral(B, site) {
  const { L, N } = B;
  const g = siteGeom(site);
  const { W, D, base } = g;
  const r = rng(91 + Math.round(site.x0 * 7 + site.z0 * 13));
  const sc = 0xf4e8d6, dark = shadeCol(sc, 0.82); // warm limestone
  const Ts = Math.min(11, Math.max(7, W * 0.27)), Bt = 1.3; // tower side (= aisle bay), buttress depth
  const N0 = Ts, N1 = W - Ts, Nw = N1 - N0;
  const Hn = Math.min(28, Math.max(20, Nw * 1.35)), Ha = Hn * 0.46;
  const apseR = Nw / 2, tEnd = D - apseR - 0.5;
  const hasT = D > 55;
  const tT0 = hasT ? tEnd - Nw - 6 : 0, tT1 = tT0 + Nw;
  const bl = 6.4;
  const [cx, , cz] = g.P(W / 2, 0, D / 2);
  beginBody(cx, cz, null, () => 1);
  B.site.anchorAt(cx, cz);
  const jobs = [];

  // west front between the towers: portal, gallery, rose; the gable above comes with the roof
  const Fw = g.sec(0);
  const pw = Nw * 0.3, ph = Nw * 0.3, K = 4, step = 0.32;
  const pu0 = W / 2 - pw / 2, pu1 = W / 2 + pw / 2, pys = base + ph;
  const E = K * step + 0.35;
  // the archivolts are concentric (one centre per side, the inner arch's); the opening is the
  // outermost one's own outline, so no gap shows between them
  const Rin = (pw + 0.7) * 0.85, cL = pu0 - 0.35 + Rin, cR = pu1 + 0.35 - Rin;
  const portalOut = pointedOutline(pu0 - E, pu1 + E, base, pys, (Rin + E - 0.35) / (pw + 2 * E), 7);
  const holes = [];
  const pr = opening(Fw, L.stone, portalOut, [W / 2, pys], 0, 0, sc, null); // corner fills only (no skin: the steps are the skin)
  holes.push(pr);
  // the rose fills what is left between the portal's gable and the eaves
  const crown = Math.max(...portalOut.map((p) => p[1])), wy = crown + 0.2;
  const rr = Math.max(2, Math.min(Nw * 0.32, (base + Hn - 1.4 - (wy + 2.9)) / 2)), rcy = base + Hn - 1.4 - rr;
  holes.push(rose(B, Fw, W / 2, rcy, rr, 0.9, sc, jobs));
  Fw.wall(L.stone, N0, N1, base, base + Hn, holes, sc);
  for (const j of jobs.splice(0)) j();
  // the portal's stepped jambs and archivolts, the doors and the tympanum
  for (let k = 0; k < K; k++) {
    const e = (K - k) * step + 0.35, e1 = (K - k - 1) * step + 0.35, w0 = -(k + 1) * 0.4, w1 = -k * 0.4;
    for (const s of [-1, 1]) {
      const ua = s < 0 ? pu0 - E : pu1 + e1, ub = s < 0 ? pu0 - e1 : pu1 + E;
      Fw.box(L.stone, ua, ub, base, pys, w0, w1, sc, 'b');
      // a colonnette in each step
      const cu = s < 0 ? pu0 - e1 - 0.14 : pu1 + e1 + 0.14;
      const [x, , z] = Fw.P(cu, 0, w1 + 0.05);
      L.stone.geo(B.G.col, M4(x, base + 0.4 + (pys - base - 0.8) / 2, z, 0.2, pys - base - 0.8, 0.2), sc);
    }
    const R = Rin + e1 - 0.35, R2 = R + step;
    const a = Math.acos(((pu0 + pu1) / 2 - cL) / R), a2 = Math.acos(((pu0 + pu1) / 2 - cL) / R2);
    Fw.ring(L.stone, cL, pys, R, R2, a, PI, w0, w1, k % 2 ? sc : dark, 7, 'fi');
    Fw.ring(L.stone, cR, pys, R, R2, 0, PI - a, w0, w1, k % 2 ? sc : dark, 7, 'fi');
    // the step's front face round the arch (to the outer edge's own crown)
    Fw.ring(L.stone, cL, pys, R, R2, a2, PI, w1 - 0.01, w1, sc, 7, 'f');
    Fw.ring(L.stone, cR, pys, R, R2, 0, PI - a2, w1 - 0.01, w1, sc, 7, 'f');
  }
  const wd = -K * 0.4;
  const inner = pointedOutline(pu0 - 0.35, pu1 + 0.35, base, pys, 0.85);
  L.stone.poly(inner.map(([u, y]) => Fw.P(u, y, wd)), dark, Fw.dir(0, 0, 1));
  Fw.face(L.door, pu0 + 0.1, pu1 - 0.1, base, pys - 0.6, wd + 0.02, 0x4a2e1c);
  Fw.box(L.stone, pu0 - 0.35, pu1 + 0.35, pys - 0.6, pys - 0.2, wd, wd + 0.25, sc, 'b');
  Fw.box(L.stone, W / 2 - 0.25, W / 2 + 0.25, base, pys - 0.6, wd, wd + 0.3, sc, 'b'); // trumeau
  for (let i = 0; i < 6; i++) Fw.inst(N.iron, pu0 + 0.4 + i * (pw - 0.8) / 5, base + 1.2 + (i % 2) * 1.6, wd + 0.02, 0.5, 0.06, 0.03, 0x1e1f21);
  // a gable (wimperg) over the portal, a gallery of blind arches between portal and rose
  slab(Fw, L.stone, [[pu0 - E - 0.3, wy - 2.2], [pu1 + E + 0.3, wy - 2.2], [W / 2, wy + 2.6]], 0, 0.5, sc);
  const ga = wy + 3.0, gn = Math.max(5, Math.round(Nw / 1.6));
  for (let i = 0; i < gn; i++) {
    const a0 = N0 + 0.6 + i * (Nw - 1.2) / gn, a1 = a0 + (Nw - 1.2) / gn - 0.25;
    if (ga + 2.5 > rcy - rr - 0.6) break;
    Fw.ring(L.stone, (a0 + a1) / 2, ga + 1.6, (a1 - a0) / 2 - 0.1, (a1 - a0) / 2, 0, PI, 0, 0.12, sc, 6, 'fo');
    Fw.box(L.stone, a0, a0 + 0.12, ga, ga + 1.6, 0, 0.12, sc, 'b');
    Fw.inst(N.stone, (a0 + a1) / 2, ga + 0.75, 0, 0.32, 1.3, 0.3, dark); // a statue in each
  }
  if (ga + 2.5 <= rcy - rr - 0.6) Fw.box(L.stone, N0, N1, ga - 0.25, ga, 0, 0.3, sc, 'b');
  // the wimperg: crockets up both rakes and a finial
  {
    const ax = pu0 - E - 0.3, bx_ = pu1 + E + 0.3, y0 = wy - 2.2, top = wy + 2.6, n = 5;
    for (const [u0, u1] of [[ax, W / 2], [bx_, W / 2]]) for (let i = 1; i < n; i++) {
      const t = i / n, u = u0 + (u1 - u0) * t, y = y0 + (top - y0) * t;
      Fw.inst(N.stone, u, y + 0.12, 0.3, 0.22, 0.24, 0.3, sc);
    }
    // a blind roundel in the wimperg and one in the tympanum, each with a quatrefoil of oculi
    const roundel = (cy, rad, w) => {
      Fw.ring(L.stone, W / 2, cy, rad, rad + 0.14, 0, 2 * PI, w, w + 0.12, sc, 16, 'fo');
      slab(Fw, L.stone, circleOutline(W / 2, cy, rad, 16), w, w + 0.02, shadeCol(sc, 0.62));
      for (let q = 0; q < 4; q++) {
        const a = PI / 4 + q * PI / 2, rr2 = rad * 0.36;
        Fw.ring(L.stone, W / 2 + Math.cos(a) * rad * 0.5, cy + Math.sin(a) * rad * 0.5, rr2, rr2 + 0.06, 0, 2 * PI, w + 0.02, w + 0.08, sc, 10, 'fo');
      }
    };
    roundel(y0 + (top - y0) * 0.36, Math.min(1.1, (top - y0) * 0.2), 0.5);
    roundel(pys + 1.4, Math.min(1.0, pw * 0.2), wd);
    const [fx, , fz] = Fw.P(W / 2, 0, 0.25);
    pinnacle(B, fx, fz, top - 0.2, 0.45, 2.2, sc);
  }
  // the gable over the front: three blind lancets (the middle one tallest) on a sill course
  {
    const kk = Math.tan(57 * PI / 180), gy = base + Hn + 0.9, half = Nw / 2;
    Fw.box(L.stone, N0 + 0.4, N1 - 0.4, gy - 0.35, gy - 0.1, 0, 0.25, sc, 'b');
    const lw = Math.min(1.5, Nw / 9);
    for (const i of [-1, 0, 1]) {
      const u = W / 2 + i * lw * 1.55, room = (half - Math.abs(u - W / 2) - lw / 2) * kk - 1.6;
      const ys = gy + Math.max(1.2, room - lw * 0.9);
      if (room < 2.2) continue;
      slab(Fw, L.stone, pointedOutline(u - lw / 2 - 0.16, u + lw / 2 + 0.16, gy, ys, 0.85, 5), 0, 0.12, sc);
      slab(Fw, L.stone, pointedOutline(u - lw / 2, u + lw / 2, gy + 0.08, ys, 0.85, 5), 0, 0.13, shadeCol(sc, 0.6));
    }
  }

  // towers: shafts with angle buttresses, string courses, lancets, a belfry, spires
  const Ht = Hn + 15;
  for (const s0 of [0.2, W - Ts - 0.2 + 0.2]) {
    const sA = s0 === 0.2 ? 0.2 : W - Ts, sB = sA + Ts - 0.2;
    westTower(B, g, sA, sB, 0, Ts - 0.2, base, Ht, sc, dark, r);
  }

  // nave (clerestory), aisles with buttresses and flyers, transept, apse
  const segs = hasT ? [[Ts, tT0], [tT1, tEnd]] : [[Ts, tEnd]];
  for (const [ta, tb] of segs) {
    const nb = Math.max(1, Math.round((tb - ta) / bl)), bw = (tb - ta) / nb;
    for (const side of ['left', 'right']) {
      const sOut = side === 'left' ? Bt : W - Bt, sIn = side === 'left' ? N0 : N1;
      const Fa = side === 'left' ? g.left(sOut, ta, tb) : g.right(sOut, ta, tb);
      const Fc = side === 'left' ? g.left(sIn, ta, tb) : g.right(sIn, ta, tb);
      const tOf = (u) => (side === 'left' ? tb - u : ta + u);
      const ah = [], ch = [], aj = [], cj = [];
      for (let i = 0; i < nb; i++) {
        const u = (i + 0.5) * bw;
        ah.push(gothicWindow(B, Fa, u - bw * 0.22, u + bw * 0.22, base + 2.6, base + Ha - 2.2 - bw * 0.36, 0.5, sc, aj));
        ch.push(gothicWindow(B, Fc, u - bw * 0.23, u + bw * 0.23, base + Ha + 4.8, base + Hn - 1.6 - bw * 0.39, 0.4, sc, cj));
      }
      Fa.wall(L.stone, 0, tb - ta, base, base + Ha, ah, sc);
      Fc.wall(L.stone, 0, tb - ta, base + Ha, base + Hn, ch, sc);
      for (const j of [...aj, ...cj]) j();
      Fa.profile(L.stone, 0, tb - ta, [[0, base + Ha - 0.4], [0.3, base + Ha - 0.35], [0.35, base + Ha], [0, base + Ha]], sc);
      Fc.profile(L.stone, 0, tb - ta, [[0, base + Hn - 0.5], [0.4, base + Hn - 0.4], [0.5, base + Hn], [0, base + Hn]], sc);
      Fa.box(L.stone, 0, tb - ta, base, base + 0.8, 0, 0.18, dark, 'b');
      // buttresses between the bays, each with a pinnacle and a flyer to the clerestory
      for (let i = 0; i <= nb; i++) {
        const u = i * bw, t = tOf(u);
        if ((i === 0 && ta === Ts) || (hasT && ((i === nb && tb === tT0) || (i === 0 && ta === tT1)))) continue;
        for (const [y0, y1, dd] of [[0, Ha * 0.45, Bt], [Ha * 0.45, Ha * 0.8, Bt * 0.75], [Ha * 0.8, Ha + 1.6, Bt * 0.5]]) {
          Fa.box(L.stone, u - 0.55, u + 0.55, base + y0, base + y1, 0, dd, sc, 'b');
          Fa.hface(L.stone, u - 0.55, u + 0.55, 0, dd, base + y1, sc, 1);
        }
        const [px, , pz] = Fa.P(u, 0, Bt * 0.25);
        pinnacle(B, px, pz, base + Ha + 1.6, 0.8, 4.2, sc);
        const S = g.sec(t);
        const sx = side === 'left' ? Bt * 0.3 : W - Bt * 0.3;
        const fl = side === 'left'
          ? [[sx, base + Ha + 0.6], [sx, base + Ha + 1.5], [sIn, base + Hn - 2.2], [sIn, base + Hn - 4.2]]
          : [[sIn, base + Hn - 4.2], [sIn, base + Hn - 2.2], [sx, base + Ha + 1.5], [sx, base + Ha + 0.6]];
        slab(S, L.stone, fl, -0.3, 0.3, sc);
      }
    }
  }
  // aisle lean-to roofs, nave roof (gabled at the west front), transept, apse
  const RL = L.slate, rc = 0xd8dce2, k = Math.tan(57 * PI / 180);
  const env = [];
  for (const [ta, tb] of segs) {
    const polyL = g.poly(Bt, N0, ta, tb), polyR = g.poly(N1, W - Bt, ta, tb);
    env.push(roofEnvelope(polyL, [{ e: 3, k: Math.tan(24 * PI / 180), off: 0, L: L.zinc, col: 0xc8ccd0 }], base + Ha));
    env.push(roofEnvelope(polyR, [{ e: 1, k: Math.tan(24 * PI / 180), off: 0, L: L.zinc, col: 0xc8ccd0 }], base + Ha));
  }
  const nave = roofEnvelope(g.poly(N0, N1, 0, tEnd), [{ e: 1, k, off: 0, L: RL, col: rc }, { e: 3, k, off: 0, L: RL, col: rc }], base + Hn);
  env.push(nave);
  for (const e of env) emitRoof(e, L.stone, sc);
  // the west gable's coping and a gold finial
  const ridge = base + Hn + Nw / 2 * k;
  for (const [a, b] of [[[N0, base + Hn], [W / 2, ridge]], [[W / 2, ridge], [N1, base + Hn]]]) {
    const du = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(du, dy), pu = -dy / l * 0.25, py = du / l * 0.25;
    slab(Fw, L.stone, [[a[0] - pu, a[1] - py], [b[0] - pu, b[1] - py], [b[0] + pu, b[1] + py], [a[0] + pu, a[1] + py]], -0.2, 0.3, sc);
  }
  { const [x, , z] = g.P(W / 2, 0, 0); L.gold.geo(B.G.cone, M4(x, ridge + 1.4, z, 0.25, 2.4, 0.25), 0xffffff); L.gold.geo(B.G.ball, M4(x, ridge + 0.3, z, 0.5, 0.5, 0.5), 0xffffff); }
  // transept: arms out to the site edges, a rose and a door in each end, its own roof
  if (hasT) {
    for (const side of ['left', 'right']) {
      const sE = side === 'left' ? 0.3 : W - 0.3;
      const Ft = side === 'left' ? g.left(sE, tT0, tT1) : g.right(sE, tT0, tT1);
      const tj = [], th = [];
      th.push(rose(B, Ft, Nw / 2, base + Hn - Nw * 0.28 - 2, Nw * 0.26, 0.8, sc, tj));
      th.push(gothicWindow(B, Ft, Nw / 2 - 1.6, Nw / 2 + 1.6, base, base + 4.2, 0.6, sc, tj, { GL: L.door, gcol: 0x4a2e1c, k: 0.75 }));
      Ft.wall(L.stone, 0, Nw, base, base + Hn, th, sc);
      for (const j of tj) j();
      Ft.profile(L.stone, 0, Nw, [[0, base + Hn - 0.5], [0.4, base + Hn - 0.4], [0.5, base + Hn], [0, base + Hn]], sc);
      // the arm's side walls (front and back faces of the arm, outside the aisles)
      const sA = side === 'left' ? 0.3 : W - Bt, sB = side === 'left' ? Bt : W - 0.3;
      g.sec(tT0).face(L.stone, sA, sB, base, base + Hn, 0, sc);
      g.back(tT1).face(L.stone, W - sB, W - sA, base, base + Hn, 0, sc);
      for (const u of [0.6, Nw - 0.6]) {
        const [px, , pz] = Ft.P(u, 0, 0.4);
        pinnacle(B, px, pz, base + Hn, 1.0, 6, sc);
        Ft.box(L.stone, u - 0.6, u + 0.6, base, base + Hn, 0, 0.9, sc, 'b');
      }
    }
    // the arms' walls between aisle roof and clerestory, inside the aisle bays
    for (const [s0, s1] of [[Bt, N0], [N1, W - Bt]]) {
      g.sec(tT0).face(L.stone, s0, s1, base + Ha, base + Hn, 0, sc);
      g.back(tT1).face(L.stone, W - s1, W - s0, base + Ha, base + Hn, 0, sc);
    }
    const tr = roofEnvelope(g.poly(0.3, W - 0.3, tT0, tT1), [{ e: 0, k, off: 0, L: RL, col: rc }, { e: 2, k, off: 0, L: RL, col: rc }], base + Hn);
    emitRoof(tr, L.stone, sc);
    // a slender copper flèche over the crossing
    const [fx, , fz] = g.P(W / 2, 0, (tT0 + tT1) / 2);
    const fr = 1.6, fy = ridge - 0.5;
    const oct = Array.from({ length: 8 }, (_, i) => { const a = -i * PI / 4 + PI / 8; return [fx + fr * Math.cos(a), fz + fr * Math.sin(a)]; });
    for (let i = 0; i < 8; i++) {
      const a = oct[i], b = oct[(i + 1) % 8], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz);
      const F = new Frame(a[0], a[1], -tz / l, tx / l, l);
      F.wall(L.copper, 0, l, fy, fy + 4, [{ u0: l * 0.3, u1: l * 0.7, y0: fy + 1, y1: fy + 3.2 }], 0xffffff);
      F.face(L.iron, l * 0.3, l * 0.7, fy + 1, fy + 3.2, -0.3, 0x202020);
    }
    emitRoof(roofEnvelope(oct, oct.map((_, e) => ({ e, k: 14 / fr, off: 0, L: L.copper, col: 0xffffff })), fy + 4));
    L.gold.geo(B.G.ball, M4(fx, fy + 18.3, fz, 0.4, 0.4, 0.4), 0xffffff);
  }
  // apse: a half-decagon round the east end, tall windows between buttresses, a half-cone roof
  const [ax, , az] = g.P(W / 2, 0, tEnd);
  const nf = 5, apts = [];
  for (let i = 0; i <= nf; i++) {
    const a = PI * i / nf;
    // from the right side round the far end to the left (counter-clockwise from above)
    const p = g.P(W / 2 + apseR * Math.cos(a), 0, tEnd + apseR * Math.sin(a));
    apts.push([p[0], p[2]]);
  }
  const apoly = apts.slice();
  if (area2(apoly) < 0) apoly.reverse();
  for (let i = 0; i < apoly.length - 1; i++) {
    const a = apoly[i], b = apoly[i + 1], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz);
    const F = new Frame(a[0], a[1], -tz / l, tx / l, l);
    // skip the chord (the edge back along the nave end)
    if (Math.abs(((a[0] + b[0]) / 2 - ax) * F.nx + ((a[1] + b[1]) / 2 - az) * F.nz) < 0.2) continue;
    const aj = [];
    const h = gothicWindow(B, F, l * 0.28, l * 0.72, base + 3, base + Hn - 3 - l * 0.38, 0.5, sc, aj);
    F.wall(L.stone, 0, l, base, base + Hn, [h], sc);
    for (const j of aj) j();
    F.profile(L.stone, 0, l, [[0, base + Hn - 0.5], [0.4, base + Hn - 0.4], [0.5, base + Hn], [0, base + Hn]], sc, Math.tan(PI / nf / 2), Math.tan(PI / nf / 2));
    F.box(L.stone, -0.5, 0.5, base, base + Hn - 3, 0, 1.4, sc, 'b');
    const [px, , pz] = F.P(0, 0, 0.7);
    pinnacle(B, px, pz, base + Hn - 3, 1.0, 5, sc);
  }
  const ae = roofEnvelope(apoly, apoly.map((_, e) => ({ e, k, off: 0, L: RL, col: rc })).filter((p) => {
    const a = apoly[p.e], b = apoly[(p.e + 1) % apoly.length];
    return Math.abs(((a[0] + b[0]) / 2 - ax) * (b[1] - a[1]) - ((a[1] + b[1]) / 2 - az) * (b[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.2;
  }), base + Hn);
  emitRoof(ae, L.stone, sc);
  // collision: west front (the portal recess open), towers, nave and aisles, transept, apse
  const col = B.colliders;
  const box = (s0, s1, t0, t1, h) => { const q = g.rect(s0, s1, t0, t1); addSolid(col, q[0], q[1], q[2], q[3], base, base + h, { cam: true }); };
  box(0.2, Ts, 0, Ts, Ht); box(W - Ts, W - 0.2, 0, Ts, Ht);
  box(N0, N1, K * 0.4 + 0.1, Ts, Hn);
  box(Bt, W - Bt, Ts, tEnd, Ha);
  box(N0, N1, Ts, tEnd, Hn);
  if (hasT) box(0.3, W - 0.3, tT0, tT1, Hn);
  box(W / 2 - apseR * 0.9, W / 2 + apseR * 0.9, tEnd, tEnd + apseR * 0.9, Hn);
  B.site.anchorOff();
  endBody();
}
function area2(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return -s; }

/** One west tower: square shaft s0..s1 x t0..t1, angle buttresses, stages, belfry, octagonal copper spire. */
function westTower(B, g, s0, s1, t0, t1, base, Ht, sc, dark, r) {
  const { L, N } = B;
  const T = s1 - s0;
  const pts = [[s0, t0], [s1, t0], [s1, t1], [s0, t1]].map(([s, t]) => { const p = g.P(s, 0, t); return [p[0], p[2]]; });
  const stages = [0, Ht * 0.3, Ht * 0.56, Ht * 0.78, Ht];
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz);
    const F = new Frame(a[0], a[1], -tz / l, tx / l, l);
    const holes = [], jobs = [];
    // a lancet in the middle stages, a pair of tall belfry openings at the top
    for (const k of [1, 2]) {
      const y0 = base + stages[k] + 1.5, y1 = base + stages[k + 1] - 1.6;
      holes.push(gothicWindow(B, F, l / 2 - 0.6, l / 2 + 0.6, y0, y1 - 1.2, 0.5, sc, jobs, { GL: L.glass, gcol: 0x9aa4ac }));
    }
    for (const u of [l * 0.3, l * 0.7]) {
      const y0 = base + stages[3] + 1.2, ys = base + stages[4] - 2.6;
      holes.push(gothicWindow(B, F, u - 0.75, u + 0.75, y0, ys, 0.9, sc, jobs, { GL: L.iron, gcol: 0x2a2a2a }));
      for (let k = 0; k < 9; k++) F.inst(N.timber, u, y0 + 0.4 + k * (ys - y0 - 0.4) / 9, -0.5, 1.4, 0.04, 0.22, 0xffffff, 0.6);
    }
    F.wall(L.stone, 0, l, base, base + Ht, holes, sc);
    for (const j of jobs) j();
    for (const k of [1, 2, 3]) F.profile(L.stone, 0, l, [[0, base + stages[k] - 0.3], [0.25, base + stages[k] - 0.25], [0.3, base + stages[k]], [0, base + stages[k] + 0.1]], sc, 1, 1);
    F.profile(L.stone, 0, l, [[0, base + Ht - 0.6], [0.5, base + Ht - 0.5], [0.6, base + Ht], [0, base + Ht]], sc, 1, 1);
    // parapet with a blind arcade
    F.box(L.stone, -0.6, l + 0.6, base + Ht, base + Ht + 1.4, -0.4, 0.6, sc, 'b');
    for (let k = 0; k < 6; k++) F.ring(L.stone, l * (k + 0.5) / 6, base + Ht + 0.9, 0.2, 0.3, 0, PI, 0.6, 0.62, dark, 5, 'f');
    // angle buttresses stepping back up the corners
    for (const [u, sgn] of [[0.55, -1], [l - 0.55, 1]]) {
      for (const [y0, y1, d] of [[0, stages[1], 1.2], [stages[1], stages[2], 0.9], [stages[2], stages[3], 0.6], [stages[3], Ht - 0.6, 0.35]]) {
        F.box(L.stone, u - 0.55, u + 0.55, base + y0, base + y1, 0, d, sc, 'b');
        F.hface(L.stone, u - 0.55, u + 0.55, 0, d, base + y1, sc, 1);
      }
      void sgn;
    }
  }
  // pinnacles at the parapet's corners, then the spire on an octagon
  for (const p of pts) {
    const [cx, cz] = [(pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2];
    const dx = p[0] - cx, dz = p[1] - cz, l = Math.hypot(dx, dz);
    pinnacle(B, cx + dx / l * (l - 0.2), cz + dz / l * (l - 0.2), base + Ht + 1.4, 1.1, 6.5, sc);
  }
  const cx = (pts[0][0] + pts[2][0]) / 2, cz = (pts[0][1] + pts[2][1]) / 2;
  const R = T / 2 - 0.9, oct = Array.from({ length: 8 }, (_, i) => { const a = -i * PI / 4 + PI / 8; return [cx + R * Math.cos(a), cz + R * Math.sin(a)]; });
  const sh = T * 3.1;
  const env = roofEnvelope(oct, oct.map((_, e) => ({ e, k: sh / (R * Math.cos(PI / 8)), off: 0, L: L.copper, col: 0xffffff })), base + Ht + 0.2);
  emitRoof(env);
  // little gabled lucarnes on alternate faces of the spire
  for (let i = 0; i < 8; i += 2) {
    const a = oct[i], b = oct[(i + 1) % 8], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz);
    const F = new Frame(a[0] + (-tz / l) * 0.3, a[1] + (tx / l) * 0.3, -tz / l, tx / l, l);
    const y = base + Ht + 3.2;
    slab(F, L.copper, [[l / 2 - 0.55, y], [l / 2 + 0.55, y], [l / 2 + 0.55, y + 1.4], [l / 2, y + 2.1], [l / 2 - 0.55, y + 1.4]], -1.6, 0, 0xffffff);
    F.face(L.iron, l / 2 - 0.3, l / 2 + 0.3, y + 0.2, y + 1.3, 0.01, 0x202020);
  }
  L.gold.geo(B.G.ball, M4(cx, base + Ht + 0.2 + sh + 0.3, cz, 0.6, 0.6, 0.6), 0xffffff);
  L.gold.geo(B.G.cone, M4(cx, base + Ht + 0.2 + sh + 1.6, cz, 0.18, 2.2, 0.18), 0xffffff);
  void r;
}

// ---------- the market hall ----------
export function buildMarketHall(B, site) {
  const { L, N } = B;
  const g = siteGeom(site);
  const { W, D, base } = g;
  const bc = 0xffffff, tc = 0xf0e6d4, ic = 0x2c3a34; // brick, stone dressings, green-painted iron
  const s0 = 0.5, s1 = W - 0.5, t0 = 0.6, t1 = D - 0.6;
  const n1 = W * 0.27, n2 = W * 0.73; // nave column lines
  const Ha = 6.8, Hn = 11.5, kN = Math.tan(30 * PI / 180), ridge = base + Hn + ((n2 - n1) / 2 + 0.3) * kN;
  const aisleTop = base + Ha + 2.2; // where the lean-tos meet the clerestory
  const [cx, , cz] = g.P(W / 2, 0, D / 2);
  beginBody(cx, cz, null, () => 1);
  CTX.twoSided = true; // walked into: every wall and roof also has its inside
  B.site.anchorAt(cx, cz);
  const col = B.colliders;
  // the two brick end walls: a basilica outline, a great arch, a lunette, side doors
  for (const [t, F] of [[t0, g.sec(t0)], [t1, g.back(t1)]]) {
    const mir = (u) => (t === t0 ? u : W - u);
    const S0 = Math.min(mir(s0), mir(s1)), S1 = Math.max(mir(s0), mir(s1)), N1 = Math.min(mir(n1), mir(n2)), N2 = Math.max(mir(n1), mir(n2));
    const jobs = [];
    const archW = Math.min(6.5, (N2 - N1) - 3), ays = base + 5.2;
    const archO = roundOutline(W / 2 - archW / 2, W / 2 + archW / 2, base, ays, 10);
    const lys = base + Hn - 0.6, lr = Math.min((N2 - N1) / 2 - 1.2, (ridge - lys) - 1.6);
    const lun = [[W / 2 - lr, lys], [W / 2 + lr, lys], ...Frame.archPts(W / 2 - lr, W / 2 + lr, lys, lr, 12).reverse().slice(1, -1)];
    const nh = [];
    nh.push(opening(F, L.brick, archO, [W / 2, ays], 0, -0.7, bc, null));
    jobs.push(() => {
      F.ring(L.stone, W / 2, ays, archW / 2, archW / 2 + 0.55, 0, PI, 0, 0.12, tc, 12, 'fo');
      F.inst(N.stone, W / 2, ays + archW / 2 + 0.25, 0.12, 0.6, 0.8, 0.1, tc);
      // the arch is open (a gate hung back inside, open)
      F.box(L.stone, W / 2 - archW / 2 - 0.4, W / 2 - archW / 2, base, base + 0.6, 0, 0.3, tc, 'b');
      F.box(L.stone, W / 2 + archW / 2, W / 2 + archW / 2 + 0.4, base, base + 0.6, 0, 0.3, tc, 'b');
    });
    nh.push(opening(F, L.brick, lun, [W / 2, lys], 0, -0.4, bc, L.glass, 0xe8eef0));
    jobs.push(() => {
      F.ring(L.stone, W / 2, lys, lr, lr + 0.5, 0, PI, 0, 0.14, tc, 12, 'fo');
      F.box(L.stone, W / 2 - lr - 0.5, W / 2 + lr + 0.5, lys - 0.35, lys, 0, 0.2, tc, 'b');
      for (let i = 1; i < 10; i++) {
        const a = PI * i / 10;
        slab(F, L.iron, [[W / 2 + Math.cos(a) * 0.5 - Math.sin(a) * 0.05, lys + Math.sin(a) * 0.5 + Math.cos(a) * 0.05], [W / 2 + Math.cos(a) * 0.5 + Math.sin(a) * 0.05, lys + Math.sin(a) * 0.5 - Math.cos(a) * 0.05], [W / 2 + Math.cos(a) * lr + Math.sin(a) * 0.05, lys + Math.sin(a) * lr - Math.cos(a) * 0.05], [W / 2 + Math.cos(a) * lr - Math.sin(a) * 0.05, lys + Math.sin(a) * lr + Math.cos(a) * 0.05]], -0.4, -0.3, ic);
      }
      F.ring(L.iron, W / 2, lys, 0.4, 0.55, 0, PI, -0.4, -0.3, ic, 8, 'f');
      F.ring(L.iron, W / 2, lys, lr * 0.6, lr * 0.6 + 0.08, 0, PI, -0.4, -0.3, ic, 12, 'f');
    });
    // nave piece: up to the clerestory eaves and the gable
    const naveOut = [[N1, base], [N2, base], [N2, base + Hn], [W / 2, ridge], [N1, base + Hn]];
    F.wall(L.brick, N1, N2, base, ridge, nh, bc, 0, 1, naveOut);
    for (const j of jobs) j();
    // the aisle pieces, each with a door
    for (const [a, b, sgn] of [[S0, N1, -1], [N2, S1, 1]]) {
      const out = sgn < 0 ? [[a, base], [b, base], [b, aisleTop], [a, base + Ha]] : [[a, base], [b, base], [b, base + Ha], [a, aisleTop]];
      const dc = (a + b) / 2, dw = 2.2;
      const dO = roundOutline(dc - dw / 2, dc + dw / 2, base, base + 2.8, 8);
      const aj = [];
      const hole = opening(F, L.brick, dO, [dc, base + 2.8], 0, -0.6, bc, null);
      F.wall(L.brick, a, b, base, aisleTop, [hole], bc, 0, 1, out);
      F.ring(L.stone, dc, base + 2.8, dw / 2, dw / 2 + 0.35, 0, PI, 0, 0.1, tc, 8, 'fo');
      void aj;
      // a round window above the door
      F.ring(L.stone, dc, base + 5.0, 0.55, 0.8, 0, 2 * PI, 0, 0.12, tc, 12, 'fo');
      pane(B, F, dc - 0.55, dc + 0.55, base + 4.45, base + 5.55, 0.02, 0xe8eef0);
    }
    // copings, pilasters at the column lines, a band of stone
    for (const [a, b] of [[[N1, base + Hn], [W / 2, ridge]], [[W / 2, ridge], [N2, base + Hn]]]) {
      const du = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(du, dy), pu = -dy / l * 0.22, py = du / l * 0.22;
      slab(F, L.stone, [[a[0] - pu, a[1] - py], [b[0] - pu, b[1] - py], [b[0] + pu, b[1] + py], [a[0] + pu, a[1] + py]], -0.3, 0.25, tc);
    }
    for (const u of [S0, N1, N2, S1]) F.box(L.brick, u - 0.45, u + 0.45, base, u === N1 || u === N2 ? base + Hn + 0.3 : base + Ha + 0.3, 0, 0.35, bc, 'b');
    for (const u of [N1, N2]) pinnacleBall(B, F, u, base + Hn + 0.3, tc);
    // collision: the end wall, leaving the great arch and the two doors open
    const dL = (S0 + N1) / 2, dR = (N2 + S1) / 2;
    // a stone base course, broken by the great arch and the doors
    {
      const gaps = [[dL - 1.1, dL + 1.1], [W / 2 - archW / 2, W / 2 + archW / 2], [dR - 1.1, dR + 1.1]];
      let u = S0;
      for (const [ga, gb] of gaps) { if (ga > u + 0.05) F.box(L.stone, u, ga, base, base + 0.5, 0, 0.1, tc, 'b'); u = gb; }
      if (S1 > u + 0.05) F.box(L.stone, u, S1, base, base + 0.5, 0, 0.1, tc, 'b');
    }
    const cuts = [[S0, dL - 1.1], [dL + 1.1, W / 2 - archW / 2], [W / 2 + archW / 2, dR - 1.1], [dR + 1.1, S1]];
    for (const [a, b] of cuts) {
      const q = g.rect(Math.min(mir(a), mir(b)), Math.max(mir(a), mir(b)), t - 0.35, t + 0.35);
      addSolid(col, q[0], q[1], q[2], q[3], base, base + Ha, { cam: true });
    }
  }
  // columns: four lines of cast iron, bays every ~6 m
  const nb = Math.max(2, Math.round((t1 - t0) / 6)), bl = (t1 - t0) / nb;
  for (let i = 1; i < nb; i++) {
    const t = t0 + i * bl;
    for (const s of [s0 + 0.3, n1, n2, s1 - 0.3]) {
      const h = s === n1 || s === n2 ? Hn : Ha;
      const [x, , z] = g.P(s, 0, t);
      L.iron.geo(B.G.col, M4(x, base + h / 2, z, 0.34, h, 0.34), ic);
      L.iron.geo(B.G.col, M4(x, base + 0.45, z, 0.56, 0.9, 0.56), ic);
      L.iron.geo(B.G.cone, M4(x, base + h - 0.35, z, 0.7, 0.7, 0.7, 0, PI), ic);
      addCyl(col, x, z, 0.28, base, h);
    }
    // segmental trusses under the nave roof and across the aisles
    const S = g.sec(t);
    const seg = (u0, u1, y, rise, th) => {
      const sp = u1 - u0, R = (sp * sp / 4 + rise * rise) / (2 * rise), a = Math.asin(sp / 2 / R);
      S.ring(L.iron, (u0 + u1) / 2, y + rise - R, R - th, R, PI / 2 - a, PI / 2 + a, -0.08, 0.08, ic, 12, 'foi');
    };
    seg(n1, n2, base + Hn - 0.3, (ridge - base - Hn) * 0.7, 0.32);
    S.box(L.iron, n1, n2, base + Hn - 0.3, base + Hn - 0.12, -0.06, 0.06, ic, '');
    seg(s0 + 0.3, n1, base + Ha - 0.6, 0.8, 0.22);
    seg(n2, s1 - 0.3, base + Ha - 0.6, 0.8, 0.22);
  }
  // side walls: brick piers at the columns, a low wall, tall glazing; open arches every other bay
  for (const side of ['left', 'right']) {
    const s = side === 'left' ? s0 : s1;
    const F = side === 'left' ? g.left(s, t0, t1) : g.right(s, t0, t1);
    const len = t1 - t0, holes = [], jobs = [];
    for (let i = 0; i < nb; i++) {
      const a = i * bl + 0.45, b = (i + 1) * bl - 0.45;
      const open = i % 2 === 1;
      const ys = base + Ha - 1.2 - (b - a) / 2 * 0.35;
      const out = [[a, open ? base : base + 1.1], [b, open ? base : base + 1.1], ...Frame.archPts(a, b, ys, (b - a) * 0.9, 8, true).reverse()];
      holes.push(opening(F, L.brick, out, [(a + b) / 2, ys], 0, -0.3, bc, open ? null : L.glass, 0xe8eef0));
      if (!open) jobs.push(() => {
        for (let k = 1; k < 5; k++) F.box(L.iron, a + (b - a) * k / 5 - 0.03, a + (b - a) * k / 5 + 0.03, base + 1.1, ys + 0.3, -0.3, -0.24, ic, 'b');
        F.box(L.iron, a, b, base + 3.6, base + 3.66, -0.3, -0.24, ic, 'b');
        F.box(L.stone, a - 0.05, b + 0.05, base + 0.95, base + 1.1, 0, 0.15, tc, 'b');
        const q = (side === 'left' ? [t1 - b, t1 - a] : [t0 + a, t0 + b]);
        const rr = g.rect(s - 0.25, s + 0.25, q[0], q[1]);
        addSolid(col, rr[0], rr[1], rr[2], rr[3], base, base + Ha - 0.5, { cam: false });
      });
      jobs.push(() => F.ring(L.stone, (a + b) / 2, ys - Math.sqrt(((b - a) * 0.9) ** 2 - ((b - a) / 2) ** 2), (b - a) * 0.9, (b - a) * 0.9 + 0.3, Math.acos(0.5 / 0.9), PI - Math.acos(0.5 / 0.9), 0, 0.08, tc, 8, 'fo'));
    }
    F.wall(L.brick, 0, len, base, base + Ha, holes, bc);
    for (const j of jobs) j();
    F.profile(L.stone, 0, len, [[0, base + Ha - 0.35], [0.3, base + Ha - 0.3], [0.35, base + Ha], [0, base + Ha]], tc);
    for (let i = 0; i <= nb; i++) F.box(L.brick, i * bl - 0.42, i * bl + 0.42, base, base + Ha - 0.35, 0, 0.18, bc, 'b');
  }
  // iron girders along the nave column lines, carrying the strip of wall over the lean-tos
  for (const s of [n1, n2]) {
    const S0g = g.sec(t1);
    S0g.box(L.iron, s - 0.16, s + 0.16, base + Ha - 0.5, base + Ha, 0, t1 - t0, ic, '');
  }
  // clerestory: glazed walls on the nave lines between the lean-tos and the nave eaves
  for (const side of ['left', 'right']) {
    const s = side === 'left' ? n1 : n2;
    const F = side === 'left' ? g.left(s, t0, t1) : g.right(s, t0, t1);
    const len = t1 - t0;
    pane(B, F, 0, len, aisleTop, base + Hn, 0, 0xe8eef0);
    const n = Math.round(len / 1.2);
    for (let i = 0; i <= n; i++) F.box(L.iron, i * len / n - 0.04, i * len / n + 0.04, aisleTop, base + Hn, 0, 0.08, ic, 'b');
    F.box(L.iron, 0, len, base + Hn - 0.3, base + Hn, 0, 0.12, ic, 'b');
  }
  // roofs: zinc lean-tos over the aisles, a glazed nave roof on iron ribs, a louvred ridge lantern
  const kA = (aisleTop - base - Ha) / (n1 - s0);
  emitRoof(roofEnvelope(g.poly(s0 - 0.3, n1, t0 - 0.3, t1 + 0.3), [{ e: 3, k: kA, off: 0, L: L.zinc, col: 0xd0d4d6 }], base + Ha - 0.02), L.brick, bc);
  emitRoof(roofEnvelope(g.poly(n2, s1 + 0.3, t0 - 0.3, t1 + 0.3), [{ e: 1, k: kA, off: 0, L: L.zinc, col: 0xd0d4d6 }], base + Ha - 0.02), L.brick, bc);
  const nr = roofEnvelope(g.poly(n1 - 0.3, n2 + 0.3, t0 - 0.4, t1 + 0.4), [{ e: 1, k: kN, off: 0, L: L.glass, col: 0xdfe8ec }, { e: 3, k: kN, off: 0, L: L.glass, col: 0xdfe8ec }], base + Hn);
  // the glass roof: dark, mirroring glass outside; from inside, pale frosted glazing with a
  // little grime, glazing bars down the slopes on both faces
  emitRoof(nr);
  CTX.twoSided = false;
  for (const f of nr.faces) L.trim.poly(f.pts, 0xd2dde0, [0, -1, 0]);
  CTX.twoSided = true;
  {
    const half = W / 2 - (n1 - 0.3), m = Math.max(4, Math.round(half / 1.1));
    for (let j = 1; j < m; j++) for (const sg of [-1, 1]) {
      const sc0 = W / 2 + sg * (half - half * j / m), yAt = (u) => base + Hn + kN * (half - Math.abs(u - W / 2));
      for (const dy of [0.035, -0.035]) {
        const a0 = sc0 - 0.035, a1 = sc0 + 0.035;
        L.iron.quad(g.P(a0, yAt(a0) + dy, t0 - 0.4), g.P(a1, yAt(a1) + dy, t0 - 0.4), g.P(a1, yAt(a1) + dy, t1 + 0.4), g.P(a0, yAt(a0) + dy, t1 + 0.4), ic, [0, 1, 0]);
      }
    }
  }
  const nRib = Math.round((t1 - t0) / 1.5);
  for (let i = 0; i <= nRib; i++) {
    const t = t0 + (t1 - t0) * i / nRib, S = g.sec(t);
    for (const [a, b] of [[[n1 - 0.3, base + Hn], [W / 2, ridge]], [[W / 2, ridge], [n2 + 0.3, base + Hn]]]) {
      const du = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(du, dy), sg = du > 0 ? 1 : -1, pu = -dy / l * 0.07 * sg, py = du / l * 0.07 * sg;
      slab(S, L.iron, [[a[0], a[1]], [b[0], b[1]], [b[0] + pu * 2, b[1] + py * 2], [a[0] + pu * 2, a[1] + py * 2]], -0.05, 0.05, ic);
    }
  }
  // the lantern along the ridge
  const lw = 2.4, ly = ridge - 0.9;
  for (const side of ['left', 'right']) {
    const s = side === 'left' ? W / 2 - lw / 2 : W / 2 + lw / 2;
    const F = side === 'left' ? g.left(s, t0 + 2, t1 - 2) : g.right(s, t0 + 2, t1 - 2);
    F.face(L.iron, 0, t1 - t0 - 4, ly, ly + 1.5, 0, ic);
    const n = Math.round((t1 - t0 - 4) / 0.5);
    for (let i = 0; i < n; i++) F.inst(N.iron, (i + 0.5) * (t1 - t0 - 4) / n, ly + 0.75, 0, 0.05, 1.4, 0.08, ic);
  }
  emitRoof(roofEnvelope(g.poly(W / 2 - lw / 2 - 0.4, W / 2 + lw / 2 + 0.4, t0 + 1.6, t1 - 1.6), [{ e: 1, k: 0.6, off: 0, L: L.zinc, col: 0xd0d4d6 }, { e: 3, k: 0.6, off: 0, L: L.zinc, col: 0xd0d4d6 }], ly + 1.5), L.zinc, 0xd0d4d6);
  // a floor of stone flags inside
  CTX.twoSided = false;
  const fl = g.poly(s0, s1, t0, t1);
  L.stone.poly(fl.map(([x, z]) => [x, base + 0.015, z]), 0xd6cfc2, [0, 1, 0]);
  marketInterior(B, g, { s0, s1, t0, t1, n1, n2, nb, bl, base, Hn, ic });
  B.site.anchorOff();
  endBody();
}
// produce on the stalls (linear-ish sRGB): tomatoes, oranges, lemons, greens, aubergines,
// potatoes, apples, flowers, bread, cheese
const STALL_PAINT = [0x3f5b45, 0x6e2b25, 0x2f4a5a, 0x5d7560, 0x7a5a2a, 0x3b3b3b];
const PRODUCE = [0xb8321f, 0xe0751c, 0xe8c63a, 0x4d8a34, 0x4a2440, 0xa8875a, 0x9c2b2b, 0xd84a7a, 0xc08a4a, 0xe8d08a, 0x6aa040];
/**
 * The hall's life: two rows of market stalls facing the walk down the nave (counter, crates of
 * produce, posts and a striped canopy), hanging lamps down the middle, benches and stacked crates
 * in the aisles. All batched (merged counters and canopies, near instances for the small parts).
 */
function marketInterior(B, g, o) {
  const { L, N } = B;
  const { s0, s1, t0, t1, n1, n2, nb, bl, base, Hn, ic } = o;
  const r = rng(523 + Math.round(t1 * 7 + s1 * 3));
  const col = B.colliders;
  const box = (Lr, sa, sb, ta, tb, y0, y1, c) => g.sec(tb).box(Lr, sa, sb, y0, y1, 0, tb - ta, c, '');
  // (a piece centred at (s, y, t): ws across, h tall, wt along the hall)
  const inst = (b, s, y, t, ws, h, wt, c) => g.sec(t + wt / 2).inst(b, s, y, 0, ws, h, wt, c);
  const solid = (sa, sb, ta, tb, h) => { const q = g.rect(sa, sb, ta, tb); addSolid(col, q[0], q[1], q[2], q[3], base, base + h, { cam: false }); };
  // stalls: a row along each nave column line, facing the middle
  const sl = 2.6, gap = 0.9, ta = t0 + 2.4, tb = t1 - 2.4;
  const n = Math.max(1, Math.floor((tb - ta + gap) / (sl + gap)));
  const off = ta + ((tb - ta) - (n * sl + (n - 1) * gap)) / 2;
  let k = 0;
  for (const side of [-1, 1]) {
    const back = side < 0 ? n1 + 0.6 : n2 - 0.6, front = back - side * 1.0; // counter from back (vendor) to front (walk)
    const sa = Math.min(back, front), sb = Math.max(back, front);
    for (let i = 0; i < n; i++, k++) {
      const a = off + i * (sl + gap), b = a + sl;
      const aw = AWNINGS[(k * 3 + 1) % AWNINGS.length];
      // the counter: a timber box with a darker top
      const paint = STALL_PAINT[k % STALL_PAINT.length];
      box(L.frame, sa, sb, a, b, base, base + 0.85, paint);
      box(L.frame, sa - 0.05, sb + 0.05, a - 0.05, b + 0.05, base + 0.85, base + 0.92, 0xb89a74);
      solid(sa, sb, a, b, 0.95);
      // crates of produce on the counter, tilted toward the walk
      const nc = Math.round(sl / 0.55);
      for (let c = 0; c < nc; c++) {
        const tc = a + (c + 0.5) * sl / nc, pc = PRODUCE[Math.floor(r() * PRODUCE.length)];
        inst(N.frame, (sa + sb) / 2, base + 1.02, tc, 0.75, 0.2, 0.44, 0xc9a77c);
        inst(N.trim, (sa + sb) / 2, base + 1.13, tc, 0.68, 0.06, 0.4, pc);
        for (let q = 0; q < 3; q++) inst(N.trim, (sa + sb) / 2 + (r() - 0.5) * 0.5, base + 1.2, tc + (r() - 0.5) * 0.25, 0.13, 0.11, 0.13, pc);
      }
      // crates stacked behind the counter
      for (let c = 0; c < 2; c++) inst(N.frame, back + side * 0.45, base + 0.2 + c * 0.4, a + 0.4 + r() * (sl - 1.2), 0.5, 0.38, 0.6, 0xbf9a6c);
      // posts and a canopy sloping toward the walk
      for (const ss of [back + side * 0.2, front - side * 0.15]) for (const tt of [a + 0.05, b - 0.05]) {
        const h = ss === front - side * 0.15 ? 2.15 : 2.55;
        inst(N.iron, ss, base + h / 2, tt, 0.06, h, 0.06, ic);
      }
      const yb = base + 2.6, yf = base + 2.15, sB = back + side * 0.3, sF = front - side * 0.45;
      const stripes = 6;
      for (let q = 0; q < stripes; q++) {
        const qa = a - 0.1 + (sl + 0.2) * q / stripes, qb = a - 0.1 + (sl + 0.2) * (q + 1) / stripes;
        L.awning.quad(g.P(sB, yb, qa), g.P(sB, yb, qb), g.P(sF, yf, qb), g.P(sF, yf, qa), q % 2 ? aw[1] : aw[0], [0, 1, 0]);
      }
      // a valance along the front
      for (let q = 0; q < stripes; q++) {
        const qa = a - 0.1 + (sl + 0.2) * q / stripes, qb = a - 0.1 + (sl + 0.2) * (q + 1) / stripes;
        L.awning.quad(g.P(sF, yf, qa), g.P(sF, yf, qb), g.P(sF, yf - 0.22, qb), g.P(sF, yf - 0.22, qa), q % 2 ? aw[1] : aw[0], [-side, 0, 0]);
      }
    }
  }
  // lamps hung down the middle of the nave, one per bay
  for (let i = 0; i < nb; i++) {
    const t = t0 + (i + 0.5) * bl, s = (n1 + n2) / 2, yl = base + 4.6;
    inst(N.iron, s, (base + Hn - 0.3 + yl) / 2, t, 0.03, base + Hn - 0.3 - yl, 0.03, ic);
    inst(N.iron, s, yl - 0.05, t, 0.6, 0.06, 0.6, ic);
    inst(B.F.lamp, s, yl - 0.3, t, 0.32, 0.42, 0.32, 0xffffff);
    inst(N.iron, s, yl - 0.55, t, 0.24, 0.05, 0.24, ic);
  }
  // benches in the aisles between the columns, crates by the end walls
  for (const side of [-1, 1]) {
    const sw = side < 0 ? s0 + 0.9 : s1 - 0.9;
    for (let i = 0; i < nb; i++) {
      const tm = t0 + (i + 0.5) * bl;
      inst(N.frame, sw, base + 0.45, tm, 0.42, 0.06, 1.6, 0x8a6a48);
      inst(N.frame, sw - side * 0.22, base + 0.75, tm, 0.05, 0.42, 1.6, 0x8a6a48);
      for (const dt of [-0.65, 0.65]) inst(N.iron, sw, base + 0.22, tm + dt, 0.4, 0.44, 0.06, ic);
      solid(sw - 0.25, sw + 0.25, tm - 0.8, tm + 0.8, 0.5);
    }
    for (const te of [t0 + 1.0, t1 - 1.6]) {
      const sc = side < 0 ? (s0 + n1) / 2 + 0.6 : (n2 + s1) / 2 - 0.6;
      for (let c = 0; c < 4; c++) inst(N.frame, sc + (c % 2) * 0.62 - 0.31, base + 0.21 + Math.floor(c / 2) * 0.42, te + 0.3, 0.58, 0.4, 0.58, c % 3 ? 0xc49f72 : 0xa88560);
      solid(sc - 0.65, sc + 0.65, te, te + 0.6, 0.85);
    }
  }
}
function pinnacleBall(B, F, u, y, col) {
  F.box(B.L.stone, u - 0.5, u + 0.5, y, y + 0.25, -0.1, 0.45, col, 'b');
  const [x, , z] = F.P(u, 0, 0.17);
  B.L.stone.geo(B.G.ball, M4(x, y + 0.65, z, 0.7, 0.7, 0.7), col);
}

// ---------- the town hall ----------
export function buildTownHall(B, site) {
  const g = siteGeom(site);
  const { W, D, base } = g;
  const front = NORMAL[site.front] ? site.front : 'zp';
  const sides = ['zp', 'xp', 'zn', 'xn'];
  const fi = sides.indexOf(front);
  const lot = {
    id: 'townhall', seed: 4711 + Math.round(site.x0 * 3 + site.z0), x0: site.x0, x1: site.x1, z0: site.z0, z1: site.z1, base,
    fronts: [front, sides[(fi + 1) % 4], sides[(fi + 2) % 4], sides[(fi + 3) % 4]], corner: true, cornerKind: 'square',
    floors: 3, groundUse: 'arcade', style: 'stone', colour: 0xf0e2c8, roof: 'hip', age: 0.25,
  };
  const P = buildSingle(B, lot, (P) => {
    // civic storeys: a tall piano nobile, everything grander
    P.fh = [5.2, 4.4, 3.6];
    P.ys = [base, base + 4.8];
    for (const h of P.fh) P.ys.push(P.ys[P.ys.length - 1] + h);
    P.H = P.ys[P.ys.length - 1]; P.nff = 3;
    P.wallKey = 'sandstone'; P.wallCol = 0xfaf2e4; P.trimCol = 0xfffaf0; P.groundKey = 'plinth'; P.groundCol = 0xf2ece2;
    P.revealCol = shadeCol(0xfaf2e4, 0.88);
    P.roofKey = 'copper'; P.roofCol = 0xffffff; P.pitch = Math.tan(32 * PI / 180);
    P.bayT = 3.9; P.winW = 0.46; P.grand = true; P.balcony = 'central'; P.pnCap = 'alt'; P.cornice = 'grand'; P.cs = 1.5;
    P.quoins = true; P.lesene = false; P.shutters = false; P.attic = false; P.juliet = false; P.bands = true; P.sillCourse = true;
    P.rustic = true; P.paned = true; P.oriel = false; P.frontGable = false; P.depth = 0.38; P.sign = null;
    P.frameCol = 0xf4f1ea; P.doorCol = 0x3a2a1c; P.ironCol = 0x1e1f21;
  });
  // the clock tower rises from the front's middle: shaft, clock stage, open belfry, dome
  const T = Math.min(7.5, W * 0.24);
  clockTower(B, g, W / 2 - T / 2, W / 2 + T / 2, 1.2, 1.2 + T, P.Hc - 2, P.Hc + 16, 0xfaf2e4);
}

/** A clock tower (shaft from y0, clock faces, belfry, drum, copper dome, lantern, finial) on site-local square s0..s1 x t0..t1. */
function clockTower(B, g, s0, s1, t0, t1, y0, yTop, sc) {
  const { L, N } = B;
  const T = s1 - s0;
  const [cx, , cz] = g.P((s0 + s1) / 2, 0, (t0 + t1) / 2);
  beginBody(cx, cz, null, () => 1);
  B.site.anchorAt(cx, cz);
  const pts = [[s0, t0], [s1, t0], [s1, t1], [s0, t1]].map(([s, t]) => { const p = g.P(s, 0, t); return [p[0], p[2]]; });
  const yc = yTop - 9.5, yb0 = yTop - 6.2;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz);
    const F = new Frame(a[0], a[1], -tz / l, tx / l, l);
    const jobs = [], holes = [];
    // belfry: two round-arched openings, dark inside, louvres
    for (const u of [l * 0.3, l * 0.7]) {
      const out = roundOutline(u - 0.75, u + 0.75, yb0, yTop - 2.0, 8);
      holes.push(opening(F, L.stone, out, [u, yTop - 2.0], 0, -0.7, shadeCol(sc, 0.85), L.iron, 0x1a1a1a));
      for (let k = 0; k < 8; k++) F.inst(N.timber, u, yb0 + 0.3 + k * 0.45, -0.6, 1.4, 0.04, 0.25, 0xffffff, 0.6);
      jobs.push(() => F.box(L.stone, u - 0.95, u + 0.95, yb0 - 0.2, yb0, 0, 0.5, sc, 'b'));
      F.ring(L.stone, u, yTop - 2.0, 0.75, 0.98, 0, PI, 0, 0.1, sc, 8, 'fo');
    }
    F.wall(L.stone, 0, l, y0, yTop, holes, sc);
    for (const j of jobs) j();
    // a balustrade on consoles before the belfry
    F.box(L.stone, -0.3, l + 0.3, yb0 - 0.65, yb0 - 0.45, 0, 0.9, sc, 'b');
    const nb = Math.round(l / 0.32);
    for (let k = 0; k < nb; k++) F.inst(N.baluster, (k + 0.5) * l / nb, yb0 - 0.13, 0.62, 0.16, 0.6, 0.16, sc);
    F.box(L.stone, -0.3, l + 0.3, yb0 + 0.17, yb0 + 0.3, 0.5, 0.9, sc, 'b');
    for (let k = 0; k < 4; k++) F.inst(N.console, (k + 0.5) * l / 4, yb0 - 0.95, 0, 0.2, 0.6, 0.85, sc);
    // clock: a stone ring, a gold face, iron hands and hour marks
    const cy = yc, R = Math.min(1.55, l * 0.24);
    F.ring(L.stone, l / 2, cy, R, R + 0.35, 0, 2 * PI, 0, 0.18, sc, 24, 'fo');
    const [x, , z] = F.P(l / 2, 0, 0.1);
    L.gold.geo(B.G.col, M4(x, cy, z, R * 2, 0.08, R * 2, F.yaw, PI / 2), 0xffffff);
    for (let k = 0; k < 12; k++) {
      const a = k * PI / 6;
      F.inst(N.iron, l / 2 + Math.cos(a) * R * 0.82, cy + Math.sin(a) * R * 0.82, 0.14, 0.07, 0.22, 0.02, 0x15171a, 0, -a + PI / 2);
    }
    const ha = 1.1 + i * 0.03, ma = -0.5;
    F.inst(N.iron, l / 2 + Math.cos(ha) * R * 0.25, cy + Math.sin(ha) * R * 0.25, 0.16, 0.1, R * 0.55, 0.03, 0x15171a, 0, -ha + PI / 2);
    F.inst(N.iron, l / 2 + Math.cos(ma) * R * 0.38, cy + Math.sin(ma) * R * 0.38, 0.18, 0.07, R * 0.8, 0.03, 0x15171a, 0, -ma + PI / 2);
    F.box(L.iron, l / 2 - 0.05, l / 2 + 0.05, cy - 0.05, cy + 0.05, 0.1, 0.2, 0x15171a, 'b');
    // string courses and the cornice, angle pilasters
    for (const y of [yc - R - 0.9, yb0 - 0.45]) F.profile(L.stone, 0, l, [[0, y - 0.25], [0.2, y - 0.2], [0.25, y], [0, y + 0.05]], sc, 1, 1);
    F.profile(L.stone, 0, l, [[0, yTop - 0.4], [0.2, yTop - 0.35], [0.45, yTop - 0.15], [0.6, yTop], [0, yTop]], sc, 1, 1);
    for (const u of [0.35, l - 0.35]) F.box(L.stone, u - 0.35, u + 0.35, y0, yTop - 0.4, 0, 0.12, sc, 'b');
  }
  // corner urns on the cornice
  for (const p of pts) {
    const dx = p[0] - cx, dz = p[1] - cz, l = Math.hypot(dx, dz);
    const x = cx + dx / l * (l - 0.35), z = cz + dz / l * (l - 0.35);
    L.stone.geo(B.G.baluster, M4(x, yTop + 0.45, z, 0.5, 0.9, 0.5), sc);
  }
  // octagonal drum with oculi, a copper dome, a lantern, a spire, a gold ball
  const R = T / 2 - 0.6, yd = yTop, hd = 2.6;
  const oct = Array.from({ length: 8 }, (_, i) => { const a = -i * PI / 4 + PI / 8; return [cx + R * Math.cos(a), cz + R * Math.sin(a)]; });
  for (let i = 0; i < 8; i++) {
    const a = oct[i], b = oct[(i + 1) % 8], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz);
    const F = new Frame(a[0], a[1], -tz / l, tx / l, l);
    const out = circleOutline(l / 2, yd + 1.3, 0.45, 12), jobs = [];
    const hole = opening(F, L.stone, out, [l / 2, yd + 1.3], 0, -0.3, shadeCol(sc, 0.85), L.glass, 0xe8eef0);
    F.wall(L.stone, 0, l, yd, yd + hd, [hole], sc);
    void jobs;
    F.profile(L.stone, 0, l, [[0, yd + hd - 0.2], [0.25, yd + hd - 0.1], [0.3, yd + hd], [0, yd + hd]], sc, Math.tan(PI / 8), Math.tan(PI / 8));
  }
  const domeR = R * 1.02;
  const prof = [];
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * PI / 2; prof.push(new THREE.Vector2(Math.cos(a) * domeR, Math.sin(a) * domeR * 1.25)); }
  const dome = new THREE.LatheGeometry(prof, 16);
  L.copper.geo(dome, M4(cx, yd + hd, cz, 1, 1, 1), 0xffffff);
  const ly = yd + hd + domeR * 1.25 - 0.1;
  L.stone.geo(B.G.col, M4(cx, ly + 0.9, cz, 1.3, 1.8, 1.3), sc);
  for (let k = 0; k < 6; k++) {
    const a = k * PI / 3;
    L.iron.geo(B.G.col, M4(cx + Math.cos(a) * 0.62, ly + 0.9, cz + Math.sin(a) * 0.62, 0.18, 1.2, 0.18), 0x1a1a1a);
  }
  L.copper.geo(B.G.cone, M4(cx, ly + 1.8 + 1.6, cz, 1.6, 3.2, 1.6), 0xffffff);
  L.gold.geo(B.G.ball, M4(cx, ly + 5.2, cz, 0.5, 0.5, 0.5), 0xffffff);
  L.gold.geo(B.G.cone, M4(cx, ly + 6.1, cz, 0.12, 1.6, 0.12), 0xffffff);
  const q = g.rect(s0, s1, t0, t1);
  B.addPhys(q[0], q[1], q[2], q[3], y0, yTop);
  B.site.anchorOff();
  endBody();
}

// ---------- a lone tower ----------
export function buildTower(B, site) {
  const g = siteGeom(site);
  const T = Math.min(g.W, g.D) - 0.4;
  const s0 = (g.W - T) / 2, t0 = (g.D - T) / 2;
  const H = Math.max(24, T * 4.2);
  const [cx, , cz] = g.P(g.W / 2, 0, g.D / 2);
  beginBody(cx, cz, null, () => 1);
  const { L } = B;
  const sc = 0xf2e6d2;
  const pts = [[s0, t0], [s0 + T, t0], [s0 + T, t0 + T], [s0, t0 + T]].map(([s, t]) => { const p = g.P(s, 0, t); return [p[0], p[2]]; });
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz);
    const F = new Frame(a[0], a[1], -tz / l, tx / l, l);
    const holes = [];
    for (let k = 1; k < 4; k++) holes.push({ u0: l / 2 - 0.4, u1: l / 2 + 0.4, y0: g.base + k * H / 4 - 1.2, y1: g.base + k * H / 4 + 0.3 });
    if (i === 0) holes.push({ u0: l / 2 - 0.8, u1: l / 2 + 0.8, y0: g.base, y1: g.base + 2.6 });
    F.wall(L.stone, 0, l, g.base, g.base + H - 9.5, holes, sc);
    for (const h of holes) {
      F.reveal(L.stone, h, 0, -0.5, shadeCol(sc, 0.85), 'tblr');
      if (h.y0 === g.base) F.face(L.door, h.u0, h.u1, h.y0, h.y1, -0.5, 0x4a2e1c);
      else { pane(B, F, h.u0, h.u1, h.y0, h.y1, -0.5, 0xe8eef0); paneFrame(B, F, h, -0.488, 0xf4f1ea); }
    }
    for (let k = 1; k < 4; k++) F.profile(L.stone, 0, l, [[0, g.base + k * H / 4 + 0.8], [0.15, g.base + k * H / 4 + 0.85], [0.15, g.base + k * H / 4 + 1.05], [0, g.base + k * H / 4 + 1.1]], sc, 1, 1);
  }
  const q = g.rect(s0, s0 + T, t0, t0 + T);
  addSolid(B.colliders, q[0], q[1], q[2], q[3], g.base, g.base + H - 9.5, { cam: true });
  endBody();
  clockTower(B, g, s0, s0 + T, t0, t0 + T, g.base + H - 9.6, g.base + H, sc);
}
