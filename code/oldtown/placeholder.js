import * as THREE from 'three';
import { BOX, CYL, CONE, NEAR } from '../engine/parts.js';
import { GROUND_FLOOR, UPPER_FLOOR } from './plan.js';
import { rng } from '../engine/rng.js';

/*
  Simple massing buildings (the same API as buildings/index.js: buildLots(C, lots),
  buildLandmark(C, site)). The Old Town uses buildings/ for its houses; this file still
  provides the roof shapes (PRISM, HIP) and the upper floors over the reserved buildings. Simple but in character: a plinth and a tinted
  body per lot, a cornice, rows of windows with sills, shopfronts with awnings, and a roof
  (gable, hip, mansard or a parapet); the landmarks as massing models.
*/

/** Gable roof: base 1 x 1 at y = 0, ridge along z at y = 1. */
export const PRISM = (() => {
  const g = new THREE.BufferGeometry();
  const p = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5, // front gable
    0.5, 0, 0.5, -0.5, 0, 0.5, 0, 1, 0.5,    // back gable
    -0.5, 0, 0.5, -0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5, // left slope
    0.5, 0, -0.5, 0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,    // right slope
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
})();
/** Hip roof: ridge along z over the middle half, hipped ends. */
export const HIP = (() => {
  const g = new THREE.BufferGeometry();
  const r = 0.25;
  const A = [-0.5, 0, -0.5], Bq = [0.5, 0, -0.5], Cq = [0.5, 0, 0.5], D = [-0.5, 0, 0.5], E = [0, 1, -r], F = [0, 1, r];
  const tri = (...v) => v.flat();
  const p = [...tri(A, E, Bq), ...tri(Cq, F, D), ...tri(D, F, E), ...tri(D, E, A), ...tri(Bq, E, F), ...tri(Bq, F, Cq)];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
})();

const SHUTTER = [0x3f5a3a, 0x5b6e7a, 0x7a3b2a, 0x3d4a5c, 0x6b5a3a, 0x2f4a40];
const AWN = [0x7a1f1f, 0x2e5a3f, 0x1f3a5e, 0xc9a13a, 0x5a2e4e, 0x2a2a2a, 0xb85a2a, 0x3d6a6e];

function kit(C) {
  if (C._ph) return C._ph;
  const { M, batch } = C;
  const NC = { cast: false, lod: NEAR };
  C._ph = {
    stucco: batch('b.stucco', BOX, M.stucco), stone: batch('b.stone', BOX, M.stone), brick: batch('b.brick', BOX, M.brick),
    plinth: batch('b.plinth', BOX, M.plinth), trim: batch('b.trim', BOX, M.trim), timber: batch('b.timber', BOX, M.timber, { cast: false }),
    glass: batch('b.glass', BOX, M.glass, { cast: false }), shopGlass: batch('b.shopGlass', BOX, M.shopGlass, { cast: false }),
    frame: batch('b.frame', BOX, M.frame, NC), sill: batch('b.sill', BOX, M.trim, NC), shutter: batch('b.shutter', BOX, M.shutter, NC),
    door: batch('b.door', BOX, M.door, { cast: false }), awning: batch('b.awning', BOX, M.awning, { cast: false }),
    tile: batch('b.roofTile', PRISM, M.roofTile), hipTile: batch('b.roofHip', HIP, M.roofTile), slate: batch('b.slate', BOX, M.slate),
    slateP: batch('b.slateP', PRISM, M.slate), zinc: batch('b.zinc', BOX, M.zinc), copper: batch('b.copper', BOX, M.copper),
    copperC: batch('b.copperCone', CONE, M.copper), stoneC: batch('b.stoneC', CYL, M.stone), stained: batch('b.stained', CYL, M.stainedGlass, { cast: false }),
    gold: batch('b.gold', CYL, M.gold, { cast: false }), iron: batch('b.iron', BOX, M.iron, NC), chimney: batch('b.chimney', BOX, M.brick),
  };
  return C._ph;
}

/** The wall faces of a rect: [side, centre x, z, outward normal, length]. */
function faces(r) {
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, W = r.x1 - r.x0, D = r.z1 - r.z0;
  return { zn: [cx, r.z0, 0, -1, W], zp: [cx, r.z1, 0, 1, W], xn: [r.x0, cz, -1, 0, D], xp: [r.x1, cz, 1, 0, D] };
}
/** A box on a wall: u along it, y up, out from it; w along, h, d out. */
function onWall(b, f, u, y, out, w, h, d, col, yaw0 = 0) {
  const [cx, cz, nx, nz] = f;
  const ux = -nz, uz = nx; // along the wall
  const x = cx + ux * u + nx * (out + d / 2), z = cz + uz * u + nz * (out + d / 2);
  const yaw = Math.atan2(nx, nz) + yaw0;
  b.add(x, y, z, w, h, d, col, yaw);
}

export function buildLots(C, lots) {
  for (const l of lots) { C.site.anchorAt((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2); house(C, l); C.site.anchorOff(); }
}

/** One house. opts.upperOnly: the ground floor is someone else's (the stores: sites.js). */
export function house(C, l, opts = {}) {
  const K = kit(C);
  const R = mini(l.seed);
  const W = l.x1 - l.x0, D = l.z1 - l.z0, cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
  const y0 = l.base, gf = GROUND_FLOOR, uf = UPPER_FLOOR;
  const eave = y0 + gf + l.floors * uf;
  const body = l.style === 'stone' ? K.stone : l.style === 'brick' ? K.brick : K.stucco;
  const tint = l.style === 'stucco' || l.style === 'timber' ? l.colour : 0xffffff;
  if (!opts.upperOnly) {
    // the ground floor: rusticated stone (rendered on timber houses)
    (l.style === 'timber' ? K.stucco : K.plinth).add(cx, y0 + gf / 2, cz, W, gf, D, l.style === 'timber' ? 0xd8cdb8 : 0xffffff);
    C.solidBox(l.x0, l.x1, l.z0, l.z1, y0, eave, { cam: true });
  }
  body.add(cx, (y0 + gf + eave) / 2, cz, W - 0.02, eave - y0 - gf, D - 0.02, tint);
  // cornice and the string course over the shops
  K.trim.add(cx, eave - 0.18, cz, W + 0.3, 0.36, D + 0.3, 0xe8e0d0);
  K.trim.add(cx, y0 + gf - 0.1, cz, W + 0.1, 0.2, D + 0.1, 0xddd4c4);
  roof(C, K, l, R, W, D, cx, cz, eave);
  const F = faces(l);
  const shutters = R() < 0.5 ? SHUTTER[(R() * SHUTTER.length) | 0] : null;
  for (const side of l.fronts) {
    const f = F[side], len = f[4];
    const bays = Math.max(1, Math.floor((len - 0.8) / 2.6)), sp = len / bays;
    for (let k = 0; k < l.floors; k++) {
      const yb = y0 + gf + k * uf;
      for (let i = 0; i < bays; i++) {
        const u = -len / 2 + (i + 0.5) * sp, h = k === 0 ? 1.9 : 1.7, y = yb + 0.95 + h / 2;
        onWall(K.glass, f, u, y, 0, 1.05, h, 0.04, R() < 0.12 ? 0xe8c890 : 0x9fb0bc);
        onWall(K.frame, f, u, y, 0.03, 1.15, h + 0.1, 0.03, 0xf0ece4);
        onWall(K.sill, f, u, yb + 0.9, 0, 1.4, 0.1, 0.18, 0xe6dccb);
        onWall(K.sill, f, u, y + h / 2 + 0.16, 0, 1.3, 0.22, 0.08, 0xe6dccb);
        if (shutters) for (const s of [-1, 1]) onWall(K.shutter, f, u + s * 0.82, y, 0.02, 0.5, h, 0.05, shutters);
      }
    }
    if (l.style === 'timber') timberFrame(K, f, y0 + gf, eave, l.floors, uf);
    if (!opts.upperOnly) shopfront(K, R, l, f, side === l.fronts[0]);
  }
}

function timberFrame(K, f, ya, yb, floors, uf) {
  const len = f[4];
  for (let k = 0; k <= floors; k++) onWall(K.timber, f, 0, ya + k * uf, 0.01, len, 0.2, 0.06, 0x3e2c20);
  for (let u = -len / 2 + 0.1; u <= len / 2; u += len / Math.max(2, Math.round(len / 1.3))) onWall(K.timber, f, u, (ya + yb) / 2, 0.01, 0.16, yb - ya, 0.06, 0x3e2c20);
}

function shopfront(K, R, l, f, main) {
  const len = f[4], y0 = l.base;
  if (l.groundUse === 'door' || !main) {
    // a front door, plain windows either side
    onWall(K.door, f, 0, y0 + 1.25, 0, 1.3, 2.5, 0.08, 0x4a3020);
    onWall(K.trim, f, 0, y0 + 2.65, 0, 1.7, 0.3, 0.12, 0xe6dccb);
    for (const s of [-1, 1]) if (len > 6) onWall(K.glass, f, s * len * 0.28, y0 + 2.2, 0, 1.2, 1.6, 0.04, 0x8fa0ac);
    return;
  }
  const w = len - 1.2;
  onWall(K.shopGlass, f, 0, y0 + 1.75, 0, w, 2.7, 0.05, 0x8a9aa6);
  onWall(K.timber, f, 0, y0 + 3.25, 0.02, w + 0.3, 0.7, 0.1, R() < 0.5 ? 0x2e4a3a : 0x5a2a20);
  for (const s of [-1, 1]) onWall(K.timber, f, s * w / 2, y0 + 1.6, 0.02, 0.2, 3.2, 0.12, 0x2e2a26);
  if (R() < 0.8) {
    const col = AWN[(R() * AWN.length) | 0];
    const ang = 0.35, d = 1.6;
    onWall(K.awning, f, 0, y0 + 3.0 - Math.sin(ang) * d / 2, 0.02 - (1 - Math.cos(ang)) * d / 2, w, 0.04, d, col);
  }
}

function roof(C, K, l, R, W, D, cx, cz, eave) {
  const along = l.fronts[0][0] === 'z' ? 'x' : 'z'; // ridge parallel to the main front
  const span = along === 'x' ? D : W, len = along === 'x' ? W : D;
  const yaw = along === 'x' ? Math.PI / 2 : 0;
  const pitch = l.roof === 'mansard' ? 0 : R.range(0.42, 0.62);
  if (l.roof === 'gable') K.tile.add(cx, eave, cz, span + 0.4, span * pitch, len + 0.1, 0xffffff, yaw);
  else if (l.roof === 'hip') K.hipTile.add(cx, eave, cz, span + 0.4, span * pitch * 0.9, len + 0.4, 0xffffff, yaw);
  else if (l.roof === 'mansard') {
    K.slate.add(cx, eave + 1.4, cz, W - 0.8, 2.8, D - 0.8, 0xffffff);
    K.slateP.add(cx, eave + 2.8, cz, span - 0.8, span * 0.18, len - 0.8, 0xffffff, yaw);
    K.zinc.add(cx, eave + 2.85, cz, W - 0.7, 0.1, D - 0.7, 0xffffff);
  } else {
    K.trim.add(cx, eave + 0.45, cz, W, 0.9, D, 0xe8e0d0);
    K.zinc.add(cx, eave + 0.9, cz, W - 0.8, 0.05, D - 0.8, 0x8a8a88);
  }
  // a chimney or two
  for (let k = R() < 0.6 ? 1 : 2; k > 0; k--) K.chimney.add(cx + R.range(-W / 3, W / 3), eave + 2.4, cz + R.range(-D / 3, D / 3), 0.6, 2.2, 0.9, 0xffffff);
}

// ---------- landmarks ----------
export function buildLandmark(C, s) {
  const K = kit(C);
  const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2, W = s.x1 - s.x0, D = s.z1 - s.z0, y0 = s.base;
  C.site.anchorAt(cx, cz);
  if (s.kind === 'cathedral') {
    // nave along z, front (twin towers) on the low-z side
    const H = 21, front = s.z0;
    K.stone.add(cx, y0 + H / 2, cz + 3, W - 10, H, D - 6, 0xffffff);                  // nave
    K.stone.add(cx, y0 + 7, cz + 3, W, 14, D - 14, 0xf0ece4);                        // aisles
    K.slateP.add(cx, y0 + H, cz + 3, W - 9.4, 9, D - 6, 0xffffff);
    K.slateP.add(cx, y0 + 14, cz + 3, W + 0.6, 3, D - 14, 0xffffff);
    K.stone.add(cx, y0 + H / 2 + 2, cz + 6, W + 8, H + 4, 12, 0xf4f0e8);              // transept
    K.slateP.add(cx, y0 + H + 4, cz + 6, 12.6, 8, W + 8, 0xffffff, Math.PI / 2);
    for (const sx of [-1, 1]) {
      const tx = cx + sx * (W / 2 - 5);
      K.stone.add(tx, y0 + 22, front + 5, 10, 44, 10, 0xf6f2ea);
      K.stone.add(tx, y0 + 47, front + 5, 7.5, 6, 7.5, 0xf6f2ea);
      K.copperC.add(tx, y0 + 58, front + 5, 7.4, 16, 7.4, 0xffffff);
      K.gold.add(tx, y0 + 66.6, front + 5, 0.3, 1.4, 0.3);
      C.solidBox(tx - 5, tx + 5, front, front + 10, y0, y0 + 44, { cam: true });
    }
    K.stained.add(cx, y0 + 15, front + 2.95, 6, 0.1, 6, 0xffffff, 0, Math.PI / 2); // rose window
    K.stone.add(cx, y0 + 12, front + 3, W - 20, 24, 6, 0xffffff);
    K.door.add(cx, y0 + 3.5, front - 0.05, 4, 7, 0.2, 0x3a2a1c);
    K.copperC.add(cx, y0 + H + 4 + 9 + 6, cz + 6, 3, 12, 3, 0xffffff);                 // the flèche over the crossing
    C.solidBox(s.x0 + 5, s.x1 - 5, front + 3, s.z1, y0, y0 + H, { cam: true });
    C.solidBox(s.x0, s.x1, front + 10, s.z1 - 4, y0, y0 + 14, { cam: true });
    C.solidBox(cx - W / 2 + 10, cx + W / 2 - 10, front, front + 6, y0, y0 + 24, { cam: true });
  } else if (s.kind === 'marketHall') {
    // an iron and glass hall: columns round an open floor, a long roof over it
    const H = 8;
    for (let x = s.x0 + 0.4; x <= s.x1 - 0.3; x += (W - 0.8) / 5) for (let z = s.z0 + 0.4; z <= s.z1 - 0.3; z += (D - 0.8) / 6) {
      const edge = x < s.x0 + 1 || x > s.x1 - 1 || z < s.z0 + 1 || z > s.z1 - 1;
      if (!edge) continue;
      K.iron.add(x, y0 + H / 2, z, 0.3, H, 0.3, 0x2a3a34);
      C.solidCyl(x, z, 0.2, y0 + H);
    }
    K.zinc.add(cx, y0 + H + 0.3, cz, W + 1.2, 0.6, D + 1.2, 0x9aa4a0);
    K.slateP.add(cx, y0 + H + 0.6, cz, W + 1.2, 5, D + 1.2, 0xc8d4d0);
    K.glass.add(cx, y0 + H + 4, cz, 3, 2, D - 2, 0xb8c8d0);
  } else if (s.kind === 'townHall') {
    const H = 17, front = s.z0;
    K.stone.add(cx, y0 + H / 2, cz, W, H, D, 0xece4d4);
    K.slateP.add(cx, y0 + H, cz, D + 0.4, 7, W + 0.4, 0xffffff, Math.PI / 2);
    K.stone.add(cx, y0 + 21, front + 3.5, 7, 42, 7, 0xf2ebdc);                        // the clock tower
    K.copperC.add(cx, y0 + 46, front + 3.5, 7.6, 8, 7.6, 0xffffff);
    K.gold.add(cx, y0 + 34, front - 0.05, 3, 0.1, 3, 0xffffff, 0, Math.PI / 2);         // the clock face
    for (let x = s.x0 + 2; x < s.x1 - 1; x += 4) K.trim.add(x, y0 + 2.5, front - 0.3, 0.9, 5, 0.6, 0xe0d8c8);
    C.solidBox(s.x0, s.x1, s.z0, s.z1, y0, y0 + H, { cam: true });
    C.solidBox(cx - 3.5, cx + 3.5, front, front + 7, y0, y0 + 42, { cam: true });
  } else {
    // a free-standing bell tower
    K.brick.add(cx, y0 + 15, cz, W, 30, D, 0xffffff);
    K.stone.add(cx, y0 + 30.5, cz, W + 0.6, 1, D + 0.6, 0xffffff);
    K.hipTile.add(cx, y0 + 31, cz, W + 0.6, 6, D + 0.6, 0xffffff);
    C.solidBox(s.x0, s.x1, s.z0, s.z1, y0, y0 + 30, { cam: true });
  }
  C.site.anchorOff();
}

/** A tiny seeded random for one house (its lot's seed). */
const mini = (seed) => rng(seed);
