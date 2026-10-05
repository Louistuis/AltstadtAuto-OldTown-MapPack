import { addWalkBox, physBoxAt } from '../engine/collision.js';
import { BOX, CYL, CYL_LO, NEAR, FAR } from '../engine/parts.js';
import { T, CH, QY, WY, RIVER } from './plan.js';

/*
  The bridges over the river. The road bridges: three stone arches on two piers with pointed
  cutwaters, a barrel vault under each arch and ring stones round it on both faces, solid
  abutments over the quays, a cornice, balustraded parapets with lamp pedestals over the piers,
  pavements behind kerbs, the tram rails on the avenue's. The footbridge: one iron bowstring
  span, ribs arching over a timber deck, hangers, railings.
*/

const SPANS = [[RIVER.q0, RIVER.q0 + 7], [RIVER.q0 + 8.5, RIVER.q0 + 15.5], [RIVER.q0 + 17, RIVER.q1]];
const SPRING = WY + 0.3; // the arches spring this high off the water

export function buildBridges(C, P) {
  for (const b of P.bridges) (b.kind === 'foot' ? footBridge : roadBridge)(C, b);
}

function roadBridge(C, b) {
  const { M, batch } = C;
  const stone = C.box('bStone', 'stone'), quay = C.box('quay', 'quay');
  const stoneD = batch('bStoneD', BOX, M.stone, { cast: false, lod: NEAR });
  const baluster = batch('baluster', CYL_LO, M.stone, { cast: false, lod: NEAR });
  const balFar = batch('balusterFar', BOX, M.stone, { cast: false, lod: FAR });
  const trim = C.box('bTrim', 'trim');
  const s = b.street, c = b.x, hw = b.w / 2, carr = b.carr, z0 = RIVER.z0, z1 = RIVER.z1;
  C.site.anchorAt(c, (z0 + z1) / 2);
  // ---------- deck: carriageway, pavements, kerbs; collision ----------
  addWalkBox(C.colliders, c - hw, c + hw, z0, z1, T, { noSeat: true, topOnly: true });
  physBoxAt(C.colliders, c, T - 0.5, (z0 + z1) / 2, b.w, 1, z1 - z0, { topOnly: true, cam: true });
  C.plane(s.kind === 'avenue' ? C.G.setts : C.G.asphalt, c - carr, c + carr, z0, z1, s.kind === 'avenue' ? 0xd8d0c4 : 0xffffff);
  for (const sd of [-1, 1]) {
    const e = c + sd * carr, o = c + sd * (hw - 0.5);
    C.slab(Math.min(e, o), Math.max(e, o), z0, z1);
    C.kerbLine(e, z0, z1, sd);
  }
  if (s.tram) for (const tr of [-1, 1]) for (const g of [-0.7175, 0.7175]) C.B.rail.add(c + tr * carr * 0.5 + g, T + 0.006, (z0 + z1) / 2, 0.07, 0.024, z1 - z0);
  // ---------- parapets: plinth, balusters, handrail; pedestals with lamps over the piers ----------
  const top = T + CH;
  for (const sd of [-1, 1]) {
    const x = c + sd * (hw - 0.25);
    stone.add(x, top + 0.12, (z0 + z1) / 2, 0.5, 0.24, z1 - z0, 0xe6dfd2);
    trim.add(x, top + 0.98, (z0 + z1) / 2, 0.58, 0.12, z1 - z0, 0xeee8dc);
    for (let z = z0 + 0.3; z < z1 - 0.2; z += 0.32) baluster.add(x, top + 0.58, z, 0.18, 0.7, 0.18, 0xe6dfd2);
    balFar.add(x, top + 0.58, (z0 + z1) / 2, 0.22, 0.7, z1 - z0, 0xd8d0c0);
    C.solidBox(x - 0.25, x + 0.25, z0, z1, top, top + 1.05);
    for (const pz of [z0 + 0.4, (SPANS[0][1] + SPANS[1][0]) / 2, (SPANS[1][1] + SPANS[2][0]) / 2, z1 - 0.4]) {
      stone.add(x, top + 0.6, pz, 0.7, 1.2, 0.8, 0xece6da);
      C.solidBox(x - 0.35, x + 0.35, pz - 0.4, pz + 0.4, top, top + 1.2);
      if (pz > z0 + 1 && pz < z1 - 1) C.lampAt?.(x, pz, top + 1.2, 'candelabra');
    }
  }
  // ---------- abutments over the quays (a pilaster's width wider than the deck), piers, cutwaters ----------
  for (const [a, e] of [[z0, RIVER.q0], [RIVER.q1, z1]]) {
    quay.add(c, (T - 1) / 2, (a + e) / 2, b.w + 1.6, T - 1, e - a, 0xe0d8c8);
    C.solidBox(c - hw - 0.8, c + hw + 0.8, a, e, 0, T - 0.02, { cam: true });
  }
  for (let i = 0; i < 2; i++) {
    const pa = SPANS[i][1], pb = SPANS[i + 1][0], pz = (pa + pb) / 2, pd = pb - pa;
    stone.add(c, (T - 0.6) / 2, pz, b.w, T - 0.6, pd, 0xe2dccf);
    stone.add(c, SPRING / 2, pz, b.w + 1.6, SPRING, pd + 0.3, 0xd6cfc0);       // the footing
    C.solidBox(c - hw - 0.8, c + hw + 0.8, pa - 0.15, pb + 0.15, 0, SPRING + 0.4, { cam: true });
    C.solidBox(c - hw, c + hw, pa, pb, 0, T - 1, { cam: true });
    for (const sd of [-1, 1]) {
      // pointed cutwaters up- and downstream, capped
      stone.add(c + sd * (hw + 0.2), (SPRING + 2.2) / 2, pz, pd / Math.SQRT2, SPRING + 2.2, pd / Math.SQRT2, 0xe2dccf, Math.PI / 4);
      stone.add(c + sd * (hw + 0.2), SPRING + 2.35, pz, pd / Math.SQRT2 + 0.1, 0.3, pd / Math.SQRT2 + 0.1, 0xd0c8b8, Math.PI / 4);
    }
  }
  // ---------- the arches: barrel vault, ring stones on both faces, spandrels filled to the deck ----------
  for (const [a, e] of SPANS) {
    const half = (e - a) / 2, zc = (a + e) / 2, rise = T - 1 - SPRING;
    const R = (half * half + rise * rise) / (2 * rise), yc = SPRING + rise - R, th0 = Math.asin(half / R);
    const N = 14;
    for (let k = 0; k < N; k++) {
      const t0 = -th0 + (2 * th0) * k / N, t1 = -th0 + (2 * th0) * (k + 1) / N, tm = (t0 + t1) / 2;
      const rm = R + 0.3, len = 2 * rm * Math.sin((t1 - t0) / 2) + 0.03;
      stone.add(c, yc + rm * Math.cos(tm), zc + rm * Math.sin(tm), b.w - 0.02, 0.6, len, k % 2 ? 0xd8d0c2 : 0xe0d8ca, 0, tm);
      // ring stones, proud of both faces; the keystone bigger
      const key = k === N / 2 || k === N / 2 - 1;
      for (const sd of [-1, 1]) stoneD.add(c + sd * (hw + 0.03), yc + (R + 0.38) * Math.cos(tm), zc + (R + 0.38) * Math.sin(tm), 0.08, key ? 0.95 : 0.78, len - 0.04, k % 2 ? 0xeee6d8 : 0xe2dacb, 0, tm);
    }
    // spandrels: upright slices from the vault's back up to under the deck
    for (let z = a; z < e - 0.01; z += 0.5) {
      const zm = Math.min(e, z + 0.5), zz = (z + zm) / 2, dz = Math.min(Math.abs(z - zc), Math.abs(zm - zc));
      const yb = yc + Math.sqrt(Math.max(0, (R + 0.55) ** 2 - dz * dz));
      if (yb >= T - 0.62) continue;
      stone.add(c, (yb + T - 0.6) / 2, zz, b.w, T - 0.6 - yb, zm - z, 0xe2dccf);
    }
  }
  // cornice along both faces under the parapet
  for (const sd of [-1, 1]) trim.add(c + sd * (hw + 0.05), T - 0.3, (z0 + z1) / 2, 0.3, 0.4, z1 - z0 + 0.6, 0xeee8dc);
  C.site.anchorOff();
  void QY; void CYL;
}

function footBridge(C, b) {
  const { M, batch } = C;
  const iron = C.box('fbIron', 'iron'), ironC = batch('ironC', CYL_LO, M.iron), ironD = batch('ironD', BOX, M.iron, { cast: false, lod: NEAR });
  const deck = C.box('fbDeck', 'timber');
  const c = b.x, hw = b.w / 2, z0 = RIVER.z0, z1 = RIVER.z1, top = T + CH;
  C.site.anchorAt(c, (z0 + z1) / 2);
  // the deck: a timber floor on an iron frame
  addWalkBox(C.colliders, c - hw, c + hw, z0, z1, top, { noSeat: true });
  physBoxAt(C.colliders, c, top - 0.2, (z0 + z1) / 2, b.w, 0.4, z1 - z0);
  for (let z = z0; z < z1 - 0.01; z += 2) deck.add(c, top - 0.04, z + 1, b.w - 0.3, 0.08, 1.96, 0xa88a68);
  iron.add(c, top - 0.3, (z0 + z1) / 2, b.w, 0.4, z1 - z0, 0x2a3530);
  // the two ribs: an arc over the deck from bank to bank, hangers down to its edges
  const L = z1 - z0, H = 4.6, zc = (z0 + z1) / 2, R = (L * L / 4 + H * H) / (2 * H), yc = top + H - R, th0 = Math.asin(L / 2 / R);
  for (const sd of [-1, 1]) {
    const x = c + sd * (hw - 0.05), N = 20;
    for (let k = 0; k < N; k++) {
      const t0 = -th0 + 2 * th0 * k / N, t1 = -th0 + 2 * th0 * (k + 1) / N, tm = (t0 + t1) / 2;
      const len = 2 * R * Math.sin((t1 - t0) / 2) + 0.02;
      iron.add(x, yc + R * Math.cos(tm), zc + R * Math.sin(tm), 0.16, 0.34, len, 0x2a3530, 0, tm);
    }
    for (let z = z0 + 2; z < z1 - 1; z += 2) {
      const yArc = yc + Math.sqrt(R * R - (z - zc) ** 2);
      if (yArc - top < 1.25) continue;
      ironD.add(x, (top + yArc) / 2, z, 0.05, yArc - top, 0.05, 0x2a3530);
    }
    // railings, their collision
    const xr = c + sd * (hw - 0.25);
    for (let z = z0 + 0.1; z < z1; z += 0.14) ironD.add(xr, top + 0.5, z, 0.025, 1, 0.025, 0x2a3530);
    ironC.add(xr, top + 1.05, zc, 0.06, z1 - z0, 0.06, 0x2a3530, 0, Math.PI / 2);
    for (let z = z0; z < z1 - 0.01; z += 8.5) ironD.add(xr, top + 0.1, z + 4.25, 0.04, 0.04, 8.5, 0x2a3530);
    C.solidBox(xr - 0.08, xr + 0.08, z0, z1, top, top + 1.1);
  }
  // cross-bracing over the middle, where the ribs are high enough
  for (let z = zc - 8; z <= zc + 8; z += 4) {
    const y = yc + Math.sqrt(R * R - (z - zc) ** 2);
    iron.add(c, y, z, b.w, 0.1, 0.12, 0x2a3530);
  }
  C.lampAt?.(c - hw + 0.25, zc - 6, top + 1.1, 'bracket');
  C.lampAt?.(c + hw - 0.25, zc + 6, top + 1.1, 'bracket');
  C.site.anchorOff();
}
