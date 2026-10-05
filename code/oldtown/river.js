import { addWalkBox, physBoxAt } from '../engine/collision.js';
import { BOX, CYL, CYL_LO, PLANE, NEAR } from '../engine/parts.js';
import { T, CH, QY, WY, B, WALL, RIVER, PROM } from './plan.js';

/*
  The river: the water, the stone embankment walls down to it, the lower quays (paved, with
  mooring bollards and an iron railing at the water's edge), the stairs from the street down
  to them, the parapets along the top. And the town wall all round: crenellated, gate towers
  where the streets meet it, water gates where the river goes through.
*/

export function buildRiver(C, P) {
  const { M, batch } = C;
  const quay = C.box('quay', 'quay'), quayD = batch('quayD', BOX, M.quay, { cast: false, lod: NEAR });
  const water = batch('water', PLANE, M.water, { cast: false });
  const bed = batch('riverBed', PLANE, M.gravel, { cast: false });
  const iron = C.box('ironS', 'iron'), ironC = batch('ironC', CYL_LO, M.iron), ironD = batch('ironD', BOX, M.iron, { cast: false, lod: NEAR });
  const coping = C.box('coping', 'curb');
  const EXT = 330; // the water runs on out of the town (past the water gates)
  // water and bed, in tiles
  for (let x = -EXT; x < EXT; x += 30) {
    water.add(x + 15, WY, (RIVER.z0 + RIVER.z1) / 2, 30, 1, RIVER.z1 - RIVER.z0);
    bed.add(x + 15, 0.002, (RIVER.z0 + RIVER.z1) / 2, 30, 1, RIVER.z1 - RIVER.z0, 0x4a4438);
  }
  // ---------- embankment walls: from the bed up to street level, face on the channel ----------
  for (const [z, s] of [[RIVER.z0, -1], [RIVER.z1, 1]]) {
    for (let x = -B; x < B; x += 24) {
      const L = Math.min(24, B - x), cx = x + L / 2;
      quay.add(cx, T / 2, z + s * 0.3, L, T, 0.6, 0xffffff);
      // a darker band where the water has stained it, a string course at quay height, the coping
      quayD.add(cx, WY + 0.35, z - s * 0.01, L, 0.9, 0.02, 0x7a7262);
      quayD.add(cx, T - 0.55, z - s * 0.05, L, 0.18, 0.1, 0xd8d0c0);
    }
  }
  // ---------- the quays: paved platforms, an edge of granite, bollards, a railing at the water ----------
  const qside = (q) => (q.side < 0 ? [RIVER.z0, RIVER.q0] : [RIVER.q1, RIVER.z1]);
  for (const q of P.quays) {
    const [z0, z1] = qside(q), edge = q.side < 0 ? z1 : z0, s = q.side < 0 ? 1 : -1; // s: toward the water
    for (let x = q.x0; x < q.x1 - 0.01; x += 16) {
      const x1 = Math.min(q.x1, x + 16);
      quay.add((x + x1) / 2, QY / 2, (z0 + z1) / 2, x1 - x, QY, z1 - z0, 0xd6cfc0);
      addWalkBox(C.colliders, x, x1, z0, z1, QY, { noSeat: true });
      physBoxAt(C.colliders, (x + x1) / 2, QY / 2, (z0 + z1) / 2, x1 - x, QY, z1 - z0, { cam: true });
    }
    // granite edge and the end walls
    coping.add((q.x0 + q.x1) / 2, QY + 0.04, edge - s * 0.25, q.x1 - q.x0, 0.1, 0.5, 0xc8c2b6);
    // the railing at the water: posts, two rails; collision a thin wall people can't step over
    for (let x = q.x0 + 0.4; x <= q.x1 - 0.3; x += 2.2) ironC.add(x, QY + 0.5, edge - s * 0.18, 0.06, 1, 0.06);
    // (rails in 8 m lengths: near-only detail is judged by each piece's own place)
    for (const h of [0.55, 1.0]) for (let x = q.x0; x < q.x1 - 0.01; x += 8) { const xb = Math.min(q.x1, x + 8); ironD.add((x + xb) / 2, QY + h, edge - s * 0.18, xb - x + 0.01, 0.04, 0.04); }
    C.solidBox(q.x0, q.x1, Math.min(edge - s * 0.26, edge - s * 0.1), Math.max(edge - s * 0.26, edge - s * 0.1), QY, QY + 1.05);
    // mooring bollards and the odd iron ring in the wall
    for (let x = q.x0 + 5; x < q.x1 - 4; x += 9) {
      ironC.add(x, QY + 0.28, edge - s * 0.6, 0.3, 0.56, 0.3);
      C.solidCyl(x, edge - s * 0.6, 0.16, QY + 0.56);
      ironD.add(x + 2, QY + 1.4, (q.side < 0 ? RIVER.z0 : RIVER.z1) + s * 0.04, 0.5, 0.06, 0.06);
    }
    // the quay's ends against the bridge abutments / the town wall: a step of wall, nothing to fall off
    for (const x of [q.x0, q.x1]) C.solidBox(x - 0.3, x + 0.3, z0, z1, QY, T);
  }
  // ---------- stairs: a landing through a gap in the parapet, the flight down along the wall ----------
  for (const st of P.stairs) {
    const zw = st.z, s = st.side < 0 ? 1 : -1; // s: from the wall into the channel
    const za = zw, zb = zw + s * st.w, z0 = Math.min(za, zb), z1 = Math.max(za, zb), cz = (z0 + z1) / 2;
    const xl0 = Math.min(st.x, st.x + st.dir * st.landing), xl1 = Math.max(st.x, st.x + st.dir * st.landing);
    quay.add((xl0 + xl1) / 2, st.top / 2, cz, xl1 - xl0, st.top, z1 - z0, 0xd0c8b8);
    C.solidBox(xl0, xl1, z0, z1, 0, st.top);
    for (let i = 0; i < st.n; i++) {
      const top = st.top - (i + 1) * st.rise;
      if (top <= QY + 0.001) break;
      const xa = st.x + st.dir * (st.landing + i * st.run), xb = xa + st.dir * st.run;
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
      quay.add((x0 + x1) / 2, top / 2, cz, x1 - x0 + 0.002, top, z1 - z0, 0xd0c8b8);
      C.solidBox(x0, x1, z0, z1, 0, top);
    }
    // the balustrade on the open side, stepping down with the flight, and round the landing's end
    const zr = zb - s * 0.12;
    const xEnd = st.x + st.dir * st.len;
    const segN = 6;
    for (let k = 0; k < segN; k++) {
      const t0 = k / segN, t1 = (k + 1) / segN;
      const xa = st.x + st.dir * (st.len * t0), xb = st.x + st.dir * (st.len * t1);
      const ya = stairTop(st, xa), yb = stairTop(st, xb);
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), y = Math.min(ya, yb);
      quay.add((x0 + x1) / 2, y + 0.45, zr, x1 - x0, 0.9 + Math.abs(ya - yb), 0.24, 0xd8d0c0);
      C.solidBox(x0, x1, zr - 0.12, zr + 0.12, 0, Math.max(ya, yb) + 0.95);
    }
    void xEnd;
    // and across the landing's back end
    const xr = st.x - st.dir * 0.12;
    quay.add(xr, st.top / 2 + 0.45, cz, 0.24, st.top + 0.9, z1 - z0, 0xd8d0c0);
    C.solidBox(xr - 0.12, xr + 0.12, z0, z1, 0, st.top + 0.95);
    // a lamp at the landing
    C.lampAt?.(st.x + st.dir * 0.2, zw + s * 0.25, st.top, 'post');
  }
  // ---------- parapets along the top of both walls (gaps at the stairs, the bridges) ----------
  const gaps = (side) => {
    const g = P.bridges.map((b) => [b.x - b.w / 2 - 0.2, b.x + b.w / 2 + 0.2]);
    for (const st of P.stairs) if (st.side === side) g.push([Math.min(st.x, st.x + st.dir * st.landing), Math.max(st.x, st.x + st.dir * st.landing)]);
    return g.sort((a, b) => a[0] - b[0]);
  };
  for (const [z, side] of [[RIVER.z0, -1], [RIVER.z1, 1]]) {
    const top = side < 0 ? T + CH : T, s = side < 0 ? -1 : 1; // s: from the wall back onto the street
    const zc = z + s * 0.25;
    let a = -B;
    const run = (x0, x1) => {
      if (x1 - x0 < 0.3) return;
      for (let x = x0; x < x1 - 0.01; x += 16) {
        const xb = Math.min(x1, x + 16);
        quay.add((x + xb) / 2, top + 0.45, zc, xb - x, 0.9, 0.5, 0xd8d0c0);
        coping.add((x + xb) / 2, top + 0.95, zc, xb - x + 0.02, 0.1, 0.62, 0xd2ccc0);
        C.solidBox(x, xb, zc - 0.25, zc + 0.25, top, top + 1.0);
      }
    };
    for (const [g0, g1] of gaps(side)) { run(a, g0); a = Math.max(a, g1); }
    run(a, B);
  }
  void CYL;
}

/** The step top under x along a stair (the landing, then the flight). */
function stairTop(st, x) {
  const d = (x - st.x) * st.dir;
  if (d <= st.landing) return st.top;
  const i = Math.min(st.n - 1, Math.floor((d - st.landing) / st.run));
  return Math.max(QY, st.top - (i + 1) * st.rise);
}

// ---------- the town wall ----------
export function buildWall(C, P) {
  const { M, batch } = C;
  const wall = C.box('wall', 'stone'), merl = batch('merlon', BOX, M.stone), dark = batch('gateDark', BOX, M.iron, { cast: false });
  const roofC = batch('towerRoof', CYL_LO, M.roofTile), cone = C.roofCone;
  const H = T + 9, TH = 0.6;
  const sides = [
    { axis: 'x', c: -WALL + 1.5 }, { axis: 'x', c: WALL - 1.5 }, { axis: 'z', c: -WALL + 1.5 }, { axis: 'z', c: WALL - 1.5 },
  ];
  for (const sd of sides) {
    // gaps where the river runs out (the water gates span them)
    const runs = sd.axis === 'x' ? [[-WALL, RIVER.z0], [RIVER.z1, WALL]] : [[-WALL, WALL]];
    for (const [a0, a1] of runs) for (let a = a0; a < a1 - 0.01; a += 20) {
      const b = Math.min(a1, a + 20), m = (a + b) / 2;
      const [x, z, w, d] = sd.axis === 'x' ? [sd.c, m, 3, b - a] : [m, sd.c, b - a, 3];
      wall.add(x, H / 2, z, w, H, d, 0xd8cfbc);
      C.solidBox(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 0, H, { cam: true });
      // merlons along the inner edge
      for (let k = a + 0.6; k < b - 0.6; k += 2.2) {
        const [mx, mz] = sd.axis === 'x' ? [sd.c - Math.sign(sd.c) * 1.2, k] : [k, sd.c - Math.sign(sd.c) * 1.2];
        merl.add(mx, H + 0.6, mz, sd.axis === 'x' ? 0.6 : 1.2, 1.2, sd.axis === 'x' ? 1.2 : 0.6, 0xd2c8b4);
      }
    }
  }
  // corner towers
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (WALL - 2), z = sz * (WALL - 2);
    C.batch('towerC', CYL, M.stone).add(x, (H + 5) / 2, z, 9, H + 5, 9, 0xd2c8b4);
    roofC.add(x, H + 5.4, z, 9.6, 0.8, 9.6);
    cone.add(x, H + 9.8, z, 10, 8, 10);
    C.solidCyl(x, z, 4.5, H + 5);
  }
  // gate towers at the street ends: an arch with its gates shut
  for (const s of P.streets) for (const sg of [-1, 1]) {
    const along = sg * (WALL - 1.5), w = s.hi - s.lo + 4, gh = T + 16;
    const [x, z, W, D] = s.axis === 'z' ? [s.c, along, w, 9] : [along, s.c, 9, w];
    wall.add(x, gh / 2, z, W, gh, D, 0xe0d6c2);
    C.solidBox(x - W / 2, x + W / 2, z - D / 2, z + D / 2, 0, gh, { cam: true });
    const inner = sg * (WALL - 1.5 - 4.5) - sg * 0.02;
    // the arch (a dark recess with timber doors), a hipped roof
    const [ax, az, aw, ad] = s.axis === 'z' ? [s.c, inner, 6.5, 0.06] : [inner, s.c, 0.06, 6.5];
    dark.add(ax, T + 3.6, az, aw, 7.2, ad, 0x1a1612);
    C.batch('gateDoor', BOX, M.door, { cast: false }).add(ax - (s.axis === 'x' ? sg * 0.03 : 0), T + 3, az - (s.axis === 'z' ? sg * 0.03 : 0), s.axis === 'z' ? 5.8 : 0.06, 6, s.axis === 'z' ? 0.06 : 5.8, 0x5a3a24);
    C.hipRoof.add(x, gh, z, W + 0.8, 7, D + 0.8, 0xffffff);
  }
  // water gates: an arch over the river in each wall, an iron grille in it
  for (const sx of [-1, 1]) {
    const x = sx * (WALL - 1.5), zc = (RIVER.z0 + RIVER.z1) / 2, L = RIVER.z1 - RIVER.z0;
    wall.add(x, T + 4.5 + 2.25, zc, 3, H - T - 4.5 + 4.5, L, 0xd8cfbc);
    for (let z = RIVER.z0 + 1; z < RIVER.z1; z += 1.2) dark.add(x, (T + 4.5) / 2, z, 0.12, T + 4.5, 0.12, 0x222222);
    C.solidBox(x - 1.5, x + 1.5, RIVER.z0, RIVER.z1, 0, H, { cam: true });
  }
  // beyond the wall: fields (only the tops of tall views ever see them)
  const G = C.G;
  const fields = [[-420, -WALL, -420, RIVER.z0], [-420, -WALL, RIVER.z1, 420], [WALL, 420, -420, RIVER.z0], [WALL, 420, RIVER.z1, 420], [-WALL, WALL, -420, -WALL], [-WALL, WALL, WALL, 420]];
  for (const [x0, x1, z0, z1] of fields) G.grass.add((x0 + x1) / 2, T - 0.05, (z0 + z1) / 2, x1 - x0, 1, z1 - z0, 0x8a9a6a);
  void PROM;
}
