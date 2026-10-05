import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addWalkBox, physBoxAt } from '../engine/collision.js';
import { BOX, CYL_LO, PLANE, NEAR } from '../engine/parts.js';
import { HIP, PRISM } from './placeholder.js';
import { signTex } from './sites.js';
import { T, QY, RIVER } from './plan.js';

/*
  The Stadtgefängnis: the old town jail, on its own island in the river east of the Gerbergasse
  bridge, reached by a stone footbridge that steps up over the promenade's parapet and across
  the quay to the gate. Nothing of it touches the plan (no lot, no lane, no random number of
  the town's): it stands in the water, and the bridge lands on the open promenade.

  Along the island (x 112..162, z 29..49), west to east:
    the cell block     two storeys, four barred cells on a corridor, a barred window each
    the gatehouse      the gate (two iron leaves), the hall with the guard's desk and the key
                       hook, the booking office with the bail window
    the south wing     kitchen and laundry, a low service passage behind them, and the old
                       drain tunnel from under the second cell up into that passage
    the yard           walled 5.5 m high with wire on top, crates, a lean-to workshop
    the watchtower     at the north-east corner, a searchlight on its cabin
  Doors that open (the gate, the second cell's door, hall-corridor, hall-yard) are single merged
  meshes with a walk box each that a game can swing and unblock; everything else is batched
  into the town's own batches (a few dozen draw calls for the lot).

  Returns the prison's gameplay map (positions in world space): see the end of buildPrison.
*/

const I = { x0: 112, x1: 162, z0: 29, z1: 49 }; // the island
const WT = 0.7, PT = 0.4;                        // outer walls, partitions
const CB = { x0: 112, x1: 123.5, z0: 29, z1: 49, eaves: T + 7.9 };          // cell block
const HALL = { x0: 123.5, x1: 141, z0: 40, z1: 49, eaves: T + 9.6 };        // gatehouse
const WING = { x0: 123.5, x1: 147, z0: 29, z1: 37.2, eaves: T + 4.6 };      // kitchen + laundry
const PASS = { z0: 37.2, z1: 40 };                                           // service passage (x as the hall)
const SHOP = { x0: 147, x1: 155, z0: 29, z1: 37 };                           // workshop (lean-to)
const YARD = { x0: 141, x1: 162, z0: 37, z1: 48.3, top: T + 4.9 };          // exercise yard, wall top
const TOWER = { x0: 162, x1: 166, z0: 45, z1: 49, top: T + 11 };
const GATE = { x: 135, w: 3, h: 3.8 };
const CEIL = { cb: T + 3.6, hall: T + 4.2, wing: T + 3.3, pass: T + 2.6, shop: T + 2.5 };
const CELL_X = { x0: 112.7, x1: 117.9, bar: 118.1 };                         // a cell's inside, its barred front
const CORR = { x0: 118.3, x1: 122.8 };
const CELL_N = 4, CELL_P = (48.3 - 29.7) / CELL_N;                           // cells along z, pitch
const PLAYER_CELL = 1;
const TUN = { z0: 36.3, z1: 37.2, y: T - 1.32, x0: 115.6, x1: 125.3 };      // the drain tunnel
const BRIDGE = { x0: 133.5, x1: 136.5, deck: T + 1.6, zA: 49.6, zB: 52, zC: 57.4, zD: 59.8 };

const STONE = 0xcbc3b2, STONE_D = 0xb9b1a1, LIME = 0xe4ddcd, IRON = 0x1e2124, TIMBER = 0xa8825c;
const cellZ = (i) => ({ z0: 29.7 + CELL_P * i, z1: 29.7 + CELL_P * (i + 1) - (i < CELL_N - 1 ? PT : 0) });

export function buildPrison(C, P) {
  const { M, X, batch, colliders, scene } = C;
  const B = C.B;
  const stone = C.box('wall', 'stone'), lime = batch('p.lime', BOX, M.stucco), plinth = batch('p.plinth', BOX, M.plinth);
  const quay = C.box('quay', 'quay'), coping = C.box('coping', 'curb'), trim = batch('b.trim', BOX, M.trim);
  const dark = batch('gateDark', BOX, M.iron, { cast: false });
  const glass = batch('b.glass', BOX, M.glass, { cast: false }), slate = batch('p.slate', BOX, M.slate);
  const slateHip = batch('p.slateHip', HIP, M.slate), slateP = batch('p.slateP', PRISM, M.slate);
  const plain = batch('p.plain', BOX, X.plain, { cast: false }), plainC = batch('p.plainC', CYL_LO, X.plain, { cast: false });
  const timber = B.timber, ironB = B.ironB, ironD = batch('p.bars', BOX, M.iron, { cast: false }), ironC = B.ironC, glow = B.glow, crate = B.crate;
  const flag = C.G.flag, setts = C.G.setts;
  const solid = (x0, x1, z0, z1, y0, y1, extra) => C.solidBox(x0, x1, z0, z1, y0, y1, { cam: true, ...extra });
  /** A wall box (centre from its bounds) that blocks and stops the camera. */
  const wall = (b, x0, x1, z0, z1, y0, y1, col = STONE) => {
    if (x1 - x0 < 0.01 || z1 - z0 < 0.01 || y1 - y0 < 0.01) return;
    b.add((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, col);
    // (walk boxes are footprints from the ground up: a lintel, the wall over a window or a
    // ceiling slab is physics only, or it would fill the doorway / push everyone out of the room)
    if (y0 > T + 0.5) physBoxAt(colliders, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, { cam: true });
    else solid(x0, x1, z0, z1, y0, y1);
  };
  /** A wall along an axis with openings cut in it: gaps = [[a0, a1, y0, y1]] along the wall. */
  const pierced = (b, axis, u0, u1, a0, a1, y0, y1, gaps, col = STONE) => {
    const seg = (s, e, ya, yb) => (axis === 'z' ? wall(b, u0, u1, s, e, ya, yb, col) : wall(b, s, e, u0, u1, ya, yb, col));
    let a = a0;
    for (const g of [...gaps].sort((p, q) => p[0] - q[0])) {
      seg(a, g[0], y0, y1);
      seg(g[0], g[1], y0, g[2]);
      seg(g[0], g[1], g[3], y1);
      a = g[1];
    }
    seg(a, a1, y0, y1);
  };
  const floor = (b, x0, x1, z0, z1, y = T + 0.012, col = 0xffffff) => b.add((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, 1, z1 - z0, col);
  const lamp = (x, y, z, r = 4, col = 0xffd9a0) => { glow.add(x, y, z, 0.3, 0.1, 0.3, col); ironD.add(x, y + 0.08, z, 0.36, 0.06, 0.36, IRON); C.pools.push([x, z, y, r]); };
  /** A barred window: the hole is left by the wall builder; this adds the surround, the bars and the sill. */
  const barred = (axis, u, a, y0, y1, w, out) => {
    const n = Math.max(2, Math.round(w / 0.17));
    for (let i = 0; i < n; i++) {
      const o = -w / 2 + (w / (n - 1)) * i;
      if (axis === 'z') ironD.add(u, (y0 + y1) / 2, a + o, 0.05, y1 - y0, 0.05, IRON);
      else ironD.add(a + o, (y0 + y1) / 2, u, 0.05, y1 - y0, 0.05, IRON);
    }
    const s = out, sx = axis === 'z' ? 0.14 : w + 0.5, sz = axis === 'z' ? w + 0.5 : 0.14;
    const ux = axis === 'z' ? u + s * 0.04 : a, uz = axis === 'z' ? a : u + s * 0.04;
    trim.add(ux, y0 - 0.09, uz, sx, 0.18, sz, 0xe6dfd0);
    trim.add(ux, y1 + 0.09, uz, sx, 0.18, sz, 0xe6dfd0);
  };
  const shadowOf = (m) => { m.castShadow = false; m.receiveShadow = true; return m; };
  /** A door of iron bars (or a plank door): one merged mesh hung on a hinge at its edge, plus its walk box. */
  const doors = {};
  let grateBox = null;
  const door = (name, hinge, yaw0, w, h, kind, swing = Math.PI / 2) => {
    const parts = [];
    const box = (x, y, z, sx, sy, sz) => { const g = new THREE.BoxGeometry(sx, sy, sz); g.translate(x, y, z); parts.push(g); };
    if (kind === 'bars') {
      box(w / 2, h / 2, 0, w, 0.07, 0.07); box(w / 2, h - 0.04, 0, w, 0.07, 0.07); box(w / 2, h / 2, 0, 0.07, h, 0.07); box(w - 0.035, h / 2, 0, 0.07, h, 0.07);
      box(w / 2, 1.05, 0, w, 0.07, 0.07);
      const n = Math.round(w / 0.16);
      for (let i = 1; i < n; i++) box((w / n) * i, h / 2, 0, 0.04, h, 0.04);
      box(w - 0.12, 1.05, 0.06, 0.16, 0.22, 0.05); // the lock
    } else {
      box(w / 2, h / 2, 0, w, h, 0.08);
      for (const y of [0.3, h / 2, h - 0.3]) box(w / 2, y, 0.05, w - 0.1, 0.1, 0.03);
    }
    const geo = mergeGeometries(parts);
    const mesh = shadowOf(new THREE.Mesh(geo, kind === 'bars' ? M.iron : M.door));
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(hinge.x, hinge.y, hinge.z);
    g.rotation.y = yaw0;
    scene.add(g);
    // the leaf lies along +x of the hinge frame: its walk box when shut
    const dx = Math.cos(yaw0), dz = -Math.sin(yaw0);
    const x0 = Math.min(hinge.x, hinge.x + dx * w), x1 = Math.max(hinge.x, hinge.x + dx * w);
    const z0 = Math.min(hinge.z, hinge.z + dz * w), z1 = Math.max(hinge.z, hinge.z + dz * w);
    const wb = { minX: x0 - 0.08, maxX: x1 + 0.08, minZ: z0 - 0.08, maxZ: z1 + 0.08, top: hinge.y + h, noSeat: true };
    colliders.boxes.push(wb);
    const D = doors[name] = { group: g, yaw0, w, h, hinge: hinge.clone(), box: wb, shut: { ...wb }, open: 0, swing };
    D.set = (k) => { D.open = k; g.rotation.y = yaw0 + D.swing * k; const on = k < 0.35; Object.assign(wb, on ? D.shut : { minX: 1e6, maxX: 1e6 + 0.01, minZ: 1e6, maxZ: 1e6 + 0.01 }); };
    return D;
  };

  const cx = (I.x0 + I.x1) / 2, cz = (I.z0 + I.z1) / 2;
  C.site.anchorAt(cx, cz);

  // ---------- the island: a stone block in the river, the tunnel cut through it ----------
  {
    const tile = (x0, x1, z0, z1, y0, top) => {
      quay.add((x0 + x1) / 2, (y0 + top) / 2, (z0 + z1) / 2, x1 - x0, top - y0, z1 - z0, 0xb0a898);
      addWalkBox(colliders, x0, x1, z0, z1, top, { noSeat: true, topOnly: true });
      physBoxAt(colliders, (x0 + x1) / 2, (y0 + top) / 2, (z0 + z1) / 2, x1 - x0, top - y0, z1 - z0, { topOnly: true, cam: true });
    };
    // in 16 m-ish pieces, the tunnel's strip left open above its floor
    const xs = [I.x0, TUN.x0, TUN.x1, 145, I.x1];
    for (let k = 0; k < xs.length - 1; k++) {
      const x0 = xs[k], x1 = xs[k + 1];
      if (k === 1) { tile(x0, x1, I.z0, TUN.z0, 0, T); tile(x0, x1, TUN.z0, TUN.z1, 0, TUN.y); tile(x0, x1, TUN.z1, I.z1, 0, T); }
      else { tile(x0, x1, I.z0, 39, 0, T); tile(x0, x1, 39, I.z1, 0, T); }
    }
    tile(TOWER.x0, TOWER.x1, TOWER.z0, TOWER.z1, 0, T);
    // the water line and a coping all round
    const edge = (x0, x1, z0, z1) => { quay.add((x0 + x1) / 2, 0.8, (z0 + z1) / 2, x1 - x0 + 0.06, 0.9, z1 - z0 + 0.06, 0x6f685a); coping.add((x0 + x1) / 2, T + 0.03, (z0 + z1) / 2, x1 - x0 + 0.1, 0.08, z1 - z0 + 0.1, 0xc4bdb0); };
    edge(I.x0 - 0.02, I.x1 + 0.02, I.z0 - 0.02, I.z0 + 0.3); edge(I.x0 - 0.02, I.x1 + 0.02, I.z1 - 0.3, I.z1 + 0.02);
    edge(I.x0 - 0.02, I.x0 + 0.3, I.z0, I.z1); edge(I.x1 - 0.3, I.x1 + 0.02, I.z0, I.z1);
    edge(TOWER.x0, TOWER.x1 + 0.02, TOWER.z0 - 0.02, TOWER.z1 + 0.02);
  }

  // ---------- the cell block ----------
  {
    const { x0, x1, z0, z1, eaves } = CB;
    const cells = Array.from({ length: CELL_N }, (_, i) => cellZ(i));
    // west face: a barred window per cell at eye height, and the upper floor's row
    const win = cells.map((c) => [(c.z0 + c.z1) / 2 - 0.45, (c.z0 + c.z1) / 2 + 0.45, T + 1.9, T + 2.9]);
    pierced(stone, 'z', x0, x0 + WT, z0, z1, T, eaves, win);
    for (const c of cells) {
      const zc = (c.z0 + c.z1) / 2;
      barred('z', x0 + WT / 2, zc, T + 1.9, T + 2.9, 0.9, -1);
      // upper floor: a shuttered window (dark glass flush, bars, a sill)
      dark.add(x0 + 0.02, T + 6, zc, 0.06, 1.3, 0.9, 0x151515);
      barred('z', x0 - 0.02, zc, T + 5.4, T + 6.6, 0.9, -1);
    }
    // north and south gables, the east wall shared with the hall (door D1) and the kitchen
    wall(stone, x0, x1, z0, z0 + WT, T, eaves);
    wall(stone, x0, x1, z1 - WT, z1, T, eaves);
    pierced(stone, 'z', x1 - WT, x1, z0 + WT, z1 - WT, T, eaves, [[46.2, 48.0, T, T + 2.3], [30.3, 32.1, T, T + 2.3]]);
    // a string course and a cornice
    trim.add((x0 + x1) / 2, T + 4.0, z0 - 0.08, x1 - x0 + 0.16, 0.22, 0.16, 0xd8d0c0);
    trim.add(x0 - 0.08, T + 4.0, (z0 + z1) / 2, 0.16, 0.22, z1 - z0 + 0.16, 0xd8d0c0);
    trim.add((x0 + x1) / 2, eaves + 0.1, (z0 + z1) / 2, x1 - x0 + 0.5, 0.3, z1 - z0 + 0.5, 0xd8d0c0);
    slateHip.add((x0 + x1) / 2, eaves + 0.25, (z0 + z1) / 2, x1 - x0 + 0.8, 3.6, z1 - z0 + 0.8, 0x4a4f58);
    C.batch('b.chimney', BOX, M.brick).add(x0 + 3, eaves + 3.2, z0 + 4, 0.8, 2.2, 0.8, 0x8a5a44);
    // inside: the corridor floor, the cells, the ceiling slab
    floor(flag, x0 + WT, x1 - WT, z0 + WT, z1 - WT, T + 0.012, 0xd8d2c6);
    wall(stone, x0 + WT, x1 - WT, z0 + WT, z1 - WT, CEIL.cb, CEIL.cb + 0.3, 0xbdb5a4);
    cells.forEach((c, i) => {
      const { z0: a, z1: b } = c, zc = (a + b) / 2;
      // partitions (limewashed), the barred front, its door
      if (i < CELL_N - 1) wall(lime, CELL_X.x0, CORR.x0, b, b + PT, T, CEIL.cb, LIME);
      lime.add((CELL_X.x0 + CELL_X.x1) / 2, (T + CEIL.cb) / 2, a + 0.001, CELL_X.x1 - CELL_X.x0, CEIL.cb - T, 0.002, LIME);
      // the front: bars floor to ceiling either side of a 0.9 m door
      const dz0 = zc - 0.45, dz1 = zc + 0.45;
      for (const [s, e] of [[a, dz0], [dz1, b]]) {
        const n = Math.max(1, Math.round((e - s) / 0.16));
        for (let k = 0; k <= n; k++) ironD.add(CELL_X.bar, (T + CEIL.cb) / 2, s + ((e - s) * k) / n, 0.05, CEIL.cb - T, 0.05, IRON);
        ironB.add(CELL_X.bar, T + 1.05, (s + e) / 2, 0.07, 0.07, e - s, IRON);
        solid(CELL_X.bar - 0.1, CELL_X.bar + 0.1, s, e, T, CEIL.cb);
      }
      ironB.add(CELL_X.bar, CEIL.cb - 0.04, zc, 0.09, 0.09, b - a, IRON);
      ironB.add(CELL_X.bar, T + 0.04, zc, 0.09, 0.09, b - a, IRON);
      if (i === PLAYER_CELL) door('cell', new THREE.Vector3(CELL_X.bar, T, dz0), -Math.PI / 2, 0.9, CEIL.cb - T - 0.1, 'bars', Math.PI / 2);
      else {
        // (the others' doors stand shut, batched)
        for (let k = 0; k <= 5; k++) ironD.add(CELL_X.bar, (T + CEIL.cb) / 2, dz0 + 0.9 * k / 5, 0.045, CEIL.cb - T - 0.1, 0.045, IRON);
        solid(CELL_X.bar - 0.1, CELL_X.bar + 0.1, dz0, dz1, T, CEIL.cb);
      }
      // the bunk along the north partition, a thin mattress, a folded blanket; the toilet; a shelf
      timber.add(CELL_X.x0 + 1.15, T + 0.42, a + 0.5, 2.0, 0.08, 0.8, TIMBER);
      for (const [lx, lz] of [[0.25, 0.15], [2.05, 0.15], [0.25, 0.85], [2.05, 0.85]]) timber.add(CELL_X.x0 + lx, T + 0.22, a + lz, 0.07, 0.44, 0.07, TIMBER);
      plain.add(CELL_X.x0 + 1.15, T + 0.53, a + 0.5, 1.96, 0.14, 0.76, 0xcfc6b2);
      plain.add(CELL_X.x0 + 0.45, T + 0.66, a + 0.5, 0.5, 0.12, 0.6, 0x5a6a7a);
      solid(CELL_X.x0 + 0.15, CELL_X.x0 + 2.15, a + 0.1, a + 0.9, T, T + 0.6, { seatYaw: 0 });
      plainC.add(CELL_X.x0 + 0.45, T + 0.21, b - 0.5, 0.42, 0.42, 0.42, 0xe8e6e0);
      plain.add(CELL_X.x0 + 0.2, T + 0.95, b - 0.5, 0.2, 0.42, 0.44, 0xe8e6e0);
      C.solidCyl(CELL_X.x0 + 0.45, b - 0.5, 0.22, T + 0.42);
      timber.add(CELL_X.x1 - 0.25, T + 1.4, b - 0.6, 0.5, 0.04, 0.9, TIMBER);
      lamp(CORR.x0 + 2.2, CEIL.cb - 0.08, zc, 4.2);
      lamp(CELL_X.x0 + 2.6, CEIL.cb - 0.08, zc, 3.4, 0xe8dcc8);
    });
  }

  // ---------- the drain tunnel: from under the second cell to the service passage ----------
  {
    const { z0, z1, y, x0, x1 } = TUN, zc = (z0 + z1) / 2;
    // steps down at the west end, up at the east end (6 each, 0.225)
    const steps = (xa, dir) => {
      for (let i = 0; i < 6; i++) {
        const top = T - 0.22 * (i + 1);
        const s = xa + dir * 0.3 * i, e = s + dir * 0.3;
        const a = Math.min(s, e), b = Math.max(s, e);
        quay.add((a + b) / 2, (y + top) / 2, zc, b - a, top - y, z1 - z0, 0x9a9282);
        addWalkBox(colliders, a, b, z0, z1, top, { noSeat: true });
        physBoxAt(colliders, (a + b) / 2, (y + top) / 2, zc, b - a, top - y, z1 - z0, { cam: true });
      }
    };
    steps(x0, 1);
    steps(x1, -1);
    // walls and ceiling of the strip (the cell floor and the passage floor above it)
    wall(quay, x0, x1, z0 - 0.3, z0, 0, T + 0.01, 0x8a8274);
    wall(quay, x0, x1, z1, z1 + 0.3, 0, T + 0.01, 0x8a8274);
    quay.add((x0 + 1.8 + x1 - 1.8) / 2, T - 0.1, zc, x1 - x0 - 3.6, 0.2, z1 - z0 + 0.6, 0x7a7264);
    // the pipes along it, a drip of light at each end
    ironC.add((x0 + x1) / 2, T - 0.35, z0 + 0.12, x1 - x0, 0.14, 0.14, 0x3a3a3c, 0, 0, Math.PI / 2);
    ironC.add((x0 + x1) / 2, T - 0.6, z0 + 0.12, x1 - x0, 0.08, 0.08, 0x5a4a3a, 0, 0, Math.PI / 2);
    // the floor over the tunnel between the two holes (the cell's and the passage's)
    quay.add((x0 + 1.8 + x1 - 1.8) / 2, T - 0.12, zc, x1 - x0 - 3.6, 0.24, z1 - z0, 0x7a7264);
    addWalkBox(colliders, x0 + 1.8, x1 - 1.8, z0, z1, T, { noSeat: true, topOnly: true });
    physBoxAt(colliders, (x0 + x1) / 2, T - 0.12, zc, x1 - x0 - 3.6, 0.24, z1 - z0, { topOnly: true, cam: true });
    // the cell's grate: loose, lifted by the player (a game can swap its walk box out)
    for (let k = 0; k < 5; k++) ironD.add(x0 + 0.9, T + 0.03, z0 + 0.12 + 0.165 * k, 1.8, 0.04, 0.05, IRON);
    ironB.add(x0 + 0.9, T + 0.03, zc, 1.84, 0.05, z1 - z0, IRON);
    grateBox = { minX: x0, maxX: x0 + 1.8, minZ: z0, maxZ: z1, top: T, noSeat: true, topOnly: true };
    colliders.boxes.push(grateBox);
  }

  // ---------- the gatehouse: the hall, the gate, the office with the bail window ----------
  {
    const { x0, x1, z0, z1, eaves } = HALL;
    const g0 = GATE.x - GATE.w / 2, g1 = GATE.x + GATE.w / 2;
    // north face: the gate arch, two windows either side; east face: door D2; south: the passage door
    pierced(stone, 'x', z1 - WT, z1, x0, x1, T, eaves, [[g0, g1, T, T + GATE.h], [127.5, 128.7, T + 1.6, T + 3.4], [129.6, 130.8, T + 1.6, T + 3.4], [138.2, 139.4, T + 1.6, T + 3.4]]);
    for (const wx of [128.1, 130.2, 138.8]) { barred('x', z1 - WT / 2, wx, T + 1.6, T + 3.4, 1.2, 1); glass.add(wx, T + 2.5, z1 - 0.2, 1.1, 1.7, 0.04, 0xffd9a0); }
    pierced(stone, 'z', x1 - WT, x1, z0, z1 - WT, T, eaves, [[43.2, 45.0, T, T + 2.3]]);
    pierced(stone, 'x', z0, z0 + WT, x0, x1 - WT, T, eaves, [[134, 135.4, T, T + 2.2]]);
    // the upper floors' windows (two rows, dark glass, trim), the arch's keystone and the sign over it
    // (a frame round each, a sill, a cross of glazing bars: never a slab over the glass; none where the sign goes)
    for (const f of [[z1 + 0.02, 1], [z0 - 0.02, -1]]) for (let wx = 125.5; wx < 139.6; wx += 2.8) {
      for (const wy of [T + 5.4, T + 7.9]) {
        if (f[1] > 0 && wy < T + 6 && Math.abs(wx - GATE.x) < 2.7) continue;
        const u = f[0] + f[1] * 0.03;
        dark.add(wx, wy, f[0], 1.1, 1.5, 0.06, 0x151515);
        trim.add(wx, wy + 0.8, u, 1.34, 0.12, 0.1, 0xd8d0c0); trim.add(wx, wy - 0.84, u + f[1] * 0.04, 1.44, 0.12, 0.18, 0xd8d0c0);
        for (const sx of [-0.61, 0.61]) trim.add(wx + sx, wy, u, 0.12, 1.6, 0.1, 0xd8d0c0);
        trim.add(wx, wy + 0.18, u - f[1] * 0.02, 1.1, 0.05, 0.04, 0xe6dfd0); trim.add(wx, wy, u - f[1] * 0.02, 0.05, 1.5, 0.04, 0xe6dfd0);
      }
    }
    trim.add(GATE.x, T + GATE.h + 0.25, z1 - 0.04, GATE.w + 0.9, 0.5, 0.26, 0xd8d0c0);
    trim.add(GATE.x, T + GATE.h + 0.65, z1 - 0.04, 0.7, 0.9, 0.3, 0xe6dfd0);
    for (const sx of [-1, 1]) trim.add(GATE.x + sx * (GATE.w / 2 + 0.15), T + GATE.h / 2, z1 - 0.04, 0.3, GATE.h, 0.26, 0xd8d0c0);
    const sign = shadowOf(new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.86), new THREE.MeshStandardMaterial({ map: signTex('STADTGEFÄNGNIS', '#2b2d31', '#d9cfb8'), roughness: 0.6 })));
    sign.position.set(GATE.x, T + GATE.h + 1.75, z1 + 0.05);
    scene.add(sign);
    trim.add((x0 + x1) / 2, eaves + 0.1, (z0 + z1) / 2, x1 - x0 + 0.5, 0.3, z1 - z0 + 0.5, 0xd8d0c0);
    slateHip.add((x0 + x1) / 2, eaves + 0.25, (z0 + z1) / 2, z1 - z0 + 0.8, 4.2, x1 - x0 + 0.8, 0x4a4f58, Math.PI / 2);
    C.batch('b.chimney', BOX, M.brick).add(x1 - 3, eaves + 3.6, z0 + 3, 0.9, 2.6, 0.9, 0x8a5a44);
    // the gate: two iron leaves hung on the arch's piers, opening inward
    door('gateL', new THREE.Vector3(g0 + 0.05, T, z1 - WT / 2), 0, GATE.w / 2 - 0.05, GATE.h - 0.15, 'bars', Math.PI / 2 - 0.25);
    door('gateR', new THREE.Vector3(g1 - 0.05, T, z1 - WT / 2), Math.PI, GATE.w / 2 - 0.05, GATE.h - 0.15, 'bars', -Math.PI / 2 + 0.25);
    // the hall: flagstones, a ceiling, the desk facing the gate, the key hook on the south wall
    floor(flag, x0, x1 - WT, z0 + WT, z1 - WT, T + 0.012, 0xd8d2c6);
    wall(stone, x0, x1 - WT, z0 + WT, z1 - WT, CEIL.hall, CEIL.hall + 0.3, 0xbdb5a4);
    timber.add(132, T + 0.78, 42.6, 2.2, 0.08, 0.9, TIMBER); timber.add(132, T + 0.38, 42.6, 2.0, 0.72, 0.7, 0x8a6a4c);
    solid(130.9, 133.1, 42.15, 43.05, T, T + 0.82);
    plain.add(132.6, T + 0.86, 42.5, 0.4, 0.08, 0.3, 0xf0ead8);                     // the ledger
    plain.add(131.3, T + 0.95, 42.4, 0.28, 0.26, 0.2, 0x1a1a1a);                     // the radio
    timber.add(132, T + 0.5, 41.6, 0.5, 0.06, 0.5, TIMBER); timber.add(132, T + 0.25, 41.6, 0.08, 0.5, 0.08, TIMBER); // the stool
    plain.add(133, T + 1.7, z0 + WT + 0.03, 0.5, 0.3, 0.05, 0x8a7a66);               // the key board
    for (let k = 0; k < 3; k++) ironD.add(132.85 + 0.15 * k, T + 1.62, z0 + WT + 0.07, 0.03, 0.08, 0.03, IRON);
    plain.add(133, T + 1.52, z0 + WT + 0.08, 0.06, 0.14, 0.02, 0xd9b440);           // the key, on the middle hook
    lamp(128, CEIL.hall - 0.08, 46, 4.5); lamp(136, CEIL.hall - 0.08, 46, 4.5); lamp(132, CEIL.hall - 0.08, 42, 4.5);
    // a bench along the north wall for whoever's waiting, a notice board
    timber.add(130.5, T + 0.45, z1 - WT - 0.3, 2.2, 0.06, 0.4, TIMBER); solid(129.4, 131.6, z1 - WT - 0.5, z1 - WT - 0.1, T, T + 0.48, { seatYaw: Math.PI });
    plain.add(x1 - WT - 0.03, T + 1.9, 47, 0.04, 0.8, 1.2, 0x6b5a46);
    // the office: a partition with the door and the bail window (a counter, a grille over it)
    pierced(lime, 'z', 128.6, 129, z0 + WT, 45.5, T, CEIL.hall, [[44.3, 45.5, T, T + 2.2], [41.6, 43.4, T + 1.1, T + 2.3]], LIME);
    wall(lime, x0, 129, 45.5, 45.5 + PT, T, CEIL.hall, LIME);
    timber.add(128.8, T + 1.08, 42.5, 0.6, 0.06, 1.9, TIMBER);
    for (let k = 0; k <= 10; k++) ironD.add(128.8, T + 1.7, 41.6 + 0.18 * k, 0.03, 1.2, 0.03, IRON);
    plain.add(128.95, T + 2.4, 42.5, 0.04, 0.18, 1.1, 0xf0ead8);                     // KASSE
    // a standing-open plank door into the office
    timber.add(128.8 + 0.04, T + 1.1, 44.3 + 0.55, 0.06, 2.2, 1.1, 0x5a4232, 1.3);
    // the booking wall: a height board (bands of light and dark), the camera on its tripod, the lamp
    plain.add(x0 + 0.02, T + 1.5, 43, 0.04, 2.2, 1.6, 0xf2eee4);
    for (let k = 0; k < 10; k++) plain.add(x0 + 0.045, T + 0.6 + 0.22 * k, 43, 0.02, 0.04, 1.6, k % 2 ? 0x2a2a2a : 0x8a8a8a);
    ironC.add(126.5, T + 0.7, 43, 0.05, 1.4, 0.05, IRON); plain.add(126.5, T + 1.5, 43, 0.22, 0.18, 0.3, 0x1c1c1c);
    lamp(126.3, CEIL.hall - 0.08, 43, 3.6, 0xf4efe6);
    timber.add(126.5, T + 0.76, 41.4, 1.4, 0.06, 0.7, TIMBER); solid(125.8, 127.2, 41.05, 41.75, T, T + 0.78);
    floor(flag, x0, 128.6, z0 + WT, 45.5, T + 0.013, 0xd0cabb);
  }

  // ---------- the south wing: kitchen, laundry, the passage behind them ----------
  {
    const { x0, x1, z0, z1, eaves } = WING;
    // south face with small high windows, the east gable, the north wall with the doors into the passage
    const wins = [];
    for (let wx = 126; wx < x1 - 2; wx += 3.2) wins.push([wx - 0.4, wx + 0.4, T + 2.1, T + 2.9]);
    pierced(stone, 'x', z0, z0 + WT, x0, x1, T, eaves, wins);
    for (const w of wins) barred('x', z0 + WT / 2, (w[0] + w[1]) / 2, T + 2.1, T + 2.9, 0.8, -1);
    wall(stone, x1 - WT, x1, z0, z1, T, eaves);
    pierced(stone, 'x', z1 - 0.6, z1, x0, x1, T, eaves, [[139, 140.4, T, T + 2.1]]);
    // the kitchen / laundry partition and its door; the corridor's door is in the cell block's east wall
    pierced(lime, 'z', 136.8, 137.2, z0 + WT, z1 - 0.6, T, CEIL.wing, [[31, 32.4, T, T + 2.1]], LIME);
    floor(flag, x0, x1 - WT, z0 + WT, z1 - 0.6, T + 0.012, 0xd8d2c6);
    wall(stone, x0, x1 - WT, z0 + WT, z1 - 0.6, CEIL.wing, CEIL.wing + 0.3, 0xbdb5a4);
    slateP.add((x0 + x1) / 2, eaves, (z0 + z1) / 2, z1 - z0 + 0.8, 2.8, x1 - x0 + 0.6, 0x4a4f58, Math.PI / 2);
    trim.add((x0 + x1) / 2, eaves - 0.1, (z0 + z1) / 2, x1 - x0 + 0.4, 0.26, z1 - z0 + 0.5, 0xd8d0c0);
    C.batch('b.chimney', BOX, M.brick).add(131, eaves + 2.2, z0 + 2, 1.1, 2.6, 0.9, 0x8a5a44);
    // kitchen: the long table and benches, the range, the pot shelf (the spoon's on the table)
    timber.add(130, T + 0.78, 33, 5.5, 0.08, 0.9, TIMBER); for (const lx of [127.6, 132.4]) timber.add(lx, T + 0.38, 33, 0.1, 0.72, 0.8, TIMBER);
    solid(127.25, 132.75, 32.55, 33.45, T, T + 0.82);
    for (const bz of [31.9, 34.1]) { timber.add(130, T + 0.45, bz, 5.2, 0.06, 0.3, TIMBER); solid(127.4, 132.6, bz - 0.15, bz + 0.15, T, T + 0.48, { seatYaw: bz < 33 ? 0 : Math.PI }); }
    plain.add(134.5, T + 0.45, z0 + WT + 0.5, 1.8, 0.9, 0.9, 0x2a2a2c); plain.add(134.5, T + 0.93, z0 + WT + 0.5, 1.8, 0.06, 0.9, 0x404043);
    solid(133.6, 135.4, z0 + WT, z0 + WT + 1, T, T + 0.95);
    for (let k = 0; k < 4; k++) plainC.add(134 + 0.3 * k, T + 1.05, z0 + WT + 0.5, 0.26, 0.18, 0.26, 0x3a3a3a);
    timber.add(125.5, T + 1.9, z0 + WT + 0.15, 2.2, 0.05, 0.3, TIMBER); for (let k = 0; k < 5; k++) plainC.add(124.7 + 0.4 * k, T + 2.05, z0 + WT + 0.15, 0.2, 0.26, 0.2, 0xc8c2b8);
    plain.add(131.4, T + 0.84, 33.1, 0.22, 0.02, 0.05, 0xd8d8dc);                   // the spoon
    lamp(130, CEIL.wing - 0.08, 33, 4.5); lamp(134, CEIL.wing - 0.08, 31, 3.6);
    // laundry: tubs, a mangle, shelves of folded sheets, a drying line; the cart is left to a game (it moves)
    for (const tx of [139, 141, 143]) { plainC.add(tx, T + 0.4, z0 + WT + 0.8, 1.1, 0.8, 1.1, 0x9a9690); C.solidCyl(tx, z0 + WT + 0.8, 0.55, T + 0.8); plainC.add(tx, T + 0.78, z0 + WT + 0.8, 0.95, 0.06, 0.95, 0x6a7a8a); }
    timber.add(145.2, T + 0.5, 32, 0.7, 1.0, 1.4, TIMBER); ironC.add(145.2, T + 1.15, 32, 0.3, 0.6, 0.3, IRON, 0, Math.PI / 2); solid(144.85, 145.55, 31.3, 32.7, T, T + 1.3);
    for (const sy of [T + 1.0, T + 1.7, T + 2.4]) { timber.add(141.5, sy, z1 - 0.6 - 0.25, 7, 0.05, 0.5, TIMBER); for (let k = 0; k < 6; k++) plain.add(138.6 + 1.15 * k, sy + 0.14, z1 - 0.6 - 0.25, 0.7, 0.24, 0.42, k % 2 ? 0xe8e4dc : 0xcfd6dc); }
    solid(138, 145, z1 - 1.1, z1 - 0.6, T, T + 2.6);
    ironD.add(141.5, T + 2.5, 32.5, 7, 0.02, 0.02, 0x8a8a8a);
    for (let k = 0; k < 6; k++) plain.add(138.8 + 1.1 * k, T + 2.1, 32.5, 0.7, 0.8, 0.02, k % 2 ? 0xe8e4dc : 0xcfd6dc);
    lamp(141.5, CEIL.wing - 0.08, 33, 4.5);
    // the passage: low ceiling, pipes, the one lamp; a standing-open door at each end's threshold
    floor(flag, HALL.x0, HALL.x1 - WT, PASS.z0, PASS.z1, T + 0.012, 0xcac3b4);
    wall(stone, HALL.x0, HALL.x1 - WT, PASS.z0, PASS.z1, CEIL.pass, CEIL.pass + 0.3, 0xa8a090);
    ironC.add((HALL.x0 + HALL.x1 - WT) / 2, CEIL.pass - 0.2, PASS.z1 - 0.2, HALL.x1 - WT - HALL.x0 - 0.4, 0.16, 0.16, 0x4a4a4c, 0, 0, Math.PI / 2);
    ironC.add((HALL.x0 + HALL.x1 - WT) / 2, CEIL.pass - 0.45, PASS.z1 - 0.2, HALL.x1 - WT - HALL.x0 - 0.4, 0.1, 0.1, 0x6a5040, 0, 0, Math.PI / 2);
    lamp(132, CEIL.pass - 0.08, 38.6, 4, 0xe0d4bc); lamp(125, CEIL.pass - 0.08, 38.6, 3.2, 0xe0d4bc);
    timber.add(139 + 0.55, T + 1.05, z1 - 0.6 - 0.04, 1.1, 2.1, 0.06, 0x5a4232, -1.2);
    timber.add(134 + 0.7, T + 1.1, HALL.z0 + 0.04, 1.4, 2.2, 0.06, 0x5a4232, 1.25);
    // the passage's grate stands pushed up, leaning on the wall beside its hole; the passage's east end is walled, a slate lid over it
    for (let k = 0; k < 5; k++) ironD.add(TUN.x1 + 0.08, T + 0.85, TUN.z0 + 0.12 + 0.165 * k, 0.05, 1.8, 0.05, IRON, 0, 0, -0.25);
    wall(stone, HALL.x1 - WT, HALL.x1, PASS.z0, PASS.z1, T, CEIL.pass + 0.5);
    slate.add((HALL.x0 + HALL.x1) / 2, CEIL.pass + 0.42, (PASS.z0 + PASS.z1) / 2, HALL.x1 - HALL.x0, 0.14, PASS.z1 - PASS.z0 + 0.3, 0x4a4f58);
  }

  // ---------- the yard, its wall and the wire, the workshop, the tower ----------
  {
    const { x0, x1, z0, z1, top } = YARD;
    floor(setts, x0, x1 - WT, z0 + 0.2, z1, T + 0.012, 0xd8d2c6);
    // the walls: north (the island's face), east, and south between the workshop and the east wall
    wall(stone, x0, x1, z1, z1 + WT, T, top, STONE_D);
    wall(stone, x1 - WT, x1, z0, z1, T, top, STONE_D);
    wall(stone, SHOP.x1, x1 - WT, z0, z0 + 0.6, T, top, STONE_D);
    // the wire: a rail and crossed strands along the top
    for (const [ax, a0, a1, u] of [['x', x0 + 0.3, x1 - 0.3, z1 + WT / 2], ['z', z0, z1 + WT, x1 - WT / 2], ['x', SHOP.x1, x1 - WT, z0 + 0.3]]) {
      const L = a1 - a0, m = (a0 + a1) / 2;
      if (ax === 'x') ironD.add(m, top + 0.55, u, L, 0.03, 0.03, 0x8a8e94); else ironD.add(u, top + 0.55, m, 0.03, 0.03, L, 0x8a8e94);
      for (let a = a0 + 0.25; a < a1 - 0.2; a += 0.5) {
        for (const s of [-1, 1]) {
          if (ax === 'x') ironD.add(a, top + 0.35, u, 0.025, 0.7, 0.025, 0x8a8e94, 0, s * 0.55, 0);
          else ironD.add(u, top + 0.35, a, 0.025, 0.7, 0.025, 0x8a8e94, 0, 0, s * 0.55);
        }
      }
    }
    // the crates against the workshop and the wall: two tiers to climb, a water butt, the roof's tank
    // (stacked against the east wall in a rough staircase, a metre a step: the way up, with a jump at the top)
    const crates = [[157.0, 37.6, 0], [158.1, 37.6, 0], [157.55, 37.6, 1], [160.75, 38.2, 0], [160.75, 39.25, 0], [160.75, 39.25, 1], [160.75, 40.3, 0], [160.75, 40.3, 1], [160.75, 40.3, 2], [160.75, 41.35, 0], [160.75, 41.35, 1], [160.75, 41.35, 2], [160.75, 41.35, 3], [159.7, 41.35, 0]];
    for (const [kx, kz, lvl] of crates) { crate.add(kx, T + 0.5 + lvl * 1.0, kz, 1.0, 1.0, 1.0, 0x9a7a52); solid(kx - 0.5, kx + 0.5, kz - 0.5, kz + 0.5, T + lvl, T + 1 + lvl); }
    plainC.add(154.5, T + 0.5, z0 + 1.2, 0.9, 1.0, 0.9, 0x4a5a3a); C.solidCyl(154.5, z0 + 1.2, 0.45, T + 1.0);
    // a bench, a wall lamp either side of the yard door, a drain in the middle
    timber.add(145, T + 0.45, z1 - 0.9, 2.2, 0.06, 0.4, TIMBER); solid(143.9, 146.1, z1 - 1.1, z1 - 0.7, T, T + 0.48, { seatYaw: Math.PI });
    C.lampAt(HALL.x1 + 0.05, 42.2, T + 3.6, 'wall', [1, 0]); C.lampAt(HALL.x1 + 0.05, 46.0, T + 3.6, 'wall', [1, 0]);
    C.lampAt(x1 - WT - 0.05, 40, T + 3.6, 'wall', [-1, 0]);
    ironD.add(151, T + 0.015, 43, 0.6, 0.02, 0.6, 0x3a3a3a);
    // the workshop: a lean-to against the south wall, its door onto the yard, a bench and tools inside
    const S = SHOP;
    pierced(stone, 'x', S.z1 - 0.6, S.z1, S.x0, S.x1, T, CEIL.shop + 0.4, [[150, 151.4, T, T + 2.1]]);
    wall(stone, S.x1 - WT, S.x1, S.z0, S.z1 - 0.6, T, CEIL.shop + 1.0);
    wall(stone, S.x0, S.x1, S.z0, S.z0 + WT, T, CEIL.shop + 1.1);
    floor(flag, S.x0, S.x1 - WT, S.z0 + WT, S.z1 - 0.6, T + 0.012, 0xcac3b4);
    const sl = Math.atan2(0.7, S.z1 - S.z0);
    slate.add((S.x0 + S.x1) / 2, CEIL.shop + 0.75, (S.z0 + S.z1) / 2, S.x1 - S.x0 + 0.4, 0.16, Math.hypot(S.z1 - S.z0, 0.7) + 0.4, 0x4a4f58, 0, sl);
    physBoxAt(colliders, (S.x0 + S.x1) / 2, CEIL.shop + 0.85, (S.z0 + S.z1) / 2, S.x1 - S.x0, 0.5, S.z1 - S.z0, { cam: true }); // (a roof over the bench: physics only, the inside stays walkable)
    plainC.add(S.x0 + 2, CEIL.shop + 1.55, S.z0 + 2.5, 1.4, 0.9, 1.4, 0x5a6066);
    timber.add(151, T + 0.85, S.z0 + 1.1, 4, 0.1, 0.8, TIMBER); for (const lx of [149.2, 152.8]) timber.add(lx, T + 0.4, S.z0 + 1.1, 0.12, 0.8, 0.7, TIMBER);
    solid(149, 153, S.z0 + 0.7, S.z0 + 1.5, T, T + 0.9);
    ironB.add(152.3, T + 0.95, S.z0 + 1.0, 0.3, 0.1, 0.3, 0x3a3a3a); ironD.add(150.2, T + 0.93, S.z0 + 1.1, 0.36, 0.04, 0.08, 0xc43a2a); // the vice; the cutters
    plain.add(S.x0 + WT + 0.03, T + 1.7, 32.5, 0.05, 1.0, 2.4, 0x6b5a46);
    for (let k = 0; k < 6; k++) ironD.add(S.x0 + WT + 0.08, T + 1.7, 31.5 + 0.4 * k, 0.03, 0.5, 0.05, 0x8a8e94);
    lamp(151, CEIL.shop - 0.08, 33, 4);
    // the tower: the shaft, a cabin of glass, the roof, the searchlight on its stand
    const Tw = TOWER, tx = (Tw.x0 + Tw.x1) / 2, tz = (Tw.z0 + Tw.z1) / 2;
    wall(stone, Tw.x0, Tw.x1, Tw.z0, Tw.z1, T, Tw.top, STONE_D);
    for (let y = T + 2.5; y < Tw.top - 1.5; y += 3) dark.add(Tw.x1 + 0.02, y, tz, 0.06, 0.9, 0.5, 0x151515);
    trim.add(tx, Tw.top + 0.15, tz, Tw.x1 - Tw.x0 + 0.8, 0.3, Tw.z1 - Tw.z0 + 0.8, 0xd8d0c0);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ironB.add(tx + sx * 1.9, Tw.top + 1.5, tz + sz * 1.9, 0.18, 2.4, 0.18, IRON); }
    glass.add(tx, Tw.top + 1.5, tz, Tw.x1 - Tw.x0 + 0.5, 2.2, Tw.z1 - Tw.z0 + 0.5, 0xffd9a0);
    wall(stone, Tw.x0 - 0.4, Tw.x1 + 0.4, Tw.z0 - 0.4, Tw.z1 + 0.4, Tw.top + 2.7, Tw.top + 3.0, 0x4a4f58);
    slateHip.add(tx, Tw.top + 3.0, tz, Tw.x1 - Tw.x0 + 1.2, 1.6, Tw.z1 - Tw.z0 + 1.2, 0x4a4f58);
    ironC.add(tx - 1.2, Tw.top + 3.4, tz - 1.2, 0.12, 0.8, 0.12, IRON);
    C.pools.push([tx, tz, Tw.top + 0.6, 6]);
  }

  // ---------- the footbridge: up over the parapet, across the quay, down to the promenade ----------
  {
    const { x0, x1, deck, zA, zB, zC, zD } = BRIDGE, xm = (x0 + x1) / 2;
    const step = (z0, z1, top) => { quay.add(xm, (T - 0.6 + top) / 2, (z0 + z1) / 2, x1 - x0, top - (T - 0.6), z1 - z0, 0xd0c8b8); addWalkBox(colliders, x0, x1, z0, z1, top, { noSeat: true }); physBoxAt(colliders, xm, (T - 0.6 + top) / 2, (z0 + z1) / 2, x1 - x0, top - (T - 0.6), z1 - z0, { cam: true }); };
    const n = 8, rise = (deck - T) / n;
    for (let i = 0; i < n; i++) { step(zA + 0.3 * i, zA + 0.3 * (i + 1), T + rise * (i + 1)); step(zD - 0.3 * (i + 1), zD - 0.3 * i, T + rise * (i + 1)); }
    // the deck (a slab clearing the parapet), its abutment in the moat, the balustrades
    quay.add(xm, deck - 0.2, (zB + zC) / 2, x1 - x0, 0.4, zC - zB, 0xd0c8b8);
    addWalkBox(colliders, x0, x1, zB, zC, deck, { noSeat: true });
    physBoxAt(colliders, xm, deck - 0.2, (zB + zC) / 2, x1 - x0, 0.4, zC - zB, { cam: true });
    quay.add(xm, (T - 0.6) / 2, (I.z1 + 51.0) / 2, x1 - x0 - 0.2, T - 0.6, 51.0 - I.z1, 0xb0a898);
    physBoxAt(colliders, xm, (T - 0.6) / 2, (I.z1 + 51.0) / 2, x1 - x0 - 0.2, T - 0.6, 51.0 - I.z1, { cam: true });
    for (const sx of [x0 + 0.12, x1 - 0.12]) {
      quay.add(sx, deck + 0.45, (zB + zC) / 2, 0.24, 0.9, zC - zB, 0xd8d0c0); coping.add(sx, deck + 0.95, (zB + zC) / 2, 0.3, 0.1, zC - zB + 0.02, 0xd2ccc0);
      solid(sx - 0.12, sx + 0.12, zB, zC, deck, deck + 1.0);
      // along the flights: a sloping run, drawn as a few short boxes
      for (let i = 0; i < 4; i++) {
        const za = zA + 0.6 * i, top = T + rise * (2 * i + 2);
        quay.add(sx, top + 0.45, za + 0.3, 0.24, 0.9 + rise * 2, 0.6, 0xd8d0c0); solid(sx - 0.12, sx + 0.12, za, za + 0.6, T, top + 0.95);
        const zb = zD - 0.6 * (i + 1);
        quay.add(sx, top + 0.45, zb + 0.3, 0.24, 0.9 + rise * 2, 0.6, 0xd8d0c0); solid(sx - 0.12, sx + 0.12, zb, zb + 0.6, T, top + 0.95);
      }
    }
    C.lampAt(x1 - 0.12, zC - 0.4, deck + 1.0, 'bracket'); C.lampAt(x0 + 0.12, zB + 0.4, deck + 1.0, 'bracket');
    C.lampAt(GATE.x - 2.3, I.z1 + 0.15, T + 3.2, 'wall', [0, 1]); C.lampAt(GATE.x + 2.3, I.z1 + 0.15, T + 3.2, 'wall', [0, 1]);
  }
  // the hall's two inner doors
  door('d1', new THREE.Vector3(CB.x1 - WT / 2, T, 46.2), -Math.PI / 2, 1.8, 2.25, 'bars', -Math.PI / 2);
  door('d2', new THREE.Vector3(HALL.x1 - WT / 2, T, 43.2), -Math.PI / 2, 1.8, 2.25, 'bars', Math.PI / 2);
  for (const d of Object.values(doors)) d.set(0);
  C.site.anchorOff();

  // the lamp over the stalls keeps the promenade walkers' lines: nothing of the prison claimed there
  void P; void QY; void RIVER; void PLANE; void NEAR;
  const pc = cellZ(PLAYER_CELL);
  return {
    island: I, yard: YARD, hall: HALL, cellBlock: CB, wing: WING, shop: SHOP, tower: TOWER, passage: { x0: HALL.x0, x1: HALL.x1 - WT, ...PASS }, corridor: { ...CORR, z0: 29.7, z1: 48.3 },
    cells: Array.from({ length: CELL_N }, (_, i) => ({ ...cellZ(i), x0: CELL_X.x0, x1: CELL_X.x1 })),
    cell: { ...pc, x0: CELL_X.x0, x1: CELL_X.x1, stand: new THREE.Vector3(CELL_X.x0 + 2.6, T, (pc.z0 + pc.z1) / 2 + 1.0), bunk: new THREE.Vector3(CELL_X.x0 + 1.15, T, pc.z0 + 0.5) },
    doors, gate: { x: GATE.x, z: HALL.z1 - WT / 2, out: new THREE.Vector3(GATE.x, T, HALL.z1 + 0.5), in: new THREE.Vector3(GATE.x, T, HALL.z1 - 1.6) },
    desk: new THREE.Vector3(132, T, 43.8), hook: new THREE.Vector3(133, T, HALL.z0 + WT + 0.6), bail: new THREE.Vector3(129.6, T, 42.5), booking: new THREE.Vector3(124.6, T, 43),
    spoon: new THREE.Vector3(131.4, T + 0.84, 33.1), cutters: new THREE.Vector3(150.2, T + 0.93, SHOP.z0 + 1.1), cart: new THREE.Vector3(143.5, T, 34.5),
    grate: new THREE.Vector3(TUN.x0 + 0.9, T, (TUN.z0 + TUN.z1) / 2), grateOut: new THREE.Vector3(TUN.x1 - 0.9, T, (TUN.z0 + TUN.z1) / 2), tunnel: TUN,
    crates: new THREE.Vector3(160.75, T, 38.2), wallTop: new THREE.Vector3(161.62, YARD.top, 41.35), grateBox, searchlight: new THREE.Vector3((TOWER.x0 + TOWER.x1) / 2 - 1.2, TOWER.top + 3.9, (TOWER.z0 + TOWER.z1) / 2 - 1.2),
    bridge: { ...BRIDGE, land: new THREE.Vector3((BRIDGE.x0 + BRIDGE.x1) / 2, T, BRIDGE.zD + 1.2) },
    posts: [
      { pos: new THREE.Vector3(132, T, 43.6), yaw: 0 },                 // the desk
      { pos: new THREE.Vector3(CORR.x0 + 2.2, T, 47.2), yaw: Math.PI }, // the corridor's end
      { pos: new THREE.Vector3(148, T, 46.5), yaw: -Math.PI / 2 },      // the yard
    ],
    patrol: [new THREE.Vector3(120.5, T, 31), new THREE.Vector3(120.5, T, 47), new THREE.Vector3(126, T, 46.5), new THREE.Vector3(138, T, 44), new THREE.Vector3(150, T, 42), new THREE.Vector3(158, T, 46), new THREE.Vector3(146, T, 39)],
    cartPath: [new THREE.Vector3(143.5, T, 34.5), new THREE.Vector3(139.7, T, 34.5), new THREE.Vector3(139.7, T, 38.6), new THREE.Vector3(134.7, T, 38.6), new THREE.Vector3(134.7, T, 44), new THREE.Vector3(GATE.x, T, HALL.z1 - 0.9), new THREE.Vector3(GATE.x, T, 49.75)],
    codeWalls: [[CELL_X.x0 + 0.03, T + 1.3, pc.z0 + 2.6], [CELL_X.x0 + 2.0, T + 1.1, pc.z1 - 0.03], [CELL_X.x0 + 4.4, T + 1.6, pc.z0 + 0.03], [CELL_X.x0 + 0.03, T + 0.9, pc.z1 - 1.0]],
  };
}
