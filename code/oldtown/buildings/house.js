import * as THREE from 'three';
import { rng } from '../../engine/rng.js';
import { addSolid } from '../../engine/collision.js';
import { Frame, beginBody, endBody, mixCol, shadeCol, instAt } from './merge.js';
import { roofEnvelope, emitRoof, offsetPoly } from './roof.js';
import {
  GH, TRIMS, STONE_TINTS, BRICK_TINTS, SHUTTERS, WINFRAMES, OLDFRAMES, SHOPCOLS, DOORS, GLASS,
  clamp, beam, sideFrame, pane, LIT,
} from './kit.js';
import { groundFloor, SHOPLIKE } from './ground.js';

/*
  The townhouse generator. A lot (plan.js) becomes a plan - storey heights, bays,
  materials, the kind of windows, balconies, cornice and roof, all from the lot's own seed -
  and then a body: a convex footprint polygon (corners chamfered or rounded on some corner
  lots) whose every edge is a front facade, a corner facet, a courtyard back or a party wall,
  under a roof built on that same polygon (roof.js).

  Facade grammar, bottom up: a ground floor by its use (ground.js); a cornice or string course
  over it; upper floors in a rhythm of bays (piers between, margins at the party walls), each
  window a real hole with reveals and a set-back pane, dressed by its storey - the first floor
  (piano nobile) grander (pediments, a balcony), the top floor plainer; quoins or pilaster
  strips at the ends; a deep cornice with modillions; then the roof with dormers on the bays
  and chimneys on the party walls. Half-timbered houses jetty out floor by floor and turn a
  timbered gable to the street.
*/

const SIDE_PTS = {
  zp: (l) => [[l.x0, l.z1], [l.x1, l.z1]], xp: (l) => [[l.x1, l.z1], [l.x1, l.z0]],
  zn: (l) => [[l.x1, l.z0], [l.x0, l.z0]], xn: (l) => [[l.x0, l.z0], [l.x0, l.z1]],
};
const ORDER = ['zp', 'xp', 'zn', 'xn'];
const NORMAL = { zp: [0, 1], xp: [1, 0], zn: [0, -1], xn: [-1, 0] };

/** Lot -> plan: everything about the house decided up front from its seed. */
export function planLot(lot) {
  const r = rng((lot.seed >>> 0) || 1);
  const style = lot.style || 'stucco';
  const age = clamp(lot.age ?? 0.5, 0, 1);
  const base = lot.base || 0;
  const roof = lot.roof || 'gable';
  const nf = Math.max(1, lot.floors ?? 4);
  const mansard = roof === 'mansard';
  const fh = [];
  for (let i = 0; i < nf; i++) fh.push(i === 0 ? r.range(3.35, 3.45) : i === nf - 1 ? r.range(3.05, 3.2) : r.range(3.12, 3.3));
  const nff = mansard ? Math.max(1, nf - 1) : nf; // facade storeys (the mansard storey is the roof's)
  const ys = [base, base + GH];
  for (let i = 0; i < nff; i++) ys.push(ys[ys.length - 1] + fh[i]);
  const H = ys[ys.length - 1];
  const W = lot.x1 - lot.x0, D = lot.z1 - lot.z0;
  const fronts = (lot.fronts && lot.fronts.length ? lot.fronts : ['zp']).filter((s) => NORMAL[s]);
  const mainLen = fronts[0] === 'zp' || fronts[0] === 'zn' ? W : D;
  const P = { lot, r, style, age, base, roof, nf, nff, fh, ys, H, W, D, fronts, mainLen, mansard };
  // materials and colours
  const timber = style === 'timber';
  P.wallKey = style === 'stone' ? (r() < 0.35 ? 'sandstone' : 'stone') : style === 'brick' ? 'brick' : 'stucco';
  P.wallCol = style === 'stucco' ? (lot.colour ?? 0xe8c9a0) : timber ? mixCol(lot.colour ?? 0xf0e6d0, 0xf6f2ea, 0.55)
    : style === 'stone' ? r.pick(STONE_TINTS) : r.pick(BRICK_TINTS);
  P.trimCol = style === 'stone' ? r.pick([0xffffff, 0xfaf6ee, 0xf2ece0]) : style === 'brick' ? r.pick([0xe8dcc0, 0xf0e8d8, 0xd8ccb4]) : r.pick(TRIMS);
  P.groundKey = timber || style === 'stone' || r() < 0.3 ? 'plinth' : P.wallKey;
  P.groundCol = P.groundKey === 'plinth' ? r.pick([0xffffff, 0xf2eee6, 0xe6e0d6]) : P.wallKey === 'stucco' ? shadeCol(P.wallCol, 0.9) : P.wallCol;
  P.plinthCol = r.pick([0xe6e0d6, 0xd6d0c4, 0xf0ece4]);
  P.revealCol = style === 'stone' ? shadeCol(P.wallCol, 0.92) : shadeCol(P.wallCol, 0.86);
  P.frameCol = timber || (style === 'brick' && r() < 0.4) ? r.pick(OLDFRAMES) : r.pick(WINFRAMES);
  P.shutterCol = r.pick(SHUTTERS);
  P.shopCol = r.pick(SHOPCOLS);
  P.doorCol = r.pick(DOORS);
  P.ironCol = r.pick([0x1e1f21, 0x24282a, 0x2a2622, 0x1f2a24]);
  P.glassCols = GLASS;
  P.roofKey = roof === 'flat-parapet' ? 'zinc' : mansard ? (r() < 0.7 ? 'slate' : 'zinc')
    : timber || style === 'brick' ? 'roofTile' : style === 'stone' ? (r() < 0.6 ? 'slate' : 'roofTile') : (r() < 0.75 ? 'roofTile' : 'slate');
  P.roofCol = P.roofKey === 'roofTile' ? r.pick([0xffffff, 0xf0e0d8, 0xe0ccc0, 0xd8d0c8, 0xfff0e8]) : r.pick([0xffffff, 0xeef0f2, 0xe0e4e8]);
  // the facade's character
  const grand = style === 'stone' || (style === 'stucco' && r() < 0.45);
  P.grand = grand;
  P.depth = style === 'stone' ? 0.34 : timber ? 0.1 : style === 'brick' ? 0.26 : 0.25;
  P.surround = timber ? 'none' : style === 'brick' ? (r() < 0.6 ? 'band' : 'none') : r() < 0.85 ? 'band' : 'none';
  P.sb = r.range(0.12, 0.17); P.sp = r.range(0.03, 0.05);
  P.pnCap = timber ? 'none' : r.pick(grand ? ['pediment', 'segmental', 'cap', 'alt'] : ['cap', 'none', 'cap', 'segmental']);
  P.balcony = timber ? 'none' : r.pick(grand ? ['full', 'central', 'central', 'juliet', 'none'] : ['none', 'juliet', 'central', 'none']);
  P.topBalcony = mansard && r() < 0.7;
  P.juliet = !timber && r() < (grand ? 0.45 : 0.25);
  P.shutters = r() < ({ stucco: 0.6, brick: 0.35, timber: 0.45, stone: 0.15 }[style] ?? 0.3);
  P.cornice = timber ? 'eaves' : grand ? 'grand' : 'simple';
  P.cs = r.range(0.85, 1.2) * (style === 'stone' ? 1.15 : 1);
  P.bands = r() < 0.6;
  P.sillCourse = grand && r() < 0.6;
  P.quoins = !timber && (style === 'stone' ? r() < 0.5 : style === 'stucco' ? r() < 0.4 : r() < 0.3);
  P.lesene = !P.quoins && !timber && r() < 0.5;
  P.rustic = !timber && P.groundKey !== 'brick' && r() < 0.65;
  P.paned = timber || style === 'brick' || age > 0.65 ? true : r() < 0.35;
  P.attic = !mansard && roof !== 'flat-parapet' && nff >= 4 && r() < 0.35; // smaller top-floor windows
  P.oriel = !timber && !lot.corner && nff >= 3 && mainLen >= 8 && r() < 0.14;
  P.jetty = timber ? r.range(0.22, 0.34) : 0;
  P.frontGable = roof === 'gable' && (timber || (style === 'brick' && mainLen < 10 && r() < 0.6) || (mainLen < 8 && r() < 0.4));
  P.stepGable = P.frontGable && style === 'brick' && r() < 0.7;
  P.pitch = Math.tan((roof === 'hip' ? r.range(34, 42) : P.frontGable ? r.range(48, 56) : r.range(38, 50)) * Math.PI / 180);
  P.bayT = timber ? r.range(2.1, 2.5) : style === 'stone' ? r.range(2.8, 3.3) : r.range(2.5, 3.1);
  P.winW = r.range(0.42, 0.5);
  const ck = ['chamfer', 'round', 'turret', 'oriel', 'square'].includes(lot.cornerKind) ? lot.cornerKind : null;
  P.corner = lot.corner && fronts.length > 1 ? (timber ? 'square' : ck || r.pick(['chamfer', 'chamfer', 'round', 'turret', 'oriel', 'square'])) : null;
  // weathering: a little darker and dirtier with age, rising damp at the foot, grime under the cornice
  const tint = 1 - age * 0.08 + (r() - 0.5) * 0.06;
  P.shade = (x, y) => {
    const h = y - base;
    return tint * (1 - age * 0.3 * Math.exp(-h / 0.8)) * (1 - age * 0.1 * Math.exp(-Math.abs(P.Hc - y) / 1.4));
  };
  // signs
  if (SHOPLIKE.has(lot.groundUse) || lot.groundUse === 'bank' || lot.groundUse === 'arcade') {
    const style = lot.groundUse === 'arcade' ? 'shop' : lot.groundUse;
    P.signCol = lot.groundUse === 'bakery' ? r.pick([0xf1e3c4, 0xe9d6ae]) : lot.groundUse === 'pharmacy' ? r.pick([0x1f6a44, 0x22704a]) : P.shopCol;
    if (lot.groundUse === 'bakery') P.shopCol = P.signCol;
    if (lot.groundUse === 'pharmacy') P.shopCol = P.signCol;
    P.sign = lot.name ? { text: lot.name, bg: P.signCol, style } : null;
  }
  return P;
}

/** Which parts of each lot's non-front sides other lots cover (party walls), as u-intervals. */
export function findNeighbours(plans) {
  const eps = 0.06;
  for (const P of plans) {
    const l = P.lot;
    P.cover = {};
    for (const s of ORDER) {
      if (P.fronts.includes(s)) continue;
      const iv = [];
      for (const Q of plans) {
        if (Q === P) continue;
        const o = Q.lot;
        if (s === 'xp' && Math.abs(o.x0 - l.x1) < eps) iv.push([l.z1 - Math.min(o.z1, l.z1), l.z1 - Math.max(o.z0, l.z0), Q]);
        if (s === 'xn' && Math.abs(o.x1 - l.x0) < eps) iv.push([Math.max(o.z0, l.z0) - l.z0, Math.min(o.z1, l.z1) - l.z0, Q]);
        if (s === 'zp' && Math.abs(o.z0 - l.z1) < eps) iv.push([Math.max(o.x0, l.x0) - l.x0, Math.min(o.x1, l.x1) - l.x0, Q]);
        if (s === 'zn' && Math.abs(o.z1 - l.z0) < eps) iv.push([l.x1 - Math.min(o.x1, l.x1), l.x1 - Math.max(o.x0, l.x0), Q]);
      }
      P.cover[s] = iv.filter(([a, b]) => b - a > 0.05);
    }
  }
}

/** The footprint polygon and its edges (corners cut on some corner lots). */
function footprint(P) {
  const l = P.lot, r = P.r;
  const edges = [];
  for (const s of ORDER) {
    const [a, b] = SIDE_PTS[s](l);
    const front = P.fronts.includes(s);
    let kind = 'party';
    if (front) kind = 'front';
    else {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const iv = P.cover[s] || [];
      let covered = 0; for (const [p, q] of iv) covered += q - p;
      if (len - covered > 2) kind = 'rear';
    }
    edges.push({ side: s, a: a.slice(), b: b.slice(), n: NORMAL[s], kind, main: s === P.fronts[0] });
  }
  // corner cuts between two fronts
  if (P.corner === 'chamfer' || P.corner === 'round') {
    const c = P.corner === 'chamfer' ? P.r.range(1.8, 2.6) : P.r.range(2.6, 3.4);
    const segs = P.corner === 'chamfer' ? 1 : 3;
    for (let i = 0; i < 4; i++) {
      const A = edges[i], B = edges[(i + 1) % 4];
      if (A.kind !== 'front' || B.kind !== 'front' || A.cut || B.cut) continue;
      const lenA = Math.hypot(A.b[0] - A.a[0], A.b[1] - A.a[1]), lenB = Math.hypot(B.b[0] - B.a[0], B.b[1] - B.a[1]);
      const cc = Math.min(c, lenA * 0.3, lenB * 0.3);
      const v = A.b.slice();
      const dA = [(A.b[0] - A.a[0]) / lenA, (A.b[1] - A.a[1]) / lenA], dB = [(B.b[0] - B.a[0]) / lenB, (B.b[1] - B.a[1]) / lenB];
      A.b = [v[0] - dA[0] * cc, v[1] - dA[1] * cc];
      B.a = [v[0] + dB[0] * cc, v[1] + dB[1] * cc];
      A.cutEnd = true; B.cutStart = true;
      // arc tangent to both (a chamfer is its one chord)
      const ctr = [v[0] - (A.n[0] + B.n[0]) * cc, v[1] - (A.n[1] + B.n[1]) * cc];
      const pts = [];
      for (let k = 0; k <= segs; k++) {
        const t = (k / segs) * Math.PI / 2;
        pts.push([ctr[0] + cc * (Math.cos(t) * A.n[0] + Math.sin(t) * B.n[0]), ctr[1] + cc * (Math.cos(t) * A.n[1] + Math.sin(t) * B.n[1])]);
      }
      const cut = [];
      for (let k = 0; k < segs; k++) {
        const a = pts[k], b = pts[k + 1], tx = b[0] - a[0], tz = b[1] - a[1], ln = Math.hypot(tx, tz);
        cut.push({ side: 'cut', a, b, n: [-tz / ln, tx / ln], kind: 'cut', main: false, cutOf: [A.side, B.side] });
      }
      edges.splice(edges.indexOf(A) + 1, 0, ...cut);
      P.cutAt = v; P.cutC = cc;
      break; // one corner per lot
    }
  }
  for (const E of edges) {
    E.len = Math.hypot(E.b[0] - E.a[0], E.b[1] - E.a[1]);
    E.F = new Frame(E.a[0], E.a[1], E.n[0], E.n[1], E.len);
  }
  const facade = (E) => E.kind === 'front' || E.kind === 'cut';
  edges.forEach((E, i) => {
    const prev = edges[(i + edges.length - 1) % edges.length], next = edges[(i + 1) % edges.length];
    const turn = (A, B) => { const c = A.n[0] * B.n[0] + A.n[1] * B.n[1]; return Math.tan(Math.acos(clamp(c, -1, 1)) / 2); };
    E.mL = facade(E) && facade(prev) ? turn(prev, E) : 0;
    E.mR = facade(E) && facade(next) ? turn(E, next) : 0;
    E.prev = prev; E.next = next;
  });
  return edges.filter((E) => E.len > 0.05);
}

/** Bays along a facade of length len: n windows axes at pitch p after end margins m. */
function bays(P, len, cut) {
  if (cut) return { n: len >= 1.3 ? 1 : 0, m: 0, p: len, c: () => len / 2 };
  const m = len < 6.5 ? 0.45 : P.r.range(0.6, 0.95);
  const n = Math.max(1, Math.round((len - 2 * m) / P.bayT));
  const p = (len - 2 * m) / n;
  return { n, m, p, c: (i) => m + p * (i + 0.5) };
}

/** A main cornice profile [[w, y]...] from the wall at y = 0, scaled by s. */
function corniceProfile(kind, s) {
  const p = kind === 'grand'
    ? [[0, 0], [0.05, 0], [0.05, 0.14], [0.11, 0.2], [0.17, 0.27], [0.17, 0.33], [0.72, 0.36], [0.72, 0.55], [0.77, 0.6], [0.84, 0.7], [0.88, 0.78], [0.9, 0.78], [0.9, 0.84], [0, 0.84]]
    : [[0, 0], [0.07, 0], [0.07, 0.1], [0.16, 0.18], [0.3, 0.24], [0.4, 0.26], [0.4, 0.42], [0.45, 0.46], [0.45, 0.5], [0, 0.5]];
  return p.map(([w, y]) => [w * s, y * s]);
}
const band = (y, h, d) => [[0, y], [d, y], [d, y + h], [0, y + h]];
const courseProfile = (y, s) => [[0, y - 0.24 * s], [0.08 * s, y - 0.24 * s], [0.08 * s, y - 0.1 * s], [0.17 * s, y - 0.04 * s], [0.17 * s, y + 0.04 * s], [0, y + 0.04 * s]];

/** Build every lot (plans first: neighbours and signs need them all). */
export function buildHouses(B, plans) {
  findNeighbours(plans);
  for (const P of plans) buildHouse(B, P);
}

/** One free-standing house from a lot, its plan adjusted by tweak(P) first (the town hall's body). */
export function buildSingle(B, lot, tweak) {
  const P = planLot(lot);
  tweak?.(P);
  P.cover = {};
  buildHouse(B, P);
  return P;
}

function buildHouse(B, P) {
  const { L, N } = B;
  const l = P.lot;
  const cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
  const edges = footprint(P);
  P.edges = edges;
  // cornice / roof base heights
  P.cprof = P.cornice === 'eaves' ? null : corniceProfile(P.cornice, P.cs);
  P.Hc = P.cprof ? P.H + P.cprof[P.cprof.length - 1][1] : P.H;
  // age: lean toward the main street and sag between the party walls (old, mostly timber)
  let deform = null;
  if (P.age > 0.45 && P.style !== 'stone') {
    const k = P.age - 0.45, M = edges.find((E) => E.main) || edges[0];
    const lean = k * (P.style === 'timber' ? 0.014 : 0.004) * (P.r() < 0.8 ? 1 : -1);
    const sag = k * (P.style === 'timber' ? 0.16 : 0.05);
    const [ax, az] = M.a, ux = M.F.ux, uz = M.F.uz, nx = M.n[0], nz = M.n[1], len = M.len, base = P.base;
    deform = (p) => {
      const h = Math.max(0, p[1] - base);
      const t = clamp(((p[0] - ax) * ux + (p[2] - az) * uz) / len, 0, 1);
      p[1] -= sag * Math.sin(Math.PI * t) * Math.min(1, h / GH);
      p[0] += nx * lean * h; p[2] += nz * lean * h;
      return p;
    };
  }
  beginBody(cx, cz, deform, (x, y) => P.shade(x, y));
  B.site.anchorAt(cx, cz);
  P.wallL = L[P.wallKey]; P.groundL = L[P.groundKey];
  for (const E of edges) {
    E.bays = bays(P, E.len, E.kind === 'cut');
    if (E.kind === 'front' || E.kind === 'cut') { upperFacade(B, P, E); groundFloor(B, P, E); }
    else if (E.kind === 'rear') rearFacade(B, P, E);
    else E.F.face(P.wallL, 0, E.len, P.base, P.Hc, 0, P.revealCol);
  }
  if (P.corner === 'turret' || P.corner === 'oriel') cornerPiece(B, P);
  if (P.oriel) bayOriel(B, P, edges.find((E) => E.main));
  roofs(B, P);
  // collision: the footprint (a chamfered / rounded corner is two boxes stepping round it)
  const top = P.roof === 'flat-parapet' ? P.Hc + 0.2 : P.Hc;
  if (P.cutAt && P.cutC) {
    const c = P.cutC * 0.6, [vx, vz] = P.cutAt;
    const sx = vx > cx ? 1 : -1, sz = vz > cz ? 1 : -1;
    // the box shy of the corner along x, and the strip beside it
    const xa = sx > 0 ? l.x0 : l.x0 + c, xb = sx > 0 ? l.x1 - c : l.x1;
    addSolid(B.colliders, xa, xb, l.z0, l.z1, P.base, top, { cam: true });
    const za = sz > 0 ? l.z0 : l.z0 + c, zb = sz > 0 ? l.z1 - c : l.z1;
    addSolid(B.colliders, sx > 0 ? l.x1 - c : l.x0, sx > 0 ? l.x1 : l.x0 + c, za, zb, P.base, top, { cam: true });
  } else if (P.arcade) {
    const a = P.arcade;
    addSolid(B.colliders, a.core[0], a.core[1], a.core[2], a.core[3], P.base, top, { cam: true });
    for (const p of a.piers) addSolid(B.colliders, p[0], p[1], p[2], p[3], P.base, a.y1, { cam: true });
    B.addPhys(a.strip[0], a.strip[1], a.strip[2], a.strip[3], a.y1, top);
  } else addSolid(B.colliders, l.x0, l.x1, l.z0, l.z1, P.base, top, { cam: true });
  B.site.anchorOff();
  endBody();
}

// ---------- upper floors ----------
/** Window holes of storey f on an edge: one per bay (French windows where a balcony needs one). */
function windowsOf(P, E, f) {
  const r = P.r, bs = E.bays;
  const y0f = P.ys[f], h = P.ys[f + 1] - y0f;
  const top = f === P.nff && P.attic;
  const pn = f === 1 && P.nff >= 2;
  const out = [];
  if (!bs.n) return out;
  const ww = E.kind === 'cut' ? Math.min(1.1, E.len * 0.55) : clamp(bs.p * P.winW, 0.85, P.style === 'stone' ? 1.5 : 1.4);
  for (let i = 0; i < bs.n; i++) {
    const c = bs.c(i);
    const j = (P.age * 0.035) * (r() - 0.5) * 2;
    let sill = y0f + (top ? 1.05 : 0.88) + j, head = y0f + h - (top ? 0.75 : pn ? 0.42 : 0.52) + j * 0.5;
    const french = (pn && (P.balcony === 'full' || (P.balcony === 'central' && isCentral(bs, i)))) ||
      (P.juliet && f <= 2 && !top && E.kind !== 'cut' && (f === 1 ? P.balcony !== 'none' || r() < 0.5 : r() < 0.35)) ||
      (P.topBalcony && f === P.nff);
    if (french) sill = y0f + 0.06;
    out.push({ u0: c - ww / 2, u1: c + ww / 2, y0: sill, y1: head, f, i, french, c });
  }
  return out;
}
const isCentral = (bs, i) => (bs.n % 2 ? i === (bs.n - 1) / 2 : i === bs.n / 2 - 1 || i === bs.n / 2);

function upperFacade(B, P, E) {
  const { L, N } = B;
  const F = E.F, len = E.len;
  const y1 = P.ys[1];
  const all = [];
  for (let f = 1; f <= P.nff; f++) all.push(...windowsOf(P, E, f));
  E.windows = all;
  if (P.style === 'timber') { timberFloors(B, P, E, all); return; }
  // the wall from the ground-floor cornice to the main cornice, holes cut
  F.wall(P.wallL, 0, len, y1, P.H, all, P.wallCol);
  balconies(B, P, E);
  for (const h of all) dressWindow(B, P, E, h);
  // ground-floor cornice, floor bands, sill course
  F.profile(L.trim, 0, len, courseProfile(y1, 1.1), P.trimCol, E.mL, E.mR);
  if (P.bands) for (let f = 2; f <= P.nff; f++) F.profile(L.trim, 0, len, band(P.ys[f] - 0.09, 0.18, 0.05), P.trimCol, E.mL, E.mR);
  if (P.sillCourse && P.nff >= 2) {
    const ys = P.ys[1] + 0.75;
    F.profile(L.trim, 0, len, [[0, ys], [0.08, ys], [0.1, ys + 0.03], [0.1, ys + 0.1], [0, ys + 0.12]], P.trimCol, E.mL, E.mR);
  }
  // main cornice and its modillions / dentils
  F.profile(L.trim, 0, len, P.cprof.map(([w, y]) => [w, P.H + y]), P.trimCol, E.mL, E.mR);
  if (P.cornice === 'grand') {
    const s = P.cs, ysf = P.H + 0.33 * s;
    const n = Math.max(1, Math.round((len - 0.4) / (0.62 * s)));
    for (let i = 0; i < n; i++) {
      const u = 0.2 + (i + 0.5) * (len - 0.4) / n;
      F.inst(N.console, u, ysf - 0.11 * s, 0.17 * s, 0.13 * s, 0.22 * s, 0.52 * s, P.trimCol);
    }
    if (P.style === 'stone') {
      const nd = Math.floor((len - 0.2) / (0.15 * s));
      for (let i = 0; i < nd; i++) F.inst(N.trim, 0.1 + (i + 0.5) * (len - 0.2) / nd, P.H + 0.235 * s, 0.11 * s, 0.07 * s, 0.07 * s, 0.05 * s, P.trimCol);
    }
  }
  // frieze plaques of the grand houses: a panel between the top windows' heads and the cornice
  // ends: quoins at outside corners and on quoined houses; pilaster strips at party walls
  const ends = [[0, E.mL > 0 ? 'corner' : 'party', 1], [len, E.mR > 0 ? 'corner' : 'party', -1]];
  for (const [u, kind, s] of ends) {
    if (E.kind === 'cut') continue;
    if (P.quoins && (kind === 'corner' || P.style === 'stone')) quoins(B, P, E, u, s);
    else if (P.lesene && kind === 'party') F.box(P.wallL, s > 0 ? 0 : len - 0.42, s > 0 ? 0.42 : len, y1, P.H, 0, 0.025, shadeCol(P.wallCol, 1.04), 'b');
  }
  // downpipes at the party ends
  if (E.kind === 'front' && E.mR === 0) F.inst(N.zinc, len - 0.12, (P.base + P.Hc) / 2, 0.02, 0.09, P.Hc - P.base, 0.09, 0xb0b4b6);
}

/** Alternating long / short blocks up an end of the facade (u = the end, s = +1 left end, -1 right). */
function quoins(B, P, E, u, s) {
  const F = E.F, L = P.style === 'stone' ? P.wallL : B.L.trim, col = P.style === 'stone' ? shadeCol(P.wallCol, 1.03) : P.trimCol;
  const h = 0.34, gap = 0.035, n = Math.floor((P.H - P.ys[1]) / (h + gap));
  for (let i = 0; i < n; i++) {
    const w = i % 2 ? 0.38 : 0.62, y = P.ys[1] + i * (h + gap) + gap;
    const ext = (s > 0 ? E.mL : E.mR) > 0 ? 0.03 : 0;
    const a = s > 0 ? u - ext : u - w, b = s > 0 ? u + w : u + ext;
    F.box(L, a, b, y, y + h, 0, 0.03, col, 'b');
  }
}

/** One upper window: reveal, pane, surround, sill, the storey's cap, shutters, joinery. */
const hash3 = (a, b, c) => {
  let x = (a ^ Math.imul(b + 0x9e37, 0x85ebca6b) ^ Math.imul(c + 0x7f4a, 0xc2b2ae35)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
  return (x ^ (x >>> 13)) >>> 0;
};
function dressWindow(B, P, E, h) {
  const { L, N } = B;
  const F = E.F, d = P.depth;
  const sur = P.surround === 'band';
  const wf = sur ? P.sp : 0;
  F.reveal(P.wallL, h, wf, -d, P.revealCol, h.french ? 'tlr' : 'tblr');
  if (h.french) F.hface(L.stone, h.u0, h.u1, -d, wf, h.y0, 0xd8d2c8, 1);
  // an evening town: about a third of the flats (a floor, three windows wide) have the lights
  // on, in most of their rooms
  const flat = hash3((P.lot.seed >>> 0) + E.side.length * 977, h.f, Math.floor(h.i / 3));
  const lit = flat % 100 < 32 && hash3(P.lot.seed >>> 0, h.f * 17 + 5, h.i) % 4 !== 0;
  const gc = lit ? LIT : P.glassCols[(h.i * 7 + h.f * 3) % P.glassCols.length];
  pane(B, F, h.u0, h.u1, h.y0, h.y1, -d, gc);
  paneFrame(B, F, h, -d + 0.012, P.frameCol);
  const sb = P.sb, sp = P.sp, tc = P.trimCol;
  if (sur) {
    F.box(L.trim, h.u0 - sb, h.u0, h.y0, h.y1 + sb, 0, sp, tc, 'br');
    F.box(L.trim, h.u1, h.u1 + sb, h.y0, h.y1 + sb, 0, sp, tc, 'bl');
    F.box(L.trim, h.u0, h.u1, h.y1, h.y1 + sb, 0, sp, tc, 'bdlr');
  }
  // sill (a French window stands on the floor instead)
  if (!h.french) F.box(L.trim, h.u0 - (sur ? sb : 0) - 0.06, h.u1 + (sur ? sb : 0) + 0.06, h.y0 - 0.09, h.y0, 0, 0.13 + (sur ? sp : 0), tc, 'b');
  // caps: the piano nobile's pediments, else a cornice shelf on some
  const pn = h.f === 1 && P.nff >= 2;
  let cap = pn ? P.pnCap : (h.f === 2 && P.grand && P.pnCap !== 'none' ? 'cap' : 'none');
  if (cap === 'alt') cap = h.i % 2 ? 'segmental' : 'pediment';
  const u0 = h.u0 - sb - 0.08, u1 = h.u1 + sb + 0.08, yc = h.y1 + (sur ? sb : 0);
  if (cap !== 'none' && E.kind !== 'cut') {
    F.profile(L.trim, u0, u1, [[0, yc], [0.06, yc], [0.06, yc + 0.06], [0.14, yc + 0.12], [0.18, yc + 0.18], [0.18, yc + 0.22], [0, yc + 0.22]], tc);
    if (cap === 'pediment') {
      const ya = yc + 0.22, hp = (u1 - u0) * 0.2, um = (u0 + u1) / 2, dp = 0.16;
      L.trim.poly([F.P(u0, ya, dp), F.P(u1, ya, dp), F.P(um, ya + hp, dp)], tc, F.dir(0, 0, 1));
      for (const [a, b] of [[[u0, ya], [um, ya + hp]], [[um, ya + hp], [u1, ya]]]) {
        L.trim.quad(F.P(a[0], a[1], 0), F.P(b[0], b[1], 0), F.P(b[0], b[1], dp), F.P(a[0], a[1], dp), tc, F.dir(0, 1, 0));
      }
    } else if (cap === 'segmental') {
      const span = u1 - u0, rise = 0.28, R = (span * span / 4 + rise * rise) / (2 * rise), a = Math.asin(span / 2 / R);
      F.ring(L.trim, (u0 + u1) / 2, yc + 0.22 + rise - R, R - 0.1, R, Math.PI / 2 - a, Math.PI / 2 + a, 0, 0.16, tc, 8, 'fo');
    }
    // consoles under the shelf ends, a keystone
    F.inst(N.console, u0 + 0.09, yc - 0.1, sp, 0.1, 0.3, 0.14, tc);
    F.inst(N.console, u1 - 0.09, yc - 0.1, sp, 0.1, 0.3, 0.14, tc);
  } else if (sur && P.grand) F.inst(N.trim, (h.u0 + h.u1) / 2, h.y1 + sb * 0.6, sp, 0.18, sb + 0.1, 0.05, tc);
  // apron panel under the piano nobile's sills
  if (pn && !h.french && P.grand) F.box(L.trim, h.u0 + 0.05, h.u1 - 0.05, h.y0 - 0.62, h.y0 - 0.16, 0, 0.025, tc, 'b');
  // shutters: open flat against the wall (some half open, some shut)
  if (P.shutters && E.kind !== 'cut') {
    const s = P.r(), lw = (h.u1 - h.u0) / 2, sh = h.y1 - h.y0, ym = (h.y0 + h.y1) / 2, sc = P.shutterCol;
    const off = sur ? sb : 0;
    if (s < 0.15 && !h.french) {
      // shut: the two leaves in the opening, just in front of the pane
      for (const k of [0, 1]) {
        F.box(L.shutter, h.u0 + k * lw + 0.01, h.u0 + (k + 1) * lw - 0.01, h.y0 + 0.02, h.y1 - 0.02, -d + 0.06, -d + 0.1, sc, 'b');
        F.inst(N.louvre, h.u0 + (k + 0.5) * lw, ym, -d + 0.1, lw - 0.03, sh - 0.05, 0.03, sc);
      }
    } else {
      const half = s < 0.3;
      for (const [k, hu] of [[-1, h.u0 - off], [1, h.u1 + off]]) {
        // a leaf hinged at hu, swung out by ang (pi/2 = flat against the wall), in a frame whose
        // u runs along the leaf (left leaves backwards, so both frames face out of the wall)
        const ang = half ? P.r.range(0.7, 1.2) : Math.PI / 2 - 0.04;
        const [hx, , hz] = F.P(hu, 0, sp + 0.01);
        const t = F.dir(k * Math.sin(ang), 0, Math.cos(ang));
        const LF = new Frame(hx, hz, -t[2] * k, t[0] * k, lw);
        const a0 = k > 0 ? 0 : -lw, a1 = k > 0 ? lw : 0;
        LF.box(L.shutter, a0, a1, h.y0 + 0.02, h.y1 - 0.02, -0.02, 0.02, sc, '');
        LF.inst(N.louvre, (a0 + a1) / 2, ym, 0.02, lw - 0.02, sh - 0.05, 0.025, sc);
      }
    }
  }
  // joinery
  F.inst(P.paned ? N.win6 : N.win, (h.u0 + h.u1) / 2, (h.y0 + h.y1) / 2, -d + 0.005, h.u1 - h.u0 - 0.02, h.y1 - h.y0 - 0.02, 0.07, P.frameCol);
  if (h.french && !P._balconyAt?.has(h.f + ':' + h.i + ':' + E.side)) {
    // Juliet balcony: a railing across the opening
    const w = h.u1 - h.u0 + 0.16;
    F.inst(P.grand ? N.railFancy : N.rail, (h.u0 + h.u1) / 2, h.y0 + 0.55, wf + 0.02, w, 0.95, 0.04, P.ironCol);
    F.box(L.stone, h.u0 - 0.1, h.u1 + 0.1, h.y0 - 0.12, h.y0 + 0.02, 0, wf + 0.12, P.trimCol, 'b');
    B.F.iron.add(...F.P((h.u0 + h.u1) / 2, h.y0 + 1.0, wf + 0.04), w, 0.05, 0.05, P.ironCol, F.yaw);
  }
}

/** The joinery far off: a flat ring and cross just in front of the pane (the near frame boxes cover it up close). */
export function paneFrame(B, F, h, w, col) {
  const L = B.L.frame, f = 0.07, m = 0.045;
  const um = (h.u0 + h.u1) / 2, yt = h.y1 - (h.y1 - h.y0) * 0.28;
  F.face(L, h.u0, h.u0 + f, h.y0, h.y1, w, col);
  F.face(L, h.u1 - f, h.u1, h.y0, h.y1, w, col);
  F.face(L, h.u0 + f, h.u1 - f, h.y1 - f, h.y1, w, col);
  F.face(L, h.u0 + f, h.u1 - f, h.y0, h.y0 + f, w, col);
  F.face(L, um - m / 2, um + m / 2, h.y0 + f, h.y1 - f, w, col);
  F.face(L, h.u0 + f, um - m / 2, yt - m / 2, yt + m / 2, w, col);
  F.face(L, um + m / 2, h.u1 - f, yt - m / 2, yt + m / 2, w, col);
}

/** Balcony slabs with consoles and railings: the piano nobile's (full / central) and a mansard house's top one. */
function balconies(B, P, E) {
  const { L, N } = B;
  const F = E.F, len = E.len, bs = E.bays;
  if (E.kind === 'cut' || !bs.n) return;
  P._balconyAt ||= new Set();
  const runs = [];
  if (P.nff >= 2 && P.balcony === 'full') runs.push([1, Math.max(0.25, bs.m * 0.4), len - Math.max(0.25, bs.m * 0.4), 0.85]);
  if (P.nff >= 2 && P.balcony === 'central') {
    const ids = [...Array(bs.n).keys()].filter((i) => isCentral(bs, i));
    const a = bs.c(ids[0]) - bs.p / 2 + 0.2, b = bs.c(ids[ids.length - 1]) + bs.p / 2 - 0.2;
    runs.push([1, a, b, 0.9]);
  }
  if (P.topBalcony) runs.push([P.nff, Math.max(0.2, bs.m * 0.3), len - Math.max(0.2, bs.m * 0.3), 0.6]);
  for (const [f, a, b, dep] of runs) {
    for (const h of E.windows) if (h.f === f && h.c > a && h.c < b) P._balconyAt.add(f + ':' + h.i + ':' + E.side);
    const y = P.ys[f];
    F.box(L.stone, a, b, y - 0.16, y + 0.06, 0, dep, P.trimCol, 'b');
    F.profile(L.trim, a, b, [[0, y - 0.26], [dep - 0.05, y - 0.2], [dep, y - 0.16], [0, y - 0.16]], P.trimCol);
    const nc = Math.max(2, Math.round((b - a) / 1.3) + 1);
    for (let i = 0; i < nc; i++) F.inst(B.N.console, a + 0.15 + (b - a - 0.3) * i / (nc - 1), y - 0.42, 0, 0.16, 0.36, dep * 0.8, P.trimCol);
    // railing modules along the front and both sides
    const nm = Math.max(1, Math.round((b - a) / 1.0)), mw = (b - a) / nm, rl = P.grand ? N.railFancy : N.rail;
    for (let i = 0; i < nm; i++) F.inst(rl, a + (i + 0.5) * mw, y + 0.06 + 0.475, dep - 0.06, mw, 0.95, 0.04, P.ironCol);
    for (const [u, s] of [[a, -1], [b, 1]]) {
      const S = sideFrame(F, u, s, dep);
      S.inst(rl, dep / 2, y + 0.06 + 0.475, -0.06, dep, 0.95, 0.04, P.ironCol);
    }
    // far: the handrail and a few posts
    const far = B.F.iron, mid = (a + b) / 2;
    far.add(...F.P(mid, y + 1.0, dep - 0.04), b - a, 0.05, 0.05, P.ironCol, F.yaw);
    far.add(...F.P(mid, y + 0.12, dep - 0.04), b - a, 0.04, 0.04, P.ironCol, F.yaw);
    const np = Math.max(2, Math.round((b - a) / 0.5));
    for (let i = 0; i <= np; i++) far.add(...F.P(a + (b - a) * i / np, y + 0.55, dep - 0.04), 0.03, 0.9, 0.03, P.ironCol, F.yaw);
  }
}

// ---------- half-timbering ----------
/** Jettied timber storeys: each floor a little further out, its infill rendered, its frame dark oak. */
function timberFloors(B, P, E, all) {
  const { L, N } = B;
  const F = E.F, len = E.len, tc = 0xffffff, jet = E.main ? P.jetty : 0;
  const bs = E.bays;
  P.jetTop = jet * P.nff;
  for (let f = 1; f <= P.nff; f++) {
    const w = jet * f, ya = P.ys[f], yb = P.ys[f + 1];
    const hs = all.filter((h) => h.f === f);
    F.wall(L.stucco, 0, len, ya, yb, hs, P.wallCol, w);
    // the jetty's underside, the bressumer beam and the joist ends under it
    if (jet) {
      F.hface(L.timber, 0, len, w - jet, w, ya, tc, -1);
      F.box(L.timber, 0, len, ya - 0.05, ya + 0.22, w - 0.02, w + 0.03, tc, 'b');
      const nj = Math.round(len / 0.45);
      for (let i = 0; i < nj; i++) F.inst(N.timber, (i + 0.5) * len / nj, ya - 0.11, w - jet, 0.13, 0.15, jet + 0.04, tc);
      // close the side of the overhang
      F.sface(L.stucco, 0, ya, yb, w - jet, w, P.wallCol, -1);
      F.sface(L.stucco, len, ya, yb, w - jet, w, P.wallCol, 1);
      F.sface(L.stucco, 0, ya, yb, 0, w - jet, P.wallCol, -1);
      F.sface(L.stucco, len, ya, yb, 0, w - jet, P.wallCol, 1);
    }
    const bw = 0.17, wf = w + 0.03;
    // posts at the ends and either side of each window, rails at sill and head height
    const posts = [bw / 2, len - bw / 2];
    for (const h of hs) posts.push(h.u0 - bw / 2, h.u1 + bw / 2);
    for (const u of posts) F.box(L.timber, u - bw / 2, u + bw / 2, ya + 0.2, yb, w, wf, tc, 'bt');
    const sillY = hs.length ? hs[0].y0 : ya + 0.9, headY = hs.length ? hs[0].y1 : yb - 0.5;
    F.box(L.timber, 0, len, sillY - bw, sillY, w, wf, tc, 'b');
    F.box(L.timber, 0, len, headY, headY + bw, w, wf, tc, 'b');
    // braces: St Andrew's crosses under the windows, diagonals in the solid panels
    for (const h of hs) {
      beam(F, L.timber, h.u0, ya + 0.24, h.u1, sillY - bw, 0.13, w, wf, tc);
      beam(F, L.timber, h.u1, ya + 0.24, h.u0, sillY - bw, 0.13, w, wf, tc);
    }
    const edges = [0, ...hs.flatMap((h) => [h.u0 - bw, h.u1 + bw]), len].sort((a, b) => a - b);
    for (let i = 0; i < edges.length - 1; i += 2) {
      const a = edges[i] + bw, b = edges[i + 1] - bw;
      if (b - a > 0.6) beam(F, L.timber, a, sillY, b, headY, 0.15, w, wf, tc);
      if (b - a > 0.6 && (f + i) % 2) beam(F, L.timber, b, sillY, a, headY, 0.15, w, wf, tc);
    }
    for (const h of hs) {
      F.reveal(L.timber, h, wf, w - P.depth, tc, 'tblr');
      pane(B, F, h.u0, h.u1, h.y0, h.y1, w - P.depth, P.glassCols[(h.i + f) % 4]);
      paneFrame(B, F, h, w - P.depth + 0.012, P.frameCol);
      F.inst(N.win6, (h.u0 + h.u1) / 2, (h.y0 + h.y1) / 2, w - P.depth + 0.005, h.u1 - h.u0 - 0.02, h.y1 - h.y0 - 0.02, 0.06, P.frameCol);
      if (P.shutters && (h.i + f) % 3) {
        for (const [a, b] of [[h.u0 - (h.u1 - h.u0) / 2 - 0.02, h.u0 - 0.02], [h.u1 + 0.02, h.u1 + (h.u1 - h.u0) / 2 + 0.02]]) {
          if (a < 0.1 || b > len - 0.1) continue;
          F.box(L.shutter, a, b, h.y0, h.y1, wf, wf + 0.04, P.shutterCol, 'b');
          F.inst(N.louvre, (a + b) / 2, (h.y0 + h.y1) / 2, wf + 0.04, b - a - 0.02, h.y1 - h.y0 - 0.04, 0.025, P.shutterCol);
        }
      }
    }
  }
  // eaves board along the top (the roof overhangs it)
  F.box(L.timber, 0, len, P.H - 0.2, P.H, jet * P.nff, jet * P.nff + 0.05, tc, 'b');
  // the ground floor's top beam
  F.box(L.timber, 0, len, P.ys[1] - 0.25, P.ys[1], 0, 0.04, tc, 'b');
  void bs;
}

// ---------- backs ----------
/** A courtyard back: plain wall, plain windows where no neighbour covers it. */
function rearFacade(B, P, E) {
  const { L } = B;
  const F = E.F, len = E.len;
  const iv = (P.cover[E.side] || []).map(([a, b]) => [a, b]);
  const free = (u, w) => !iv.some(([a, b]) => u + w > a - 0.3 && u - w < b + 0.3);
  const col = P.wallKey === 'stucco' ? mixCol(P.wallCol, 0xd8d4cc, 0.35) : P.wallCol;
  const n = Math.max(1, Math.floor((len - 1.2) / 2.9)), p = (len - 1.2) / n;
  const holes = [];
  for (let f = 0; f <= P.nff; f++) {
    const y0 = P.ys[f], h = P.ys[f + 1] - y0;
    for (let i = 0; i < n; i++) {
      const c = 0.6 + (i + 0.5) * p;
      if (!free(c, 0.6)) continue;
      if (f === 0 && P.r() < 0.5) continue;
      const ww = f === 0 ? 0.9 : 1.0;
      holes.push({ u0: c - ww / 2, u1: c + ww / 2, y0: y0 + (f === 0 ? 1.4 : 0.9), y1: y0 + h - 0.55, i, f });
    }
  }
  F.wall(P.wallL, 0, len, P.base, P.Hc, holes, col);
  for (const h of holes) {
    F.reveal(P.wallL, h, 0, -0.14, shadeCol(col, 0.85), 'tblr');
    pane(B, F, h.u0, h.u1, h.y0, h.y1, -0.14, P.glassCols[(h.i + h.f) % 4]);
    paneFrame(B, F, h, -0.128, P.frameCol);
    F.box(L.trim, h.u0 - 0.05, h.u1 + 0.05, h.y0 - 0.07, h.y0, 0, 0.09, P.trimCol, 'b');
    F.inst(B.N.win, (h.u0 + h.u1) / 2, (h.y0 + h.y1) / 2, -0.135, h.u1 - h.u0 - 0.02, h.y1 - h.y0 - 0.02, 0.06, P.frameCol);
  }
  // a plain eaves band at the top
  F.profile(L.trim, 0, len, band(P.Hc - 0.3, 0.3, 0.12), P.trimCol, 0, 0);
}

// ---------- corner pieces ----------
/** A polygonal prism (convex, counter-clockwise from above) from y0 to y1 as facade facets with windows on those facing `out`. */
function facetTower(B, P, pts, y0, y1, out, winRows, col, WL) {
  const { L, N } = B;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], tx = b[0] - a[0], tz = b[1] - a[1], len = Math.hypot(tx, tz);
    const nx = -tz / len, nz = tx / len;
    const F = new Frame(a[0], a[1], nx, nz, len);
    const vis = nx * out[0] + nz * out[1] > -0.25;
    const holes = [];
    if (vis && len > 0.75) for (const [ya, yb] of winRows) {
      const ww = Math.min(len * 0.6, 1.0);
      holes.push({ u0: len / 2 - ww / 2, u1: len / 2 + ww / 2, y0: ya, y1: yb });
    }
    F.wall(WL, 0, len, y0, y1, holes, col);
    for (const h of holes) {
      F.reveal(WL, h, 0, -0.14, shadeCol(col, 0.85), 'tblr');
      pane(B, F, h.u0, h.u1, h.y0, h.y1, -0.14, 0xf0f2f4);
      F.box(L.trim, h.u0 - 0.04, h.u1 + 0.04, h.y0 - 0.07, h.y0, 0, 0.08, P.trimCol, 'b');
      F.inst(N.win, len / 2, (h.y0 + h.y1) / 2, -0.135, h.u1 - h.u0 - 0.02, h.y1 - h.y0 - 0.02, 0.06, P.frameCol);
    }
    // a cornice ring and a floor band, mitred round the facets
    const m = Math.tan(Math.PI / n);
    F.profile(L.trim, 0, len, corniceProfile('simple', 0.7).map(([w, y]) => [w, y1 + y]), P.trimCol, m, m);
    F.profile(L.trim, 0, len, band(y0 - 0.1, 0.2, 0.06), P.trimCol, m, m);
  }
}
/** The corner turret or the canted corner oriel, with its corbel and its own roof. */
function cornerPiece(B, P) {
  const { L } = B;
  const l = P.lot;
  // the corner between the first two fronts that meet
  let v = null, nA, nB;
  for (let i = 0; i < 4; i++) {
    const A = ORDER[i], Bs = ORDER[(i + 1) % 4];
    if (P.fronts.includes(A) && P.fronts.includes(Bs)) { v = SIDE_PTS[A](l)[1]; nA = NORMAL[A]; nB = NORMAL[Bs]; break; }
  }
  if (!v) return;
  const out = [(nA[0] + nB[0]) / Math.SQRT2, (nA[1] + nB[1]) / Math.SQRT2];
  const turret = P.corner === 'turret';
  const R = turret ? P.r.range(1.5, 1.9) : P.r.range(1.5, 1.8);
  const ctr = turret ? [v[0] - out[0] * R * 0.25, v[1] - out[1] * R * 0.25] : [v[0] - out[0] * 0.15, v[1] - out[1] * 0.15];
  const nseg = turret ? 12 : 4;
  const pts = [];
  for (let k = 0; k < nseg; k++) {
    const t = -(k / nseg) * Math.PI * 2 + (turret ? 0 : Math.atan2(out[1], out[0]) + Math.PI / 4);
    pts.push([ctr[0] + R * Math.cos(t), ctr[1] + R * Math.sin(t)]);
  }
  const y0 = P.ys[1] + 0.3, y1 = turret ? P.Hc + 2.6 : P.H - 0.2;
  const rows = [];
  for (let f = 1; f <= P.nff; f++) rows.push([P.ys[f] + 0.95, P.ys[f + 1] - 0.55]);
  if (turret) rows.push([P.Hc + 0.6, P.Hc + 2.0]);
  facetTower(B, P, pts, y0, y1, out, rows.filter(([a, b]) => b <= y1 - 0.3 && a > y0), P.wallCol, P.wallL);
  // corbel: a moulded ring tapering to a short drop under it
  const yb = y0 - 0.85, sm = 0.35;
  for (let k = 0; k < nseg; k++) {
    const a = pts[k], b = pts[(k + 1) % nseg];
    const ia = [ctr[0] + (a[0] - ctr[0]) * sm, ctr[1] + (a[1] - ctr[1]) * sm], ib = [ctr[0] + (b[0] - ctr[0]) * sm, ctr[1] + (b[1] - ctr[1]) * sm];
    const hint = [(a[0] + b[0]) / 2 - ctr[0], -0.8, (a[1] + b[1]) / 2 - ctr[1]];
    L.trim.quad([b[0], y0, b[1]], [a[0], y0, a[1]], [ia[0], yb, ia[1]], [ib[0], yb, ib[1]], P.trimCol, hint);
    L.trim.quad([a[0], y0 + 0.02, a[1]], [b[0], y0 + 0.02, b[1]], [b[0], y0 - 0.18, b[1]], [a[0], y0 - 0.18, a[1]], P.trimCol, [hint[0], 0, hint[2]]);
  }
  L.trim.poly(pts.map(([x, z]) => [ctr[0] + (x - ctr[0]) * sm, yb, ctr[1] + (z - ctr[1]) * sm]), P.trimCol, [0, -1, 0]);
  L.trim.geo(B.G.ball, matAt(ctr[0], yb - 0.1, ctr[1], 0.24, 0.24, 0.24), P.trimCol);
  // its roof: a spire (turret) or a low pyramid (oriel) over the facets
  const yr = y1 + 0.35;
  const k = turret ? Math.tan(68 * Math.PI / 180) : Math.tan(40 * Math.PI / 180);
  const RL = turret ? (P.r() < 0.5 ? L.copper : L.slate) : L[P.roofKey];
  const env = roofEnvelope(pts, pts.map((_, e) => ({ e, k, off: 0, L: RL, col: 0xffffff })), yr);
  emitRoof(env);
  if (turret) {
    const top = env.h(ctr[0], ctr[1]);
    B.L.gold.geo(B.G.cone, matAt(ctr[0], top + 0.55, ctr[1], 0.14, 1.1, 0.14), 0xffffff);
    B.L.gold.geo(B.G.ball, matAt(ctr[0], top + 0.1, ctr[1], 0.22, 0.22, 0.22), 0xffffff);
  }
}

/** A rectangular oriel on the main front's middle bay, first floor to the top floor. */
function bayOriel(B, P, E) {
  if (!E || !E.bays.n) return;
  const F = E.F, bs = E.bays;
  const ids = [...Array(bs.n).keys()].filter((i) => isCentral(bs, i));
  const a = bs.c(ids[0]) - bs.p / 2 + 0.15, b = bs.c(ids[ids.length - 1]) + bs.p / 2 - 0.15;
  const dep = 0.85;
  const p0 = F.P(a, 0, 0), p1 = F.P(a, 0, dep), p2 = F.P(b, 0, dep), p3 = F.P(b, 0, 0);
  // the footprint, counter-clockwise from above (u right, w out => a, a+out, b+out, b reversed)
  const pts = [[p3[0], p3[2]], [p2[0], p2[2]], [p1[0], p1[2]], [p0[0], p0[2]]];
  const y0 = P.ys[1] + 0.2, y1 = P.ys[P.nff + 1] - 0.15;
  const rows = [];
  for (let f = 1; f <= P.nff; f++) rows.push([P.ys[f] + 0.85, P.ys[f + 1] - 0.5]);
  // the oriel replaces the wall's own windows in its bays
  facetTowerRect(B, P, F, a, b, dep, y0, y1, rows);
}
function facetTowerRect(B, P, F, a, b, dep, y0, y1, rows) {
  const { L, N } = B;
  const mid = (a + b) / 2, ww = Math.min(b - a - 0.7, 1.8);
  const front = F.shifted(0, dep);
  const holes = rows.map(([ya, yb]) => ({ u0: mid - ww / 2, u1: mid + ww / 2, y0: ya, y1: yb }));
  front.wall(P.wallL, a, b, y0, y1, holes, P.wallCol);
  for (const h of holes) {
    front.reveal(P.wallL, h, 0, -0.12, P.revealCol, 'tblr');
    pane(B, front, h.u0, h.u1, h.y0, h.y1, -0.12, 0xf0f2f4);
    front.inst(N.win, mid, (h.y0 + h.y1) / 2, -0.115, ww - 0.02, h.y1 - h.y0 - 0.02, 0.06, P.frameCol);
    front.box(L.trim, h.u0 - 0.06, h.u1 + 0.06, h.y0 - 0.08, h.y0, 0, 0.1, P.trimCol, 'b');
  }
  for (const [u, s] of [[a, -1], [b, 1]]) {
    const S = sideFrame(F, u, s, dep);
    const sh = rows.map(([ya, yb]) => ({ u0: dep / 2 - 0.25, u1: dep / 2 + 0.25, y0: ya, y1: yb }));
    S.wall(P.wallL, 0, dep, y0, y1, sh, P.wallCol);
    for (const h of sh) {
      S.reveal(P.wallL, h, 0, -0.1, P.revealCol, 'tblr');
      pane(B, S, h.u0, h.u1, h.y0, h.y1, -0.1, 0xf0f2f4);
    }
  }
  // underside corbel slab, top slab with a little cornice
  F.box(L.trim, a - 0.1, b + 0.1, y0 - 0.3, y0, 0, dep + 0.1, P.trimCol, 'b');
  F.box(L.trim, a - 0.15, b + 0.15, y1, y1 + 0.3, 0, dep + 0.15, P.trimCol, 'b');
  for (const u of [a + 0.2, b - 0.2]) F.inst(N.console, u, y0 - 0.65, 0, 0.22, 0.7, dep * 0.9, P.trimCol);
}

const matAt = (x, y, z, sx, sy, sz) => new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(x, y, z);

// ---------- roofs ----------
function roofs(B, P) {
  const { L, N } = B;
  const edges = P.edges;
  const poly = edges.map((E) => E.a);
  const RL = L[P.roofKey], rc = P.roofCol;
  if (P.roof === 'flat-parapet') return flatRoof(B, P, poly);
  const timber = P.style === 'timber';
  // which edges slope (eaves) and which are gables
  const mainIdx = edges.findIndex((E) => E.main);
  const M = edges[mainIdx] || edges[0];
  const par = (E) => Math.abs(E.n[0] * M.n[0] + E.n[1] * M.n[1]) > 0.9;
  let slopes;
  if (P.roof === 'hip') slopes = edges.map(() => true);
  else if (P.mansard) slopes = edges.map((E) => E.kind !== 'party');
  else if (P.frontGable) slopes = edges.map((E) => !par(E));
  else slopes = edges.map((E) => par(E) || E.kind === 'cut' || (E.kind === 'front' && !par(E)));
  // eaves overhang on timber houses; a jettied front pushes the roof out with it
  const offs = edges.map((E, i) => {
    let o = 0;
    if (timber) o = slopes[i] ? 0.45 : 0.25;
    if (E.main && P.jetTop) o += P.jetTop;
    if (E.kind === 'party') o = 0;
    return o;
  });
  const rp = offs.some((o) => o) ? offsetPoly(poly, offs) : poly;
  const y0 = P.Hc - (timber ? 0.05 : 0);
  let planes;
  if (P.mansard) {
    const h = P.fh[P.nf - 1] + 0.2, k1 = Math.tan(73 * Math.PI / 180), k2 = Math.tan(16 * Math.PI / 180), inset = h / k1;
    const steep = P.roofKey;
    planes = [];
    edges.forEach((E, e) => {
      if (!slopes[e]) return;
      planes.push({ e, k: k1, off: 0, L: L[steep], col: rc });
      planes.push({ e, k: k2, off: (k1 - k2) * inset, L: L.zinc, col: 0xe8eaec });
    });
    P.mansardH = h; P.mansardIn = inset;
  } else {
    // deep houses keep their ridge under ~6 m (a real roof would break into two)
    const fz = P.fronts[0] === 'zp' || P.fronts[0] === 'zn';
    const span = P.frontGable ? (fz ? P.W : P.D) : (fz ? P.D : P.W);
    const k = Math.min(P.pitch, 6 / Math.max(2, span / 2));
    planes = edges.map((E, e) => (slopes[e] ? { e, k, off: 0, L: RL, col: rc } : null)).filter(Boolean);
  }
  const env = roofEnvelope(rp, planes, y0);
  P.roofH = env.h;
  P.roofEnv = env;
  // gables: the street-facing one of a gabled house gets windows (or steps, or its timbers)
  const gL = timber ? L.stucco : P.wallL;
  for (const g of env.gables) {
    const E = edges[g.e];
    if (E && (E.kind === 'front') && P.frontGable) streetGable(B, P, E, g, rp, y0);
    else gL.poly(g.pts, E && E.kind === 'party' ? P.revealCol : P.wallCol, [g.n[0], 0, g.n[1]]);
  }
  for (const f of env.faces) f.plane.L.poly(f.pts, f.plane.col, [0, 1, 0]);
  // eaves: a fascia along overhanging eaves, and its soffit
  if (timber) rp.forEach((a, i) => {
    if (!slopes[i] || !offs[i]) return;
    const b = rp[(i + 1) % rp.length], n = edges[i].n;
    L.timber.quad([a[0], y0 - 0.18, a[1]], [b[0], y0 - 0.18, b[1]], [b[0], y0, b[1]], [a[0], y0, a[1]], 0xffffff, [n[0], 0, n[1]]);
    const A = poly[i], Bp = poly[(i + 1) % poly.length];
    L.timber.quad([a[0], y0 - 0.18, a[1]], [A[0], y0 - 0.18, A[1]], [Bp[0], y0 - 0.18, Bp[1]], [b[0], y0 - 0.18, b[1]], 0xffffff, [0, -1, 0]);
  });
  // dormers on the street slopes
  for (const E of edges) {
    const e = edges.indexOf(E);
    if (E.kind !== 'front' || !slopes[e] || !E.bays.n || E.len < 4) continue;
    dormers(B, P, E, env, y0);
  }
  chimneys(B, P, env);
}

/** Dormers along a sloping front (one per bay, or every other on wide ones), on the steep part of a mansard. */
function dormers(B, P, E, env, y0) {
  const { L, N } = B;
  const F = E.F, bs = E.bays, r = P.r;
  const mans = P.mansard;
  const every = mans ? 1 : bs.n > 4 ? 2 : 1;
  const kind = mans ? r.pick(['arch', 'pediment', 'flat']) : r.pick(['gable', 'gable', 'shed', 'arch']);
  const dw = mans ? 1.15 : r.range(1.1, 1.4), dh = mans ? Math.min(2.1, P.mansardH - 0.5) : r.range(1.6, 1.9);
  const inset = mans ? 0.12 : 0.75;
  for (let i = 0; i < bs.n; i += every) {
    const c = bs.c(i);
    if (c - dw / 2 < 0.8 || c + dw / 2 > E.len - 0.8) continue;
    const yb = y0 + (mans ? 0.25 : P.pitch * inset);
    const yt = yb + dh;
    // the roof must rise above the dormer's top where its cheeks meet it
    const [tx, , tz] = F.P(c, 0, -inset - 1.5);
    if (env.h(tx, tz) < yt + 0.2) continue;
    const back = mans ? -inset - 1.2 : -(yt - y0) / P.pitch - 0.3;
    const wc = mans ? P.trimCol : P.style === 'stone' ? P.wallCol : P.trimCol;
    const DL = mans || P.style !== 'stone' ? L.trim : P.wallL;
    const hole = { u0: c - dw / 2 + 0.2, u1: c + dw / 2 - 0.2, y0: yb + 0.25, y1: yt - 0.2 };
    F.wall(DL, c - dw / 2, c + dw / 2, yb - 0.3, yt, [hole], wc, -inset);
    F.reveal(DL, hole, -inset, -inset - 0.12, shadeCol(wc, 0.85), 'tblr');
    pane(B, F, hole.u0, hole.u1, hole.y0, hole.y1, -inset - 0.12, 0xf0f2f4);
    F.inst(N.win, c, (hole.y0 + hole.y1) / 2, -inset - 0.115, hole.u1 - hole.u0 - 0.02, hole.y1 - hole.y0 - 0.02, 0.06, P.frameCol);
    F.sface(DL, c - dw / 2, yb - 0.3, yt, back, -inset, wc, -1);
    F.sface(DL, c + dw / 2, yb - 0.3, yt, back, -inset, wc, 1);
    const RL = mans ? L.zinc : L[P.roofKey];
    const rcol = mans ? 0xe8eaec : P.roofCol;
    const o = 0.12;
    if (kind === 'gable' || kind === 'pediment') {
      const hp = dw * 0.35, um = c;
      const a0 = c - dw / 2 - o, a1 = c + dw / 2 + o;
      // two slopes running back into the roof, a gable triangle on the front
      RL.quad(F.P(a0, yt, -inset + o), F.P(um, yt + hp, -inset + o), F.P(um, yt + hp, back), F.P(a0, yt, back), rcol, [0, 1, 0]);
      RL.quad(F.P(um, yt + hp, -inset + o), F.P(a1, yt, -inset + o), F.P(a1, yt, back), F.P(um, yt + hp, back), rcol, [0, 1, 0]);
      DL.poly([F.P(c - dw / 2, yt, -inset), F.P(c + dw / 2, yt, -inset), F.P(um, yt + hp - 0.05, -inset)], wc, F.dir(0, 0, 1));
      RL.quad(F.P(a0, yt, -inset + o), F.P(a1, yt, -inset + o), F.P(a1, yt, back), F.P(a0, yt, back), rcol, [0, -1, 0]);
    } else if (kind === 'arch') {
      F.ring(RL, c, yt - dw * 0.1, 0, dw / 2 + o, 0.15, Math.PI - 0.15, back, -inset + o, rcol, 8, 'fo');
      F.ring(DL, c, yt - dw * 0.1, 0, dw / 2, 0.15, Math.PI - 0.15, back, -inset, wc, 8, 'f');
    } else {
      F.box(RL, c - dw / 2 - o, c + dw / 2 + o, yt, yt + 0.12, back, -inset + o, rcol, 'b');
    }
  }
}

/** Chimney stacks on the party walls and the ridge: brick or rendered, a cap, pots. */
function chimneys(B, P, env) {
  const { L, N } = B;
  const r = P.r, edges = P.edges;
  const party = edges.filter((E) => E.kind === 'party' || E.kind === 'rear');
  const n = r.int(1, party.length ? 3 : 2);
  const CL = P.style === 'brick' || r() < 0.4 ? L.brick : P.wallL;
  const cc = CL === L.brick ? 0xffffff : P.wallCol;
  for (let k = 0; k < n; k++) {
    let x, z;
    const E = party.length ? party[k % party.length] : null;
    if (E) {
      const t = r.range(0.3, 0.7);
      [x, , z] = E.F.P(E.len * t, 0, -0.35);
    } else { x = r.range(P.lot.x0 + 2, P.lot.x1 - 2); z = r.range(P.lot.z0 + 2, P.lot.z1 - 2); }
    const w = r.range(0.6, 1.1), d = r.range(0.45, 0.65);
    const hs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => env.h(x + a * w / 2, z + b * d / 2));
    const lo = Math.min(...hs), hi = Math.max(...hs);
    if (!isFinite(lo) || hi - P.Hc > 14) continue;
    const top = hi + r.range(0.8, 1.4);
    const F = new Frame(x - w / 2, z + d / 2, 0, 1, w);
    F.box(CL, 0, w, lo - 0.2, top, -d, 0, cc, 'd');
    F.box(L.stone, -0.06, w + 0.06, top, top + 0.12, -d - 0.06, 0.06, 0xe0dcd4, '');
    const np = Math.max(1, Math.round(w / 0.32));
    for (let i = 0; i < np; i++) instAt(N.pot, x - w / 2 + (i + 0.5) * w / np, top + 0.32, z, 0.2, 0.4, 0.2, 0xffffff);
  }
}

/** Flat roof behind a parapet (balustraded on grand houses), with a roof hut, skylights, chimneys. */
function flatRoof(B, P, poly) {
  const { L, N } = B;
  const y = P.Hc;
  for (const E of P.edges) {
    const F = E.F, len = E.len, front = E.kind === 'front' || E.kind === 'cut';
    const ph = 0.95;
    if (front && P.grand && E.len > 2) {
      // balustrade: plinth, balusters (near) or a solid panel (far), coping
      F.box(L.trim, 0, len, y, y + 0.22, -0.3, 0, P.trimCol, 'b');
      const nb = Math.floor((len - 0.4) / 0.26);
      for (let i = 0; i < nb; i++) F.inst(N.baluster, 0.2 + (i + 0.5) * (len - 0.4) / nb, y + 0.22 + 0.29, -0.24, 0.17, 0.58, 0.17, P.trimCol);
      const [mx, , mz] = F.P(len / 2, 0, -0.15);
      B.F.trim.add(mx, y + 0.51, mz, len - 0.4, 0.58, 0.1, P.trimCol, F.yaw);
      F.box(L.trim, 0, len, y + 0.8, y + ph, -0.32, 0.03, P.trimCol, 'b');
      for (const u of [0.1, len - 0.1]) F.box(L.trim, u - 0.12, u + 0.12, y + 0.22, y + 0.8, -0.27, -0.03, P.trimCol, '');
    } else {
      F.box(P.wallL, 0, len, y, y + ph, -0.25, 0, E.kind === 'party' ? P.revealCol : P.wallCol, 'b');
      F.box(L.stone, 0, len, y + ph, y + ph + 0.08, -0.3, 0.04, 0xd8d4cc, 'b');
    }
  }
  L.zinc.poly(poly.map(([x, z]) => [x, y + 0.12, z]), 0xd0d4d6, [0, 1, 0]);
  P.roofH = () => y + 0.12;
  // roof furniture
  const r = P.r, l = P.lot;
  if (r() < 0.6) {
    const w = 2.2, d = 2.4, x = r.range(l.x0 + 1.5, l.x1 - 1.5 - w), z = r.range(l.z0 + 1.5, l.z1 - 1.5 - d);
    const F = new Frame(x, z + d, 0, 1, w);
    F.box(P.wallL, 0, w, y + 0.12, y + 2.5, -d, 0, P.wallCol, 'd');
    F.box(L.zinc, -0.1, w + 0.1, y + 2.5, y + 2.62, -d - 0.1, 0.1, 0xd0d4d6, '');
    F.face(L.door, 0.6, 1.5, y + 0.12, y + 2.2, 0.01, P.doorCol);
  }
  for (let k = r.int(0, 2); k > 0; k--) {
    const x = r.range(l.x0 + 1.5, l.x1 - 2.5), z = r.range(l.z0 + 1.5, l.z1 - 2.5);
    const F = new Frame(x, z + 1.2, 0, 1, 1.4);
    F.box(L.zinc, 0, 1.4, y + 0.12, y + 0.45, -1.2, 0, 0xd0d4d6, 'd');
    L.glass.poly([F.P(0.05, y + 0.46, -1.15), F.P(1.35, y + 0.46, -1.15), F.P(1.35, y + 0.46, -0.05), F.P(0.05, y + 0.46, -0.05)], 0xffffff, [0, 1, 0]);
  }
  chimneys(B, P, { h: () => y + 0.12 });
}

/** A gable facing the street: windows in its storeys, timbers, steps or a plain coping. */
function streetGable(B, P, E, g, rp, y0) {
  const { L, N } = B;
  const F = E.F;
  // the gable outline in this edge's (u, y) (it may sit out on the jetty)
  const w = P.jetTop || 0;
  const toU = (p) => (p[0] - E.a[0]) * F.ux + (p[2] - E.a[1]) * F.uz;
  const outline = g.pts.map((p) => [toU(p), p[1]]);
  const peak = Math.max(...outline.map((p) => p[1]));
  const u0 = Math.min(...outline.map((p) => p[0])), u1 = Math.max(...outline.map((p) => p[0]));
  const timber = P.style === 'timber';
  const col = P.wallCol, WL = timber ? L.stucco : P.wallL;
  // attic storeys in the gable: windows where the gable is wide enough
  const holes = [];
  const mid = (u0 + u1) / 2;
  const half = (y) => (u1 - u0) / 2 * (1 - (y - y0) / (peak - y0));
  for (let k = 0; k < 3; k++) {
    const ya = y0 + 0.5 + k * 2.6, yb = ya + 1.4;
    if (yb > peak - 0.6) break;
    const room = half(yb) - 0.35;
    const n = room > 2.6 ? 3 : room > 1.4 ? 2 : room > 0.5 ? 1 : 0;
    const ww = n === 1 ? Math.min(0.8, room * 2 - 0.2) : 0.85, gap = 0.55;
    for (let i = 0; i < n; i++) {
      const c = mid + (i - (n - 1) / 2) * (ww + gap);
      holes.push({ u0: c - ww / 2, u1: c + ww / 2, y0: ya, y1: yb, i, f: 10 + k });
    }
  }
  const clip = outline.slice().reverse(); // wall polygon runs a, b, top back: counter-clockwise in (u, y)? make sure
  const area = clip.reduce((s, p, i) => { const q = clip[(i + 1) % clip.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  const ccw = area > 0 ? clip : clip.reverse();
  F.wall(WL, u0, u1, y0, peak, holes, col, w, 1, ccw);
  for (const h of holes) {
    F.reveal(WL, h, w + (timber ? 0.03 : 0), w - 0.15, shadeCol(col, 0.85), 'tblr');
    pane(B, F, h.u0, h.u1, h.y0, h.y1, w - 0.15, 0xf0f2f4);
    F.inst(timber ? N.win6 : N.win, (h.u0 + h.u1) / 2, (h.y0 + h.y1) / 2, w - 0.145, h.u1 - h.u0 - 0.02, h.y1 - h.y0 - 0.02, 0.06, P.frameCol);
    if (!timber) F.box(L.trim, h.u0 - 0.06, h.u1 + 0.06, h.y0 - 0.08, h.y0, w, w + 0.1, P.trimCol, 'b');
  }
  if (timber) {
    // tie beam, collar, king post and the rafters along the verges
    const wf = w + 0.03, tc = 0xffffff;
    F.box(L.timber, u0, u1, y0, y0 + 0.2, w, wf, tc, 'b');
    for (const h of holes) {
      F.box(L.timber, h.u0 - 0.14, h.u0, h.y0 - 0.15, h.y1 + 0.15, w, wf, tc, 'b');
      F.box(L.timber, h.u1, h.u1 + 0.14, h.y0 - 0.15, h.y1 + 0.15, w, wf, tc, 'b');
      F.box(L.timber, h.u0 - 0.14, h.u1 + 0.14, h.y1, h.y1 + 0.14, w, wf, tc, 'b');
      F.box(L.timber, h.u0 - 0.14, h.u1 + 0.14, h.y0 - 0.15, h.y0, w, wf, tc, 'b');
    }
    F.box(L.timber, mid - 0.08, mid + 0.08, y0 + 0.2, peak - 0.1, w, wf, tc, 'b');
    for (const k of [0.33, 0.66]) {
      const yk = y0 + (peak - y0) * k, hw = half(yk);
      F.box(L.timber, mid - hw + 0.1, mid + hw - 0.1, yk - 0.08, yk + 0.08, w, wf, tc, 'b');
    }
    beam(F, L.timber, u0 + 0.1, y0 + 0.1, mid, peak - 0.05, 0.2, w, w + 0.05, tc);
    beam(F, L.timber, u1 - 0.1, y0 + 0.1, mid, peak - 0.05, 0.2, w, w + 0.05, tc);
    for (const h of holes) {
      beam(F, L.timber, h.u0 - 0.6, h.y0 - 0.15, h.u0 - 0.14, h.y1, 0.12, w, wf, tc);
      beam(F, L.timber, h.u1 + 0.6, h.y0 - 0.15, h.u1 + 0.14, h.y1, 0.12, w, wf, tc);
    }
  } else if (P.stepGable) {
    // crow steps up both verges, each with a stone cap
    const steps = Math.max(3, Math.round((peak - y0) / 0.75));
    const sh = (peak - y0) / steps;
    for (let s = 0; s < steps; s++) {
      const ya = y0 + s * sh, hw = half(ya + sh);
      for (const side of [-1, 1]) {
        const ua = side < 0 ? mid - half(ya) : mid + hw, ub = side < 0 ? mid - hw : mid + half(ya);
        if (ub - ua < 0.05) continue;
        F.box(WL, ua, ub, ya, ya + sh + 0.35, w - 0.45, w, col, 'b');
        F.box(L.stone, ua - 0.04, ub + 0.04, ya + sh + 0.35, ya + sh + 0.43, w - 0.5, w + 0.05, 0xe4ded2, 'b');
      }
    }
    F.box(WL, mid - 0.35, mid + 0.35, peak - 0.2, peak + 0.6, w - 0.45, w, col, 'b');
    F.box(L.stone, mid - 0.4, mid + 0.4, peak + 0.6, peak + 0.7, w - 0.5, w + 0.05, 0xe4ded2, 'b');
  } else {
    // a plain coping along both verges and a finial ball
    for (const [a, b] of [[[u0, y0], [mid, peak]], [[mid, peak], [u1, y0]]]) beam(F, L.trim, a[0], a[1], b[0], b[1], 0.22, w, w + 0.06, P.trimCol);
    F.inst(N.stone, mid, peak + 0.2, w - 0.15, 0.3, 0.3, 0.3, P.trimCol);
  }
  void rp;
}
