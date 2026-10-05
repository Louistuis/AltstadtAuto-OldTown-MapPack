import * as THREE from 'three';
import { addWalkBox, addPhysBox, addWalkCyl, physCylAt } from '../engine/collision.js';
import { BOX, CYL, CYL_LO, SPHERE, CONE, NEAR, FAR } from '../engine/parts.js';
import * as Pr from './streetprops.js';
import { SPECS, paintFor, parkedKind } from '../engine/parking.js';
import { T, CH, END, RIVER, PROM, inside } from './plan.js';
import { BO } from './streets.js';

/*
  Street furniture and the life of the streets, all batched: cast-iron lantern posts, wall
  lanterns in the lanes, candelabra on the bridges; benches, bollards, bins, bike racks; café
  terraces (tables and chairs that can be knocked about, parasols over them); the market's
  stalls and its fountain, the well; parked scooters and cars; tram stops and the tram's
  overhead wires; finger posts; the traffic signals; placeholder trees on the plan's tree spots.
  Everything keeps off the walking lines (navLines) and out of everything else's way.
*/

const IRON = 0x22272a, GREEN_IRON = 0x24382f;
const SCOOTER = [0x9cc9b8, 0xe8d8b0, 0xc94a3a, 0x6d8fb0, 0xf2efe6, 0x3a3a3a, 0xd9a441];
const STRIPES = [[0xb8322a, 0xf2ece0], [0x2e5a3f, 0xf2ece0], [0x1f3a5e, 0xf2ece0], [0xc9a13a, 0x7a3b2a], [0x5a2e4e, 0xf2ece0]];
const CAR_COLS = [0x8a1f1f, 0x2a4d8f, 0xdedede, 0x1d1d1f, 0x6d7278, 0x2e6b4a, 0xc9a13a, 0x9cc9b8, 0xe5e1d6, 0x5a3a2a];

/** The kit: batches, keep-out circles, the props kit (streetprops.js) and the lamp builder. Made before anything that places lamps. */
export function furnitureKit(C) {
  const { M, batch, colliders, X } = C;
  const B = C.B;
  B.ironC = batch('ironC', CYL_LO, M.iron);
  B.ironCD = batch('ironCD', CYL_LO, M.iron, { cast: false, lod: NEAR });
  B.ironB = batch('ironB', BOX, M.iron);
  B.ironD = batch('ironD', BOX, M.iron, { cast: false, lod: NEAR });
  B.ironCone = batch('ironCone', CONE, M.iron, { cast: false });
  B.glow = batch('lampGlow', BOX, X.lampGlow, { cast: false });
  // (the light each lantern throws on the ground below it: filled in by lightPools())
  C.pools = [];
  B.timber = batch('fTimber', BOX, M.timber);
  B.fabric = batch('fFabric', BOX, M.awning, { cast: false });
  B.fabricCone = batch('fFabricCone', CONE, M.awning);
  B.stoneC = batch('fStoneC', CYL, M.stone);
  B.stone = batch('fStone', BOX, M.stone);
  B.waterC = batch('fWater', CYL, M.water, { cast: false });
  B.gold = batch('fGold', CYL_LO, M.gold, { cast: false });
  B.paintD = batch('fPaint', BOX, M.shutter, { cast: false });  // small painted things (tinted)
  B.crate = batch('fCrate', BOX, M.shutter, { cast: false, lod: NEAR }); // produce on the stalls (tinted)
  B.bark = batch('fBark', CYL_LO, M.timber);
  B.leafNear = batch('fLeaf', SPHERE, M.grass, { lod: NEAR });
  B.leafFar = batch('fLeafFar', SPHERE, M.grass, { cast: false, lod: FAR });
  B.tyre = batch('fTyre', CYL_LO, M.iron, { cast: false, lod: NEAR });

  // ---------- keep-out circles, and the walking lines ----------
  const occupied = [], occGrid = new Map(), OCC = 8;
  const cellsOf = (x0, x1, z0, z1, f) => {
    for (let i = Math.floor(x0 / OCC), i1 = Math.floor(x1 / OCC); i <= i1; i++) for (let j = Math.floor(z0 / OCC), j1 = Math.floor(z1 / OCC); j <= j1; j++) f((i + 2048) * 4096 + j + 2048);
  };
  const free = C.free = (x, z, r) => {
    let hit = false;
    cellsOf(x - r - 1, x + r + 1, z - r - 1, z + r + 1, (k) => {
      if (!hit) hit = (occGrid.get(k) || []).some(([ox, oz, or]) => Math.hypot(x - ox, z - oz) < r + or);
    });
    return !hit;
  };
  const claim = C.claim = (x, z, r) => {
    const o = [x, z, r];
    occupied.push(o);
    cellsOf(x - r - 1, x + r + 1, z - r - 1, z + r + 1, (k) => { let l = occGrid.get(k); if (!l) occGrid.set(k, (l = [])); l.push(o); });
  };
  // the walking lines: furniture stays this far off them
  const lines = C.walkLines || [];
  const lineGrid = new Map(), LG = 8;
  lines.forEach((l) => {
    for (let i = Math.floor((Math.min(l[0], l[2]) - 2) / LG); i <= Math.floor((Math.max(l[0], l[2]) + 2) / LG); i++) {
      for (let j = Math.floor((Math.min(l[1], l[3]) - 2) / LG); j <= Math.floor((Math.max(l[1], l[3]) + 2) / LG); j++) {
        const k = i * 100000 + j; let c = lineGrid.get(k); if (!c) lineGrid.set(k, (c = [])); c.push(l);
      }
    }
  });
  C.offPath = (x, z, r) => {
    for (const l of lineGrid.get(Math.floor(x / LG) * 100000 + Math.floor(z / LG)) || []) {
      const dx = l[2] - l[0], dz = l[3] - l[1], L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - l[0]) * dx + (z - l[1]) * dz) / L2));
      if (Math.hypot(l[0] + dx * t - x, l[1] + dz * t - z) < r + 0.55) return false;
    }
    return true;
  };
  C.ok = (x, z, r) => free(x, z, r) && C.offPath(x, z, r);

  // ---------- the props kit (streetprops.js), on the old town's batches ----------
  const manualSeats = C.manualSeats = [];
  const props = C.props = [];
  // collision helpers in the argument order streetprops.js uses (y before z for the physics ones)
  const kitWalkBox = (x0, x1, z0, z1, top, flags = {}) => addWalkBox(colliders, x0, x1, z0, z1, top, flags);
  const kitPhysBox = (x0, x1, y0, y1, z0, z1, flags = {}) => addPhysBox(colliders, x0, x1, z0, z1, y0, y1, flags);
  const kitWalkCyl = (x, z, r, top) => addWalkCyl(colliders, x, z, r, top);
  const kitPhysCyl = (x, z, r, y0, y1) => physCylAt(colliders, x, (y0 + y1) / 2, z, r, y1 - y0);
  // a seat a person could use: where, which way it faces, how high
  const kitSeat = (x, y, z, yaw, h) => {
    const seat = { o: new THREE.Vector3(x, y, z), yaw, h, by: null };
    manualSeats.push(seat);
    return seat;
  };
  // a movable prop (cafe chair, table, bin): recorded in C.props with the collision shapes it made
  const kitMovable = (kind, x, z, y, yaw, makeCollision, extra = {}) => {
    const fromBox = colliders.boxes.length, fromCircle = colliders.circles.length;
    if (makeCollision) makeCollision();
    const shapes = colliders.boxes.slice(fromBox).concat(colliders.circles.slice(fromCircle));
    const entry = { kind, x, z, y, yaw, walk: shapes, ...extra };
    props.push(entry);
    return entry;
  };
  C.kit = {
    R: C.R, claim,
    b: {
      paint: B.paintD, glass: C.batch('fGlass', BOX, M.glass, { cast: false }), frame: B.ironD, metal: B.ironB, plain: B.stone, wood: batch('fWood', BOX, M.timber),
      lamp: B.glow, metalC: B.ironC, plainC: B.stoneC, plainS: batch('fStoneS', SPHERE, M.stone),
    },
    walkBox: kitWalkBox, physBox: kitPhysBox, walkCyl: kitWalkCyl, physCyl: kitPhysCyl, seat: kitSeat, breakable: kitMovable,
  };

  /**
   * A lamp at (x, z) standing on y. kind: 'post' (a cast-iron lantern post), 'candelabra' (a
   * short post with two lanterns, on a pedestal), 'bracket' (a lantern on a short iron stem),
   * 'wall' (a lantern on an arm out of a wall: toward = the way out of the wall).
   */
  C.lampAt = (x, z, y, kind = 'post', toward = null) => {
    const lantern = (lx, ly, lz, s = 1) => {
      B.ironB.add(lx, ly - 0.32 * s, lz, 0.26 * s, 0.05, 0.26 * s, IRON);                // bottom plate
      B.glow.add(lx, ly, lz, 0.22 * s, 0.5 * s, 0.22 * s);                               // glass, lit
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.ironD.add(lx + dx * 0.12 * s, ly, lz + dz * 0.12 * s, 0.03, 0.56 * s, 0.03, IRON);
      B.ironCone.add(lx, ly + 0.38 * s, lz, 0.42 * s, 0.22 * s, 0.42 * s, IRON);           // cap
      B.ironCD.add(lx, ly + 0.55 * s, lz, 0.05, 0.14 * s, 0.05, IRON);                    // finial
    };
    if (kind === 'post') {
      B.ironC.add(x, y + 0.3, z, 0.34, 0.6, 0.34, GREEN_IRON);
      B.ironC.add(x, y + 2.1, z, 0.13, 3.2, 0.13, GREEN_IRON);
      B.ironCD.add(x, y + 0.75, z, 0.22, 0.3, 0.22, GREEN_IRON);
      B.ironCD.add(x, y + 3.75, z, 0.2, 0.14, 0.2, GREEN_IRON);
      lantern(x, y + 4.15, z, 1.15);
      C.pools.push([x, z, y + 4.15, 4.4]);
      C.solidCyl(x, z, 0.17, y + 3.8);
      claim(x, z, 0.6);
    } else if (kind === 'candelabra') {
      B.ironC.add(x, y + 1.1, z, 0.12, 2.2, 0.12, GREEN_IRON);
      B.ironD.add(x, y + 2.15, z, 1.1, 0.06, 0.06, GREEN_IRON);
      lantern(x - 0.55, y + 2.45, z, 0.85); lantern(x + 0.55, y + 2.45, z, 0.85);
      lantern(x, y + 2.75, z, 0.95);
      C.pools.push([x, z, y + 2.75, 3.6]);
      C.solidCyl(x, z, 0.1, y + 2.2);
    } else if (kind === 'bracket') {
      B.ironC.add(x, y + 0.7, z, 0.08, 1.4, 0.08, IRON);
      lantern(x, y + 1.7, z, 0.9);
      C.pools.push([x, z, y + 1.7, 2.8]);
    } else {
      const [tx, tz] = toward;
      B.ironD.add(x + tx * 0.35, y + 0.05, z + tz * 0.35, tz ? 0.05 : 0.7, 0.05, tx ? 0.05 : 0.7, IRON);
      B.ironD.add(x + tx * 0.2, y - 0.2, z + tz * 0.2, tz ? 0.04 : 0.4, 0.04, tx ? 0.04 : 0.4, IRON, 0, tz ? 0.6 * tz : 0, tx ? -0.6 * tx : 0);
      lantern(x + tx * 0.7, y - 0.25, z + tz * 0.7, 0.9);
      C.pools.push([x + tx * 1.2, z + tz * 1.2, y - 0.25, 3.6]);
    }
  };
  C.bench = (x, z, yaw, y) => Pr.bench(C.kit, x, z, yaw, y);
}

/** Everything placed: run after the ground, river and bridges (it keeps out of their way). */
export function furnish(C, P) {
  const { R, B, kit } = C;
  const ok = C.ok, claim = C.claim;
  const ST = T + CH; // on a pavement

  // ---------- trees ----------
  const tree = C.tree = (x, z, y = T, big = 1) => {
    const th = 2.6 * big;
    B.bark.add(x, y + th / 2, z, 0.3 * big, th, 0.3 * big, 0x6a5a48);
    const greens = [0x587a3a, 0x648a44, 0x4e7034, 0x6f9448, 0x46682f];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    C.site.anchored(x, z, () => {
      for (let k = 0; k < 5; k++) {
        const r = R.range(1.2, 1.8) * big;
        const px = x + R.range(-1, 1) * big, py = y + th + R.range(0.6, 1.9) * big, pz = z + R.range(-1, 1) * big;
        B.leafNear.add(px, py, pz, r * 2, r * 1.7, r * 2, R.pick(greens), R() * 6);
        x0 = Math.min(x0, px - r); x1 = Math.max(x1, px + r); y0 = Math.min(y0, py - r * 0.85); y1 = Math.max(y1, py + r * 0.85); z0 = Math.min(z0, pz - r); z1 = Math.max(z1, pz + r);
      }
      B.leafFar.add((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) * 0.85, (y1 - y0) * 0.9, (z1 - z0) * 0.85, greens[0]);
    });
    C.solidCyl(x, z, 0.17 * big, y + th);
    claim(x, z, 0.9);
    P.treeSpots.push({ x, z, y, big });
  };
  // the avenue: a row down each pavement, a metre in from the kerb
  for (const s of P.xstreets.filter((q) => q.kind === 'avenue')) for (const sd of [-1, 1]) {
    const u = s.c + sd * (s.carr + 1.0);
    for (let a = -END + 24; a < END - 24; a += 9.5) {
      if (P.zstreets.some((q) => a > q.lo - 3 && a < q.hi + 3) || (a > RIVER.z0 - 2 && a < RIVER.z1 + 2) || (a > PROM.z0 - 1 && a < PROM.z1 + 1)) continue;
      if (ok(u, a, 0.7)) tree(u, a, ST, 1.05);
    }
  }
  // the promenade: lindens down the gravel strip (clear of the cross paths)
  for (const q of P.squares.filter((q) => q.kind === 'promenade')) for (let x = q.x0 + 4; x < q.x1 - 3; x += 8) if (ok(x, 62, 0.6)) tree(x, 62, T, 1.15);
  // the squares
  const dom = P.squares.find((q) => q.kind === 'cathedral');
  if (dom) for (const x of [dom.x0 + 6, dom.x1 - 6]) for (let z = dom.z0 + 8; z < dom.z1 - 4; z += 10) if (ok(x, z, 0.8)) tree(x, z, T, 1.2);
  tree(P.cafeTree.x, P.cafeTree.z, T, 1.6);
  for (const [x, z] of [[-70.5, -46.5], [-59.5, -57.5]]) if (ok(x, z, 0.8)) tree(x, z, T, 1.1);

  // ---------- lamps ----------
  // pavements: lantern posts at the kerb every ~20 m, alternating sides
  for (const s of P.streets) {
    for (const sd of [-1, 1]) {
      const S = sd < 0 ? s.n : s.p;
      const u = s.c + sd * (s.carr + S.park + 0.55);
      const off = sd < 0 ? 0 : 10;
      for (let a = -END + 22 + off; a < END - 22; a += 20) {
        if (s.axis === 'z' && a > RIVER.z0 - 1 && a < RIVER.z1 + 1) continue;
        const [x, z] = s.axis === 'z' ? [u, a] : [a, u];
        if (P.streets.some((q) => q.axis !== s.axis && a > q.lo - 1 && a < q.hi + 1)) continue;
        if (ok(x, z, 0.4)) C.lampAt(x, z, ST, 'post');
      }
    }
  }
  // lanes: lanterns on arms out of the walls, every ~13 m, alternating sides
  for (const l of P.lanes) {
    if (l.square) continue;
    const alongX = l.axis === 'x', a0 = alongX ? l.x0 : l.z0, a1 = alongX ? l.x1 : l.z1;
    let k = 0;
    for (let a = a0 + 6; a < a1 - 4; a += 13, k++) {
      const sd = k % 2 ? 1 : -1, u = alongX ? (sd < 0 ? l.z0 : l.z1) : (sd < 0 ? l.x0 : l.x1);
      const [x, z] = alongX ? [a, u] : [u, a];
      const r = P.region(alongX ? x : x - sd * 0.6, alongX ? z - sd * 0.6 : z);
      if (r.kind !== 'block' && r.kind !== 'site') continue; // only on a wall
      C.lampAt(x, z, T + 4.6, 'wall', alongX ? [0, -sd] : [-sd, 0]);
    }
  }
  // squares: posts round the edge, a little in
  for (const q of P.squares) {
    if (q.kind === 'gate' || q.kind === 'promenade') continue;
    const per = 2 * (q.x1 - q.x0 + q.z1 - q.z0), n = Math.max(4, Math.round(per / 18));
    for (let i = 0; i < n; i++) {
      const [x, z] = perimeter(q, (i + 0.5) / n, 4.2);
      if (ok(x, z, 0.4)) C.lampAt(x, z, T, 'post');
    }
  }
  // the promenade: posts along the parapet
  for (const q of P.squares.filter((q) => q.kind === 'promenade')) for (let x = q.x0 + 8; x < q.x1 - 4; x += 16) if (ok(x, 57.3, 0.4)) C.lampAt(x, 57.3, T, 'post');
  // the embankment's river side
  // (none at the street's ends: the traffic turns round there, its noses over the pavement)
  for (let x = -B0() + 8; x < B0() - 8; x += 16) if (Math.abs(x) < END - 16 && ok(x, RIVER.z0 - 0.9, 0.4)) C.lampAt(x, RIVER.z0 - 0.9, ST, 'post');

  // ---------- the market: fountain, stalls ----------
  fountain(C, P.fountain.x, P.fountain.z);
  well(C, P.well.x, P.well.z);
  const mk = P.squares.find((q) => q.kind === 'market');
  if (mk) {
    for (let z = mk.z0 + 5; z < mk.z1 - 4; z += 5.5) for (let x = mk.x0 + 5; x < 43; x += 4.4) if (ok(x, z, 1.9)) stall(C, x, z, R.pick([0, Math.PI]));
  }
  // ---------- café terraces: in front of every café / restaurant on a square or the promenade ----------
  for (const l of P.lots) {
    if (l.groundUse !== 'cafe' && l.groundUse !== 'restaurant' && l.groundUse !== 'bakery') continue;
    const f = l.fronts[0], g = frontRegion(P, l, f);
    if (!g) continue;
    const sq = g.kind === 'square' && g.sq && g.sq.kind !== 'gate';
    const avenue = g.kind === 'street' && g.street.kind === 'avenue';
    if (!sq && !avenue && g.kind !== 'lane') continue;
    terrace(C, P, l, f, sq ? (g.sq.kind === 'promenade' ? [0.9, 3.2] : [3.4, 8]) : g.kind === 'lane' && g.lane.w > 5 ? [0.7, 1.4] : [0.7, 1.4], l.groundUse);
  }
  // ---------- benches: the promenade facing the river; squares facing in ----------
  for (const q of P.squares.filter((q) => q.kind === 'promenade')) for (let x = q.x0 + 4; x < q.x1 - 4; x += 12) if (ok(x, 57.15, 1.1)) { C.bench(x, 57.15, Math.PI, T); trashNear(x + 1.6, 57.2); }
  for (const q of P.squares) {
    if (q.kind === 'gate' || q.kind === 'promenade' || q.kind === 'market') continue;
    const n = Math.round((q.x1 - q.x0 + q.z1 - q.z0) / 8);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.25) / n, [x, z, yaw] = perimeter(q, t, 5.2, true);
      if (ok(x, z, 1.1)) C.bench(x, z, yaw, T);
    }
  }
  if (mk) for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2 + 0.4, x = P.fountain.x + Math.sin(a) * 7.5, z = P.fountain.z + Math.cos(a) * 7.5;
    if (ok(x, z, 1.1)) C.bench(x, z, a + Math.PI, T);
  }
  function trashNear(x, z, y = T) { if (ok(x, z, 0.4)) Pr.trashCan(kit, x, z, y); }

  // ---------- along the pavements: bins, bike racks, scooters, bollards at the lane mouths ----------
  for (const s of P.streets) for (const sd of [-1, 1]) {
    const S = sd < 0 ? s.n : s.p;
    const u = s.c + sd * (s.carr + S.park + 0.6);
    for (let a = -END + 26; a < END - 26; a += R.range(14, 30)) {
      if (s.axis === 'z' && a > RIVER.z0 - 2 && a < RIVER.z1 + 2) continue;
      if (P.streets.some((q) => q.axis !== s.axis && a > q.lo - 2 && a < q.hi + 2)) continue;
      const [x, z] = s.axis === 'z' ? [u, a] : [a, u];
      const t = R();
      const yaw = s.axis === 'z' ? (sd < 0 ? Math.PI / 2 : -Math.PI / 2) : (sd < 0 ? 0 : Math.PI);
      if (t < 0.35) { if (ok(x, z, 0.4)) Pr.trashCan(kit, x, z, ST); }
      else if (t < 0.55) { if (ok(x, z, 1)) Pr.bikeRack(kit, x, z, yaw + Math.PI / 2, ST); }
      else scooters(C, s, sd, a, u, ST);
    }
  }
  for (const l of P.lanes) {
    // bollards across a lane's mouth where it meets a traffic street (cars stay out)
    for (const end of [0, 1]) {
      const alongX = l.axis === 'x';
      const a = alongX ? (end ? l.x1 : l.x0) : (end ? l.z1 : l.z0);
      const c = alongX ? (l.z0 + l.z1) / 2 : (l.x0 + l.x1) / 2;
      const out = end ? 1 : -1;
      const [px, pz] = alongX ? [a + out * 1.2, c] : [c, a + out * 1.2];
      if (P.region(px, pz).kind !== 'street') continue;
      for (let o = -l.w / 2 + 0.5; o <= l.w / 2 - 0.4; o += 1.3) {
        if (Math.abs(o) < 0.6) continue;
        const [x, z] = alongX ? [a + out * 0.3, c + o] : [c + o, a + out * 0.3];
        bollard(C, x, z, ST);
      }
    }
  }
  // ---------- the tram: stops on the avenue, its overhead wires ----------
  for (const s of P.xstreets.filter((q) => q.tram)) {
    for (const [a, sd] of [[-60, -1], [-45, 1], [100, -1], [115, 1], [-150, 1], [170, -1]]) {
      const u = s.c + sd * (s.carr + 1.6);
      if (!C.free(u, a, 2.4)) continue;
      Pr.busShelter(kit, u, a, sd < 0 ? Math.PI / 2 : -Math.PI / 2, ST);
      // the stop's sign: a post and a green disc with its H
      const px = s.c + sd * (s.carr + 0.5), pz = a + 3;
      B.ironC.add(px, ST + 1.4, pz, 0.08, 2.8, 0.08, IRON);
      B.paintD.add(px, ST + 2.8, pz, 0.04, 0.5, 0.5, 0x2e6b4a);
      B.paintD.add(px, ST + 2.8, pz, 0.05, 0.3, 0.06, 0xf2c94a);
      C.solidCyl(px, pz, 0.06, ST + 2.9);
    }
    // catenary: poles at both kerbs every 30 m, a span wire across, the contact wire over each track
    let prev = null;
    for (let a = -END + 14; a <= END - 14; a += 30) {
      if (P.zstreets.some((q) => a > q.lo - 2 && a < q.hi + 2)) { prev = null; continue; }
      const onBridge = a > RIVER.z0 && a < RIVER.z1;
      const ux = s.carr + (onBridge ? 2.55 : 0.45);
      for (const sd of [-1, 1]) {
        const x = s.c + sd * ux;
        if (!onBridge || true) { B.ironC.add(x, ST + 3.4, a, 0.18, 6.8, 0.18, GREEN_IRON); C.solidCyl(x, a, 0.1, ST + 6.8); claim(x, a, 0.4); }
      }
      B.ironD.add(s.c, ST + 6.3, a, 2 * ux, 0.02, 0.02, IRON);
      if (prev !== null) for (const tr of [-1, 1]) for (let k = 0; k < 3; k++) B.ironD.add(s.c + tr * s.carr * 0.5, ST + 5.9, prev + (a - prev) * (k + 0.5) / 3, 0.015, 0.015, (a - prev) / 3 + 0.01, IRON);
      prev = a;
    }
  }
  // ---------- finger posts on the squares ----------
  for (const q of P.squares) {
    if (q.kind === 'gate' || q.kind === 'promenade') continue;
    const [x, z] = perimeter(q, 0.07, 3.6);
    if (!ok(x, z, 0.5)) continue;
    B.ironC.add(x, T + 1.5, z, 0.1, 3, 0.1, GREEN_IRON);
    for (let k = 0; k < 3; k++) B.paintD.add(x + 0.35 * (k % 2 ? 1 : -1), T + 2.6 - k * 0.32, z, 0.8, 0.2, 0.04, 0x2a4a3a, k * 1.1);
    C.solidCyl(x, z, 0.06, T + 3);
    claim(x, z, 0.5);
  }
  // ---------- parked cars in the bays ----------
  C.parking ||= [];  // (the scooters along the pavements are already in it)
  for (const s of P.streets) {
    const cross = s.axis === 'z' ? P.zstreets : P.xstreets;
    const stops = cross.map((q) => [q.lo, q.hi]);
    if (s.axis === 'z') stops.push([RIVER.z0, RIVER.z1]);
    stops.sort((a, b) => a[0] - b[0]);
    const runs = [];
    let a = -END + 20;
    for (const [lo, hi] of stops) { if (lo > a) runs.push([a, lo]); a = Math.max(a, hi); }
    runs.push([a, END - 20]);
    for (const sd of [-1, 1]) {
      const S = sd < 0 ? s.n : s.p;
      if (!S.park) continue;
      const u = s.c + sd * (s.carr + S.park / 2);
      const yaw = s.axis === 'z' ? (sd < 0 ? 0 : Math.PI) : (sd < 0 ? -Math.PI / 2 : Math.PI / 2);
      for (const [a0, a1] of runs) {
        const L = a1 - a0, b0 = a0 + Math.min(BO, L / 2) + 0.6, b1 = a1 - Math.min(BO, L / 2) - 0.6;
        for (let a = b0 + R.range(0, 3); a < b1;) {
          const t = R(), kind = parkedKind(t), Lc = SPECS[kind].L;
          if (a + Lc > b1) break;
          const [x, z] = s.axis === 'z' ? [u, a + Lc / 2] : [a + Lc / 2, u];
          if (R() < 0.7) { const c0 = R.pick(CAR_COLS); C.parking.push({ x, z, y: T, yaw, kind, color: paintFor(kind, () => (CAR_COLS.indexOf(c0) + 0.5) / CAR_COLS.length), interior: Math.floor(R() * 3) }); }
          a += Lc + R.range(0.9, 2.4);
        }
      }
    }
  }
  void SPHERE; void CYL;
}
function B0() { return 197; }

/** A point on the inside of a square's edge, t = 0..1 round it, inset in from the edge (with the yaw facing in, for benches). */
function perimeter(q, t, inset, withYaw = false) {
  const W = q.x1 - q.x0 - 2 * inset, D = q.z1 - q.z0 - 2 * inset, per = 2 * (W + D);
  let d = (t % 1) * per;
  let x, z, yaw;
  if (d < W) { x = q.x0 + inset + d; z = q.z0 + inset; yaw = 0; }
  else if ((d -= W) < D) { x = q.x1 - inset; z = q.z0 + inset + d; yaw = -Math.PI / 2; }
  else if ((d -= D) < W) { x = q.x1 - inset - d; z = q.z1 - inset; yaw = Math.PI; }
  else { d -= W; x = q.x0 + inset; z = q.z1 - inset - d; yaw = Math.PI / 2; }
  return withYaw ? [x, z, yaw] : [x, z];
}

/** What a lot's front faces (plan.region just outside it). */
function frontRegion(P, l, f) {
  const cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
  const [x, z] = f === 'zn' ? [cx, l.z0 - 1] : f === 'zp' ? [cx, l.z1 + 1] : f === 'xn' ? [l.x0 - 1, cz] : [l.x1 + 1, cz];
  return P.region(x, z);
}

/** Tables, chairs and parasols in front of a café: depth range [d0, d1] out from its front. */
function terrace(C, P, l, f, [d0, d1], use) {
  const { kit, B, R } = C;
  const nx = f === 'xn' ? -1 : f === 'xp' ? 1 : 0, nz = f === 'zn' ? -1 : f === 'zp' ? 1 : 0;
  const len = nx ? l.z1 - l.z0 : l.x1 - l.x0;
  const fx = f === 'xn' ? l.x0 : f === 'xp' ? l.x1 : (l.x0 + l.x1) / 2, fz = f === 'zn' ? l.z0 : f === 'zp' ? l.z1 : (l.z0 + l.z1) / 2;
  const y = P.region(fx + nx * 1, fz + nz * 1).kind === 'street' ? T + CH : T;
  const yawAlong = nx ? 0 : Math.PI / 2; // chairs either side along the facade
  const cols = [0x7a1f1f, 0x2e5a3f, 0xf2ece0, 0x1f3a5e, 0xc9a13a];
  const col = cols[l.seed % cols.length];
  let placed = 0;
  for (let d = d0 + 0.6; d <= d1 - 0.4; d += 2.2) {
    for (let u = -len / 2 + 1.4; u <= len / 2 - 1.2; u += 2.6) {
      const x = fx + nx * d + (nx ? 0 : u), z = fz + nz * d + (nz ? 0 : u);
      if (!C.ok(x, z, 1.15)) continue;
      Pr.cafeTable(kit, x, z, y, yawAlong);
      placed++;
      // a parasol over every other table (not on the narrow ones)
      if (d1 - d0 > 2 && (placed % 2 === 1)) {
        B.ironC.add(x, y + 1.25, z, 0.05, 2.5, 0.05, 0xe8e2d6);
        B.fabricCone.add(x, y + 2.45, z, 2.8, 0.55, 2.8, col);
        C.solidCyl(x, z, 0.04, y + 2.2);
      }
    }
  }
  // a couple of planters marking the terrace off
  if (placed && d1 - d0 > 2) for (const s of [-1, 1]) {
    const x = fx + nx * (d1 - 0.4) + (nx ? 0 : s * (len / 2 - 0.5)), z = fz + nz * (d1 - 0.4) + (nz ? 0 : s * (len / 2 - 0.5));
    if (!C.ok(x, z, 0.5)) continue;
    B.timber.add(x, y + 0.3, z, 0.9, 0.6, 0.5, 0x6a4a30, nx ? Math.PI / 2 : 0);
    B.crate.add(x, y + 0.66, z, 0.8, 0.14, 0.4, 0x5a8a3a, nx ? Math.PI / 2 : 0);
    C.solidBox(x - 0.45, x + 0.45, z - 0.45, z + 0.45, y, y + 0.6, { noSeat: true });
    C.claim(x, z, 0.6);
    P.planterSpots.push({ x, z, y });
  }
  void use; void R;
}

/** A market stall: posts, a counter with produce, a striped awning roof. */
function stall(C, x, z, yaw) {
  const { B, R } = C;
  const W = 3, D = 1.8, f = Math.cos(yaw) >= 0 ? 1 : -1;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.timber.add(x + sx * (W / 2 - 0.05), T + 1.2, z + sz * (D / 2 - 0.05), 0.08, 2.4, 0.08, 0x8a6a48);
  B.timber.add(x, T + 0.45, z + f * 0.3, W, 0.9, 0.9, 0x9a7a54);
  // produce: crates of colour on the counter
  const goods = [0xc8321e, 0xe8a020, 0x5a9a2a, 0xd8c04a, 0x8a2a5a, 0xe86a2a, 0x3a6a2a, 0xf2e6c0];
  for (let i = 0; i < 5; i++) B.crate.add(x - W / 2 + 0.35 + i * 0.58, T + 0.97, z + f * 0.3, 0.5, 0.14, 0.7, R.pick(goods));
  // awning: stripes running front to back, pitched toward the customers
  const [c1, c2] = R.pick(STRIPES);
  const n = 8;
  for (let i = 0; i < n; i++) B.fabric.add(x - W / 2 + (i + 0.5) * W / n, T + 2.45, z, W / n + 0.005, 0.03, D + 0.5, i % 2 ? c1 : c2, 0, f * 0.18);
  C.solidBox(x - W / 2, x + W / 2, z + f * 0.3 - 0.45, z + f * 0.3 + 0.45, T, T + 0.95, { noSeat: true });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) C.solidCyl(x + sx * (W / 2 - 0.05), z + sz * (D / 2 - 0.05), 0.05, T + 2.4);
  C.claim(x, z, 1.9);
}

/** The market fountain: an octagonal basin, a column, a bowl, a gilded figure. */
function fountain(C, x, z) {
  const { B } = C;
  const r = 3.4;
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2;
    const len = 2 * r * Math.tan(Math.PI / 8) + 0.05;
    B.stone.add(x + Math.sin(a) * r, T + 0.35, z + Math.cos(a) * r, len, 0.7, 0.45, 0xe6dccb, a);
    B.stone.add(x + Math.sin(a) * r, T + 0.74, z + Math.cos(a) * r, len + 0.1, 0.1, 0.6, 0xf0e8da, a);
  }
  B.waterC.add(x, T + 0.55, z, 2 * r - 0.3, 0.02, 2 * r - 0.3);
  B.stoneC.add(x, T + 0.3, z, 2 * r - 0.3, 0.5, 2 * r - 0.3, 0x8a8478); // the basin's floor (under the water)
  B.stoneC.add(x, T + 1.5, z, 0.7, 2.4, 0.7, 0xe6dccb);
  B.stoneC.add(x, T + 2.75, z, 2.4, 0.25, 2.4, 0xece4d6);
  B.waterC.add(x, T + 2.9, z, 2.1, 0.02, 2.1);
  B.stoneC.add(x, T + 3.4, z, 0.4, 1.2, 0.4, 0xe6dccb);
  B.gold.add(x, T + 4.4, z, 0.5, 0.9, 0.5);
  C.solidCyl(x, z, r + 0.22, T + 0.79);
  C.solidCyl(x, z, 0.4, T + 4.8);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.3;
    C.manualSeats.push({ o: new THREE.Vector3(x + Math.sin(a) * (r + 0.55), T, z + Math.cos(a) * (r + 0.55)), yaw: a, h: 0.79, by: null });
  }
  C.claim(x, z, r + 0.6);
}

/** The well: a round stone curb, two posts and a little roof, a winch. */
function well(C, x, z) {
  const { B } = C;
  B.stoneC.add(x, T + 0.4, z, 2, 0.8, 2, 0xd8d0c0);
  B.waterC.add(x, T + 0.7, z, 1.6, 0.02, 1.6);
  for (const s of [-1, 1]) B.timber.add(x + s * 0.9, T + 1.6, z, 0.14, 2.4, 0.14, 0x5a4030);
  B.timber.add(x, T + 1.9, z, 1.9, 0.12, 0.12, 0x5a4030);
  C.roofPrism.add(x, T + 2.7, z, 1.4, 0.8, 2.3, 0xffffff, Math.PI / 2);
  C.solidCyl(x, z, 1.0, T + 0.8);
  C.claim(x, z, 1.6);
}

/** A cast-iron bollard. */
function bollard(C, x, z, y) {
  const { B } = C;
  B.ironC.add(x, y + 0.45, z, 0.2, 0.9, 0.2, IRON);
  B.ironCD.add(x, y + 0.93, z, 0.24, 0.08, 0.24, IRON);
  C.solidCyl(x, z, 0.11, y + 0.95);
  C.claim(x, z, 0.3);
}

/**
 * A few scooters parked at the kerb, side by side, front wheels to the road. The first two of
 * each group are real, rideable scooters (entries in C.parking: a game can put real vehicles there); the
 * rng is drawn exactly as it always was, so nothing after this moves.
 */
function scooters(C, s, sd, a, u, y) {
  const { R } = C;
  const n = R.int(2, 4);
  for (let i = 0; i < n; i++) {
    const aa = a + i * 0.85;
    // (back from the kerb: u is 0.6 in, the scooter's 1.5 m long; it used to poke half a metre into the road)
    const [x, z] = s.axis === 'z' ? [u + sd * 0.35, aa] : [aa, u + sd * 0.35];
    if (!C.ok(x, z, 0.45)) continue;
    // facing the road: along the across axis
    const yaw = s.axis === 'z' ? (sd < 0 ? -Math.PI / 2 : Math.PI / 2) : (sd < 0 ? Math.PI : 0);
    const col = R.pick(SCOOTER);
    if (i >= 2) continue;
    (C.parking ||= []).push({ x, z, y, yaw, kind: 'scooter', color: col, interior: 0 });
    C.claim(x, z, 0.45);
  }
}

export { perimeter, inside };

/*
  Light pools: a soft warm disc on whatever is walked on under each lantern (the street, the
  pavement, a bridge deck, a stair landing), added onto the picture, so it shows in the shade and
  as dusk falls and barely in full sun. One instanced batch, no shadows; the level dims it with
  the time of day (poolLevel).
*/
let poolTex = null;
function poolTexture() {
  if (poolTex) return poolTex;
  // a 64 px white disc whose alpha falls off like a lamp's light on the ground: bright core, long soft edge
  const canvas = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
  const ctx = canvas.getContext('2d');
  const fall = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  [[0, 1], [0.18, 0.78], [0.42, 0.36], [0.7, 0.1], [1, 0]].forEach(([t, a]) => fall.addColorStop(t, `rgba(255,255,255,${a})`));
  ctx.fillStyle = fall;
  ctx.fillRect(0, 0, 64, 64);
  poolTex = new THREE.CanvasTexture(canvas);
  poolTex.colorSpace = THREE.SRGBColorSpace;
  return poolTex;
}
export const POOL_MAT = new THREE.MeshBasicMaterial({ color: 0xffb468, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
const POOL_GEO = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
export function lightPools(C) {
  POOL_MAT.map = poolTexture();
  const b = C.batch('lampPool', POOL_GEO, POOL_MAT, { cast: false });
  let n = 0;
  for (const [x, z, ly, r] of C.pools) {
    const gy = C.colliders.groundAt(x, z, ly - 0.4);
    if (gy <= 0.5 || ly - gy > 7) continue; // (nothing to land on: over the river)
    b.add(x, gy + 0.02, z, r * 2, 1, r * 2);
    n++;
  }
  return n;
}
/** How strongly the pools show for the sky's time of day (scene.userData.sky.time). */
export function poolLevel(time) {
  return { day: 0, afternoon: 0.08, evening: 0.32, golden: 0.55 }[time] ?? 0.32;
}

