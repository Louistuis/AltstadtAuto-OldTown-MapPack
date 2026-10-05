import * as THREE from 'three';
import { Frame, mixCol, shadeCol } from './merge.js';
import { GH, AWNINGS, sideFrame, backFrame, pane, shopPane } from './kit.js';

/*
  Ground floors by use. The storey is cut into the same bays as the floors above (piers stand
  under piers), and each bay or run of bays becomes something: a shopfront (pilasters, fascia
  with the shop's name, stall riser, big panes, a recessed door, an awning), the house door to
  the stairs (stone surround, fanlight, panelled door, a step), a carriage arch, a barred
  window, a bank's arched windows and pedimented door - or, on an arcade house, a row of
  arches with a walkable passage behind and the shops at its back wall.
*/

export const SHOPLIKE = new Set(['shop', 'cafe', 'restaurant', 'bakery', 'pharmacy', 'gallery']);
const BLADE = new Set(['cafe', 'restaurant', 'bakery', 'pharmacy']);

/** Plan a front's ground bays: [{ kind, i0, i1, door }]. */
function planUnits(P, E, use) {
  const n = E.bays.n, r = P.r;
  if (!n) return [];
  const units = [];
  const shop = SHOPLIKE.has(use);
  if (E.kind === 'cut') {
    if (shop || use === 'arcade') units.push({ kind: 'shop', i0: 0, i1: 0, door: 'centre', sign: false, awning: false });
    else units.push({ kind: use === 'bank' ? 'archwin' : 'gwin', i0: 0, i1: 0 });
    return units;
  }
  if (E.main) {
    if (shop) {
      if (n === 1) units.push({ kind: 'shop', i0: 0, i1: 0, door: 'centre', sign: true, awning: true });
      else {
        const hd = E.mR > 0 ? 0 : E.mL > 0 ? n - 1 : r() < 0.5 ? 0 : n - 1; // the house door away from the corner
        units.push({ kind: 'hdoor', i0: hd, i1: hd });
        const a = hd === 0 ? 1 : 0, b = hd === 0 ? n - 1 : n - 2;
        if (b - a >= 4) {
          const m = Math.floor((a + b) / 2);
          units.push({ kind: 'shop', i0: a, i1: m, door: 'end', sign: true, awning: true }, { kind: 'shop', i0: m + 1, i1: b, door: 'start', sign: true, awning: true });
        } else units.push({ kind: 'shop', i0: a, i1: b, door: b - a >= 2 ? 'centre' : hd === 0 ? 'start' : 'end', sign: true, awning: use !== 'gallery' && use !== 'pharmacy' ? true : r() < 0.4 });
      }
      return units;
    }
    if (use === 'bank') {
      const c = Math.floor(n / 2);
      for (let i = 0; i < n; i++) units.push({ kind: i === c ? 'bankdoor' : 'archwin', i0: i, i1: i });
      return units;
    }
    // a residential front: carriage arch or house door in the middle, barred windows round it
    const c = n % 2 ? (n - 1) / 2 : r() < 0.5 ? 0 : n - 1;
    const carriage = E.bays.p >= 2.6 && E.len >= 9 && r() < 0.55;
    for (let i = 0; i < n; i++) units.push({ kind: i === c ? (carriage ? 'carriage' : 'hdoor') : 'gwin', i0: i, i1: i });
    return units;
  }
  // a side front: the shop turns the corner for a bay or two, then windows
  const cornerAtEnd = E.mR > 0;
  for (let i = 0; i < n; i++) {
    const k = cornerAtEnd ? n - 1 - i : i;
    if (shop && i < Math.min(2, n - 1)) units.push({ kind: 'shop', i0: k, i1: k, door: null, sign: i === 0, awning: true });
    else units.push({ kind: use === 'bank' ? 'archwin' : 'gwin', i0: k, i1: k });
  }
  return units;
}

export function groundFloor(B, P, E) {
  const use = P.lot.groundUse || 'door';
  if (E.main && use === 'arcade') return arcade(B, P, E);
  const F = E.F, len = E.len, base = P.base, top = P.ys[1];
  const bs = E.bays;
  const units = planUnits(P, E, use);
  const bayL = (i) => (E.kind === 'cut' ? 0.25 : bs.m + bs.p * i), bayR = (i) => (E.kind === 'cut' ? len - 0.25 : bs.m + bs.p * (i + 1));
  const holes = [], jobs = [];
  for (const u of units) {
    const c0 = bs.c(u.i0), c1 = bs.c(u.i1);
    if (u.kind === 'shop') {
      const a = Math.max(0.42, bayL(u.i0) + (u.i0 === 0 && E.kind !== 'cut' ? 0.05 : 0.28));
      const b = Math.min(len - 0.42, bayR(u.i1) - (u.i1 === bs.n - 1 && E.kind !== 'cut' ? 0.05 : 0.28));
      if (b - a < 1) continue;
      const h = { u0: a, u1: b, y0: base, y1: base + 3.2 };
      holes.push(h); jobs.push(() => shopfront(B, P, F, h, { ...u, use: SHOPLIKE.has(use) ? use : 'shop' }));
    } else if (u.kind === 'hdoor' || u.kind === 'bankdoor') {
      const w = u.kind === 'bankdoor' ? 1.7 : 1.2;
      const h = { u0: c0 - w / 2, u1: c0 + w / 2, y0: base, y1: base + (u.kind === 'bankdoor' ? 3.35 : 3.2) };
      holes.push(h); jobs.push(() => houseDoor(B, P, F, h, u.kind === 'bankdoor'));
    } else if (u.kind === 'carriage') {
      const w = Math.min(3.0, bs.p - 0.5);
      const h = { u0: c0 - w / 2, u1: c0 + w / 2, y0: base, y1: base + 3.55 };
      holes.push(h); jobs.push(() => carriage(B, P, F, h));
    } else {
      const arch = u.kind === 'archwin';
      const w = Math.min(arch ? 1.3 : 1.15, (bayR(u.i0) - bayL(u.i0)) * 0.6);
      const h = { u0: c0 - w / 2, u1: c0 + w / 2, y0: base + (arch ? 0.9 : 1.2), y1: base + 3.2 };
      holes.push(h); jobs.push(() => groundWindow(B, P, F, h, arch));
    }
    void c1;
  }
  F.wall(P.groundL, 0, len, base, top, holes, P.groundCol);
  E.holes = holes; // (the solid wall between them is left for a game to dress)
  for (const j of jobs) j();
  plinthAndRustic(B, P, F, len, holes, E);
}

/** The base course under the ground floor and rusticated courses on its piers (near). */
function plinthAndRustic(B, P, F, len, holes, E) {
  const { L, N } = B;
  const base = P.base, top = P.ys[1];
  const spans = (pred) => {
    const cut = holes.filter(pred).map((h) => [h.u0 - (h.sur || 0), h.u1 + (h.sur || 0)]).sort((a, b) => a[0] - b[0]);
    const out = []; let u = 0;
    for (const [a, b] of cut) { if (a > u + 0.05) out.push([u, a]); u = Math.max(u, b); }
    if (u < len - 0.05) out.push([u, len]);
    return out;
  };
  const pc = P.plinthCol;
  for (const [a, b] of spans((h) => h.y0 < base + 0.5)) F.box(L.plinth, a, b, base, base + 0.45, 0, 0.05, pc, 'b');
  if (!P.rustic || P.style === 'timber') return;
  const NB = P.groundKey === 'plinth' ? N.plinth : P.groundKey === 'stucco' ? N.stucco : null;
  if (!NB) return;
  const col = P.groundCol;
  const ch = 0.42, y0 = base + 0.5, yTop = top - 0.28;
  const nc = Math.floor((yTop - y0) / ch);
  for (const [a, b] of spans(() => true)) {
    if (b - a < 0.15) continue;
    for (let k = 0; k < nc; k++) {
      const y = y0 + k * ch;
      F.inst(NB, (a + b) / 2, y + ch / 2, 0, b - a - (E.mL > 0 && a < 0.01 ? -0.02 : 0.03), ch - 0.035, 0.025, col);
    }
  }
}

/** A shopfront in hole h on frame F. o: { use, door: 'centre' | 'start' | 'end' | null, sign, awning }. */
export function shopfront(B, P, F, h, o) {
  const { L, N } = B;
  const base = P.base, hs = h.y1 - base;
  const sc = P.shopCol, JL = L.frame;
  const use = o.use;
  const gallery = use === 'gallery';
  h.sur = gallery ? 0.05 : 0.32;
  // pilasters with stone plinths, fascia and its cornice
  if (!gallery) {
    for (const [a, b] of [[h.u0 - 0.32, h.u0 + 0.02], [h.u1 - 0.02, h.u1 + 0.32]]) {
      F.box(JL, a, b, base + 0.35, base + hs, 0, 0.11, sc, 'b');
      F.box(L.plinth, a - 0.02, b + 0.02, base, base + 0.35, 0, 0.14, P.plinthCol, 'b');
    }
  } else {
    F.box(L.iron, h.u0 - 0.05, h.u0 + 0.02, base, base + hs, 0, 0.05, 0xffffff, 'b');
    F.box(L.iron, h.u1 - 0.02, h.u1 + 0.05, base, base + hs, 0, 0.05, 0xffffff, 'b');
  }
  const fy = base + hs, fh = 0.62;
  const fu0 = h.u0 - (gallery ? 0.05 : 0.34), fu1 = h.u1 + (gallery ? 0.05 : 0.34);
  F.box(gallery ? L.stucco : JL, fu0, fu1, fy, fy + fh, 0, 0.15, gallery ? 0xf4f2ee : sc, 'b');
  if (!gallery) {
    F.profile(JL, fu0 - 0.06, fu1 + 0.06, [[0, fy + fh], [0.2, fy + fh], [0.24, fy + fh + 0.05], [0.24, fy + fh + 0.11], [0, fy + fh + 0.13]], sc);
    F.inst(N.console, h.u0 - 0.15, fy + 0.3, 0.15, 0.18, 0.56, 0.14, sc);
    F.inst(N.console, h.u1 + 0.15, fy + 0.3, 0.15, 0.18, 0.56, 0.14, sc);
  }
  if (o.sign && P.sign && B.signB) {
    const w = Math.min(h.u1 - h.u0 - 0.1, 6.4);
    F.inst(B.signB, (h.u0 + h.u1) / 2, fy + fh / 2, 0.152, w, w / 6.4 * 0.8 > 0.52 ? 0.52 : Math.max(0.36, w / 6.4 * 0.8), 0.01, B.sign(P.sign));
  }
  // the opening's lining, then the shop's own front set back in it
  F.reveal(JL, h, 0, -0.32, sc, 'tlr');
  const cafe = use === 'cafe' || use === 'restaurant';
  const rh = gallery ? 0.06 : cafe ? 0.3 : 0.55;
  const dw = 1.15;
  let door = null;
  if (o.door === 'centre') door = (h.u0 + h.u1) / 2;
  else if (o.door === 'start') door = h.u0 + 0.12 + dw / 2;
  else if (o.door === 'end') door = h.u1 - 0.12 - dw / 2;
  const segs = door === null ? [[h.u0, h.u1]] : [[h.u0, door - dw / 2], [door + dw / 2, h.u1]];
  const gc = 0xffffff;
  for (const [a, b] of segs) {
    if (b - a < 0.08) continue;
    F.box(JL, a, b, base, base + rh, -0.32, -0.2, sc, 'bdlr');
    F.box(JL, a, b, base + rh, base + rh + 0.06, -0.32, -0.16, sc, 'bdlr');
    shopPane(B, F, a, b, base + rh + 0.06, base + hs - 0.14, -0.26, gc);
    F.box(JL, a, b, base + hs - 0.14, base + hs, -0.32, -0.2, sc, 'bdlr');
    // mullions and a transom (near); a café front folds: closer mullions, no transom
    const nm = Math.max(1, Math.round((b - a) / (cafe ? 0.75 : 1.2)));
    const ym = (base + rh + base + hs) / 2;
    for (let i = 1; i < nm; i++) F.inst(N.frame, a + (b - a) * i / nm, ym, -0.27, 0.07, hs - rh - 0.1, 0.07, sc);
    F.inst(N.frame, a + 0.03, ym, -0.27, 0.06, hs - rh - 0.1, 0.07, sc);
    F.inst(N.frame, b - 0.03, ym, -0.27, 0.06, hs - rh - 0.1, 0.07, sc);
    if (!cafe && !gallery) F.inst(N.frame, (a + b) / 2, base + hs - 0.7, -0.27, b - a, 0.06, 0.07, sc);
    if (use === 'restaurant') for (let i = 1; i < 3; i++) F.inst(N.frame, (a + b) / 2, base + rh + (hs - rh) * i / 3, -0.27, b - a, 0.035, 0.05, sc);
  }
  if (door !== null) {
    const d0 = door - dw / 2, d1 = door + dw / 2, dd = -1.15, dt = base + 2.6;
    // the recess: display-glass sides above the riser, a soffit, a mosaic floor, the door
    for (const [u, s] of [[d0, 1], [d1, -1]]) {
      F.sface(JL, u, base, base + rh + 0.06, dd, -0.32, sc, s);
      F.sface(L.shopGlass, u, base + rh + 0.06, dt, dd, -0.32, gc, s);
    }
    F.hface(JL, d0, d1, dd, -0.26, dt, sc, -1);
    shopPane(B, F, d0, d1, dt + 0.08, base + hs - 0.14, -0.26, gc);
    F.box(JL, d0, d1, dt, dt + 0.08, -0.32, -0.2, sc, 'bdlr');
    F.hface(L.plinth, d0, d1, dd, -0.0, base + 0.012, 0xb8b0a0, 1);
    F.face(L.door, d0, d1, base, dt, dd, sc);
    shopPane(B, F, d0 + 0.17, d1 - 0.17, base + 0.95, dt - 0.2, dd + 0.015, gc);
    F.inst(N.gold, d1 - 0.2, base + 1.05, dd, 0.03, 0.3, 0.05, 0xffffff);
  }
  if (o.awning && !gallery) awning(B, P, F, fu0 + 0.1, fu1 - 0.1, fy - 0.02);
  if (o.sign && BLADE.has(use) && B.signB) bladeSign(B, P, F, h, use);
}

/** A striped (or plain) fabric awning under the fascia: sloped top and underside, a valance. */
function awning(B, P, F, u0, u1, yt) {
  const { L } = B;
  const [c1, c2] = AWNINGS[(P.lot.seed >>> 3) % AWNINGS.length];
  const out = 1.75, drop = 0.7, w0 = 0.16, w1 = w0 + out, yb = yt - drop, vh = 0.24;
  const n = Math.max(1, Math.round((u1 - u0) / 0.28));
  const sw = (u1 - u0) / n;
  for (let i = 0; i < n; i++) {
    const a = u0 + i * sw, b = a + sw, col = i % 2 ? c2 : c1;
    L.awning.quad(F.P(a, yt, w0), F.P(b, yt, w0), F.P(b, yb, w1), F.P(a, yb, w1), col, F.dir(0, out, drop));
    L.awning.quad(F.P(a, yt, w0), F.P(b, yt, w0), F.P(b, yb, w1), F.P(a, yb, w1), shadeCol(col, 0.8), F.dir(0, -out, -drop));
    F.face(L.awning, a, b, yb - vh, yb, w1, col, 1);
    F.face(L.awning, a, b, yb - vh, yb, w1, shadeCol(col, 0.8), -1);
  }
  // the folding arms, from the wall up to the front bar
  const ya = yt - 0.85, dy = yb - 0.04 - ya, len = Math.hypot(out, dy);
  for (const u of [u0 + 0.08, u1 - 0.08]) F.inst(B.N.iron, u, (ya + yb - 0.04) / 2, 0, 0.035, 0.035, len, P.ironCol, -Math.atan2(dy, out));
  F.inst(B.N.iron, (u0 + u1) / 2, yb - 0.04, out + 0.12, u1 - u0, 0.05, 0.05, P.ironCol);
}

/** A board hung out over the pavement on an iron bracket, the name on both faces (a green cross for the pharmacy). */
function bladeSign(B, P, F, h, use) {
  const { L, N } = B;
  // beside the fascia's end, under the ground-floor cornice (the first floor may have a balcony)
  const u = h.u1 + 0.58, y = P.base + 3.3, out = 1.0;
  F.inst(N.iron, u, y + 0.36, 0, 0.05, 0.05, out, P.ironCol);
  F.inst(N.iron, u, y + 0.1, 0, 0.03, 0.03, 0.5, P.ironCol, -0.6);
  const S = sideFrame(F, u, 1, out), S2 = sideFrame(F, u, -1, out);
  if (use === 'pharmacy') {
    const g = 0x2fae5a;
    S.box(L.frame, out / 2 - 0.12, out / 2 + 0.12, y - 0.38, y + 0.3, -0.04, 0.04, g, '');
    S.box(L.frame, out / 2 - 0.35, out / 2 + 0.35, y - 0.16, y + 0.08, -0.04, 0.04, g, '');
    return;
  }
  S.box(L.frame, 0.2, out - 0.08, y - 0.3, y + 0.3, -0.015, 0.015, P.shopCol, '');
  const cell = B.sign(P.sign);
  S.inst(B.signB, out / 2 + 0.06, y, 0.016, out - 0.32, 0.5, 0.005, cell);
  S2.inst(B.signB, out / 2 - 0.06, y, 0.016, out - 0.32, 0.5, 0.005, cell);
}

/** The house door: stone surround, panelled door, transom and fanlight, a step. Grand (a bank's): columns and a pediment. */
function houseDoor(B, P, F, h, grand) {
  const { L, N } = B;
  const base = P.base, tc = P.trimCol, dc = P.doorCol;
  const sw = grand ? 0.3 : 0.22, sp = grand ? 0.1 : 0.07, dep = -0.32;
  h.sur = sw;
  F.reveal(P.groundL, h, sp, dep, P.revealCol, 'tlr');
  F.box(L.trim, h.u0 - sw, h.u0, base, h.y1 + sw, 0, sp, tc, 'br');
  F.box(L.trim, h.u1, h.u1 + sw, base, h.y1 + sw, 0, sp, tc, 'bl');
  F.box(L.trim, h.u0, h.u1, h.y1, h.y1 + sw, 0, sp, tc, 'bdlr');
  const dt = h.y1 - 0.6;
  F.face(L.door, h.u0, h.u1, base, dt, dep, dc);
  F.box(L.trim, h.u0, h.u1, dt, dt + 0.12, dep, dep + 0.1, tc, 'b');
  pane(B, F, h.u0, h.u1, dt + 0.12, h.y1, dep + 0.02, 0xf0f2f4);
  // fanlight bars, door panels, handle, the step
  for (let i = 1; i < 4; i++) F.inst(N.frame, h.u0 + (h.u1 - h.u0) * i / 4, (dt + 0.12 + h.y1) / 2, dep + 0.02, 0.03, h.y1 - dt - 0.12, 0.03, P.frameCol);
  const leaves = h.u1 - h.u0 > 1.4 ? 2 : 1, lw = (h.u1 - h.u0) / leaves;
  for (let k = 0; k < leaves; k++) {
    const ua = h.u0 + k * lw;
    for (const [ya, yb] of [[base + 0.25, base + 1.0], [base + 1.2, dt - 0.2]]) {
      F.inst(N.door, ua + lw / 2, (ya + yb) / 2, dep, lw - 0.3, yb - ya, 0.035, shadeCol(dc, 1.5));
    }
  }
  F.inst(N.gold, (h.u0 + h.u1) / 2 + (leaves > 1 ? 0.08 : (h.u1 - h.u0) / 2 - 0.18), base + 1.1, dep, 0.05, 0.05, 0.08, 0xffffff);
  F.box(L.plinth, h.u0 - sw - 0.1, h.u1 + sw + 0.1, base, base + 0.15, dep, 0.32, P.plinthCol, 'b');
  // a cornice cap; columns and a pediment on the grand door
  const yc = h.y1 + sw;
  F.profile(L.trim, h.u0 - sw - 0.12, h.u1 + sw + 0.12, [[0, yc], [0.12, yc], [0.14, yc + 0.1], [0.24, yc + 0.18], [0.24, yc + 0.26], [0, yc + 0.26]], tc);
  if (grand) {
    for (const u of [h.u0 - sw - 0.3, h.u1 + sw + 0.3]) {
      const m = new THREE.Matrix4().makeScale(0.42, yc - base - 0.3, 0.42);
      const [x, , z] = F.P(u, 0, 0.12);
      m.setPosition(x, base + 0.3 + (yc - base - 0.3) / 2, z);
      L.trim.geo(B.G.col, m, tc);
      F.box(L.trim, u - 0.28, u + 0.28, base, base + 0.3, 0, 0.42, tc, 'b');
    }
    const ya = yc + 0.26, u0 = h.u0 - sw - 0.62, u1 = h.u1 + sw + 0.62, hp = (u1 - u0) * 0.18, um = (u0 + u1) / 2;
    F.box(L.trim, u0, u1, yc - 0.05, ya, 0, 0.36, tc, 'b');
    L.trim.poly([F.P(u0, ya, 0.3), F.P(u1, ya, 0.3), F.P(um, ya + hp, 0.3)], tc, F.dir(0, 0, 1));
    for (const [a, b] of [[[u0, ya], [um, ya + hp]], [[um, ya + hp], [u1, ya]]]) {
      L.trim.quad(F.P(a[0], a[1], 0), F.P(b[0], b[1], 0), F.P(b[0], b[1], 0.3), F.P(a[0], a[1], 0.3), tc, F.dir(0, 1, 0));
    }
  }
  // house number and a wall lantern
  F.inst(N.trim, h.u1 + sw + 0.3, base + 2.2, 0, 0.22, 0.16, 0.02, 0x2a3a5a);
  if (!grand) lantern(B, P, F, h.u0 - sw - 0.35, base + 2.55);
}

/** A wall lantern: bracket, a glazed box with an iron cap and foot. */
export function lantern(B, P, F, u, y) {
  const { L, N } = B;
  F.inst(N.iron, u, y + 0.1, 0, 0.04, 0.04, 0.32, P.ironCol);
  F.inst(B.F.lamp, u, y - 0.06, 0.29, 0.17, 0.27, 0.17, 0xffffff);
  F.inst(N.iron, u, y + 0.12, 0.17, 0.26, 0.06, 0.24, P.ironCol);
  F.inst(N.iron, u, y + 0.2, 0.25, 0.08, 0.1, 0.08, P.ironCol);
  F.inst(N.iron, u, y - 0.22, 0.2, 0.2, 0.04, 0.2, P.ironCol);
  for (const [du, dw] of [[-0.09, 0.2], [0.09, 0.2], [-0.09, 0.38], [0.09, 0.38]]) F.inst(N.iron, u + du, y - 0.06, dw - 0.01, 0.02, 0.3, 0.02, P.ironCol);
}

/** A segmental carriage arch with double plank doors, voussoirs, a keystone and wheel guards. */
function carriage(B, P, F, h) {
  const { L, N } = B;
  const base = P.base, span = h.u1 - h.u0, R = span * 0.72, dep = -0.45;
  const rise = R - Math.sqrt(R * R - span * span / 4), ys = h.y1 - rise;
  h.sur = 0.3;
  F.reveal(P.groundL, { ...h, y1: ys }, 0, dep, P.revealCol, 'lr');
  F.archHead(P.groundL, h.u0, h.u1, base, ys, R, 0, dep, P.revealCol, L.door, P.doorCol, 6, true);
  const cy = ys - Math.sqrt(R * R - span * span / 4), a = Math.acos(span / 2 / R);
  F.ring(L.trim, (h.u0 + h.u1) / 2, cy, R, R + 0.32, a, Math.PI - a, 0, 0.05, P.trimCol, 10, 'fo');
  F.inst(N.trim, (h.u0 + h.u1) / 2, h.y1 + 0.14, 0.05, 0.3, 0.42, 0.06, P.trimCol);
  // planks and a wicket door, strap hinges
  const n = Math.round(span / 0.16);
  for (let i = 0; i < n; i++) {
    const u = h.u0 + (i + 0.5) * span / n;
    F.inst(N.door, u, base + (ys - base) / 2, dep, span / n - 0.025, ys - base - 0.05, 0.03, P.doorCol);
  }
  for (const y of [base + 0.6, base + 2.4]) for (const s of [-1, 1]) F.inst(N.iron, (h.u0 + h.u1) / 2 + s * span / 4, y, dep + 0.03, span / 2 - 0.2, 0.06, 0.02, P.ironCol);
  F.inst(N.door, (h.u0 + h.u1) / 2 + span / 4, base + 1.05, dep + 0.03, 0.85, 1.9, 0.02, shadeCol(P.doorCol, 0.8));
  for (const u of [h.u0 - 0.2, h.u1 + 0.2]) F.inst(N.stone, u, base + 0.3, 0, 0.3, 0.6, 0.3, 0xe0dcd4);
}

/** A ground-floor window: surround, sill, pane, joinery and an iron grille; arched on a bank. */
function groundWindow(B, P, F, h, arch) {
  const { L, N } = B;
  const d = P.depth, tc = P.trimCol, sb = 0.16;
  h.sur = sb;
  let ys = h.y1;
  if (arch) {
    ys = h.y1 - (h.u1 - h.u0) / 2;
    F.reveal(P.groundL, { ...h, y1: ys }, 0.04, -d, P.revealCol, 'blr');
    F.archHead(P.groundL, h.u0, h.u1, h.y0, ys, (h.u1 - h.u0) / 2, 0.04, -d, P.revealCol, L.glass, 0xf0f2f4, 6);
    F.ring(L.trim, (h.u0 + h.u1) / 2, ys, (h.u1 - h.u0) / 2, (h.u1 - h.u0) / 2 + sb, 0, Math.PI, 0, 0.04, tc, 10, 'fo');
    F.box(L.trim, h.u0 - sb, h.u0, h.y0, ys, 0, 0.04, tc, 'br');
    F.box(L.trim, h.u1, h.u1 + sb, h.y0, ys, 0, 0.04, tc, 'bl');
    F.inst(N.trim, (h.u0 + h.u1) / 2, h.y1 + 0.08, 0.04, 0.24, 0.36, 0.06, tc);
  } else {
    F.reveal(P.groundL, h, 0.04, -d, P.revealCol, 'tblr');
    pane(B, F, h.u0, h.u1, h.y0, h.y1, -d, 0xf0f2f4);
    F.box(L.trim, h.u0 - sb, h.u0, h.y0, h.y1 + sb, 0, 0.04, tc, 'br');
    F.box(L.trim, h.u1, h.u1 + sb, h.y0, h.y1 + sb, 0, 0.04, tc, 'bl');
    F.box(L.trim, h.u0, h.u1, h.y1, h.y1 + sb, 0, 0.04, tc, 'bdlr');
  }
  F.box(L.trim, h.u0 - sb - 0.06, h.u1 + sb + 0.06, h.y0 - 0.1, h.y0, 0, 0.17, tc, 'b');
  F.inst(P.paned ? N.win6 : N.win, (h.u0 + h.u1) / 2, (h.y0 + ys) / 2, -d + 0.005, h.u1 - h.u0 - 0.02, ys - h.y0 - 0.02, 0.07, P.frameCol);
  // the grille sits in the reveal
  F.inst(N.rail, (h.u0 + h.u1) / 2, (h.y0 + ys) / 2, -0.09, h.u1 - h.u0 - 0.04, ys - h.y0 - 0.04, 0.03, P.ironCol);
}

/** An arcade: arches on piers along the front, a walkable passage behind, shops at its back wall. */
function arcade(B, P, E) {
  const { L, N } = B;
  const F = E.F, len = E.len, bs = E.bays, base = P.base, top = P.ys[1];
  const t = 0.6, ad = 3.3, col = P.groundCol;
  const holes = [];
  for (let i = 0; i < bs.n; i++) {
    const a = bs.m + bs.p * i + 0.38, b = bs.m + bs.p * (i + 1) - 0.38;
    if (b - a < 1.2) continue;
    const span = b - a, ys = top - 0.65 - span / 2;
    holes.push({ u0: a, u1: b, y0: base, y1: ys + span / 2, ys });
  }
  const ceil = top - 0.4;
  F.wall(P.groundL, 0, len, base, top, holes, col);
  const BF = backFrame(F, len, -t);
  const back = holes.map((h) => ({ u0: len - h.u1, u1: len - h.u0, y0: h.y0, y1: h.y1, ys: h.ys }));
  BF.wall(P.groundL, 0, len, base, ceil, back, col);
  for (const h of holes) {
    F.reveal(P.groundL, { ...h, y1: h.ys }, 0, -t, col, 'lr');
    F.archHead(P.groundL, h.u0, h.u1, base, h.ys, (h.u1 - h.u0) / 2, 0, -t, col, null, 0, 8);
    F.ring(L.trim, (h.u0 + h.u1) / 2, h.ys, (h.u1 - h.u0) / 2, (h.u1 - h.u0) / 2 + 0.2, 0, Math.PI, 0, 0.04, P.trimCol, 10, 'fo');
    F.inst(N.trim, (h.u0 + h.u1) / 2, h.y1 + 0.1, 0.04, 0.28, 0.42, 0.07, P.trimCol);
    // impost blocks at the springing
    for (const u of [h.u0, h.u1]) F.box(L.trim, u - 0.12, u + 0.12, h.ys - 0.18, h.ys, 0, 0.06, P.trimCol, 'b');
  }
  for (const h of back) BF.archHead(P.groundL, h.u0, h.u1, base, h.ys, (h.u1 - h.u0) / 2, 0, 0, col, null, 0, 8);
  // passage: ceiling, ends, floor
  const light = mixCol(col, 0xffffff, 0.35);
  F.hface(P.groundL, 0, len, -ad, -t, ceil, light, -1);
  F.sface(P.groundL, 0, base, ceil, -ad, -t, light, 1);
  F.sface(P.groundL, len, base, ceil, -ad, -t, light, -1);
  F.hface(L.plinth, 0, len, -ad, 0, base + 0.012, 0xc8c0b0, 1);
  // lanterns hung in the bays
  for (const h of holes) {
    const u = (h.u0 + h.u1) / 2, w = -ad / 2 - 0.15;
    F.inst(N.iron, u, ceil - 0.12, w, 0.03, 0.24, 0.03, P.ironCol);
    F.inst(N.iron, u, ceil - 0.28, w, 0.24, 0.06, 0.24, P.ironCol);
    F.inst(B.F.lamp, u, ceil - 0.47, w, 0.17, 0.32, 0.17, 0xffffff);
    F.inst(N.iron, u, ceil - 0.65, w, 0.2, 0.04, 0.2, P.ironCol);
  }
  // the back wall with the shops
  const BW = F.shifted(0, -ad);
  const shopHoles = [], jobs = [];
  const use = 'shop';
  for (let i = 0; i < bs.n; i++) {
    const a = bs.m + bs.p * i + 0.42, b = bs.m + bs.p * (i + 1) - 0.42;
    if (b - a < 1.0) continue;
    const h = { u0: a, u1: b, y0: base, y1: base + 3.0 };
    shopHoles.push(h);
    jobs.push(() => shopfront(B, P, BW, h, { use, door: 'centre', sign: i === Math.floor(bs.n / 2), awning: false }));
  }
  BW.wall(P.groundL, 0, len, base, ceil, shopHoles, light);
  for (const j of jobs) j();
  // collision: the house behind the passage, the piers, the storeys over it
  const l = P.lot, s = E.side;
  const core = s === 'zp' ? [l.x0, l.x1, l.z0, l.z1 - ad] : s === 'zn' ? [l.x0, l.x1, l.z0 + ad, l.z1] : s === 'xp' ? [l.x0, l.x1 - ad, l.z0, l.z1] : [l.x0 + ad, l.x1, l.z0, l.z1];
  const strip = s === 'zp' ? [l.x0, l.x1, l.z1 - ad, l.z1] : s === 'zn' ? [l.x0, l.x1, l.z0, l.z0 + ad] : s === 'xp' ? [l.x1 - ad, l.x1, l.z0, l.z1] : [l.x0, l.x0 + ad, l.z0, l.z1];
  const rect = (u0, u1, w0, w1) => {
    const p = F.P(u0, 0, w0), q = F.P(u1, 0, w1);
    return [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[2], q[2]), Math.max(p[2], q[2])];
  };
  const piers = [];
  let u = 0;
  for (const h of holes) { if (h.u0 > u + 0.02) piers.push(rect(u, h.u0, -t, 0)); u = h.u1; }
  if (u < len - 0.02) piers.push(rect(u, len, -t, 0));
  piers.push(rect(0, 0.15, -ad, 0), rect(len - 0.15, len, -ad, 0));
  P.arcade = { core, strip, piers, y1: ceil };
  void Frame;
}
