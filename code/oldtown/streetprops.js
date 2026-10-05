/*
  Small street props for the Old Town, drawn into the town's shared batches: park benches, cafe
  tables with two chairs, litter bins, bike racks and tram shelters. Each one registers its
  collision (walk tops + physics solids) and claims a keep-out circle so nothing else is placed
  on top of it. None of them draws from the town's random sequence, so they never shift the layout.

  kit = { b: batches, claim(x, z, r), walkBox, physBox, walkCyl, physCyl, seat, breakable }
  (made in furniture.js). y is the height the prop stands on; yaw turns it about the vertical.
*/

const IRON = 0x25292d, WOOD = 0xb07a4c, CHAIR = 0x2f4a3a, BIN = 0x2d3a33, STEEL = 0x5a6068, GLASS = 0xa8bcc8;

/** Local frame: `a` along the prop's facing direction, `s` to its side, heights from y. */
function frame(kit, x, z, yaw, y) {
  const fa = [Math.sin(yaw), Math.cos(yaw)], fs = [Math.cos(yaw), -Math.sin(yaw)];
  const at = (a, s) => [x + fa[0] * a + fs[0] * s, z + fa[1] * a + fs[1] * s];
  return {
    at,
    /** A box sized (along, up, side) centred at (a, h, s). */
    box(batch, a, h, s, la, lh, ls, col = 0xffffff, pitch = 0) {
      const [px, pz] = at(a, s);
      batch.add(px, y + h, pz, ls, lh, la, col, yaw, pitch);
    },
    /** World-aligned footprint of a local rectangle (yaws are multiples of 90 degrees here). */
    rect(a0, a1, s0, s1) {
      const p = at(a0, s0), q = at(a1, s1);
      return [Math.min(p[0], q[0]), Math.max(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[1], q[1])];
    },
    walk(a0, a1, s0, s1, top, flags) { const [x0, x1, z0, z1] = this.rect(a0, a1, s0, s1); kit.walkBox(x0, x1, z0, z1, y + top, flags); },
    solid(a0, a1, s0, s1, h0, h1, flags) {
      const [x0, x1, z0, z1] = this.rect(a0, a1, s0, s1);
      kit.walkBox(x0, x1, z0, z1, y + h1, flags);
      kit.physBox(x0, x1, y + h0, y + h1, z0, z1);
    },
  };
}

/** A park bench, the sitter facing yaw: oak slats on two cast-iron ends with armrests. */
export function bench(kit, x, z, yaw, y) {
  const F = frame(kit, x, z, yaw, y), b = kit.b, half = 0.9, seatH = 0.45;
  for (let i = 0; i < 4; i++) F.box(b.wood, 0.16 - i * 0.1, seatH - 0.02, 0, 0.085, 0.035, half * 2, WOOD);
  for (let i = 0; i < 3; i++) F.box(b.wood, -0.27 - i * 0.03, 0.58 + i * 0.13, 0, 0.03, 0.1, half * 2, WOOD, -0.2);
  for (const side of [-1, 1]) {
    const s = side * (half - 0.1);
    F.box(b.metal, 0.17, seatH / 2, s, 0.05, seatH, 0.05, IRON);       // front leg
    F.box(b.metal, -0.28, 0.47, s, 0.05, 0.94, 0.05, IRON, -0.12);    // back leg and back support
    F.box(b.metal, -0.04, seatH - 0.06, s, 0.48, 0.05, 0.05, IRON);    // seat rail
    F.box(b.metal, 0.02, 0.66, s, 0.44, 0.04, 0.07, IRON);             // armrest
  }
  F.walk(-0.21, 0.21, -half, half, seatH, { seatYaw: yaw });
  F.walk(-0.38, -0.21, -half, half, 0.95, { noSeat: true });
  const [x0, x1, z0, z1] = F.rect(-0.2, 0.21, -half, half);
  kit.physBox(x0, x1, y + seatH - 0.05, y + seatH, z0, z1);
  const [sx, sz] = F.at(0.2, 0);
  kit.seat(sx, y, sz, yaw, seatH);
  kit.claim(x, z, 1.1);
}

/** A cafe chair facing yaw. */
function chair(kit, x, z, yaw, y) {
  const F = frame(kit, x, z, yaw, y), b = kit.b, h = 0.46;
  F.box(b.paint, 0, h, 0, 0.42, 0.04, 0.42, CHAIR);
  F.box(b.paint, -0.2, h + 0.24, 0, 0.03, 0.44, 0.4, CHAIR);
  for (const a of [-0.18, 0.18]) for (const s of [-0.18, 0.18]) F.box(b.metal, a, h / 2, s, 0.025, h, 0.025, IRON);
  const [sx, sz] = F.at(0.21, 0);
  kit.seat(sx, y, sz, yaw, h);
  kit.breakable('chair', x, z, y, yaw, () => F.walk(-0.21, 0.21, -0.21, 0.21, h, { noSeat: true }));
}

/** A round cafe table on a cast-iron pedestal, a chair either side of it. */
export function cafeTable(kit, x, z, y, yaw = 0) {
  const b = kit.b;
  b.metalC.add(x, y + 0.02, z, 0.45, 0.04, 0.45, IRON);
  b.metalC.add(x, y + 0.38, z, 0.07, 0.72, 0.07, IRON);
  b.plainC.add(x, y + 0.75, z, 0.7, 0.03, 0.7, 0xece6da);
  kit.breakable('table', x, z, y, 0, () => kit.walkCyl(x, z, 0.1, y + 0.76));
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  chair(kit, x - fx * 0.62, z - fz * 0.62, yaw, y);
  chair(kit, x + fx * 0.62, z + fz * 0.62, yaw + Math.PI, y);
  kit.claim(x, z, 1.2);
}

/** A litter bin: a slatted green drum with a rim. */
export function trashCan(kit, x, z, y) {
  const b = kit.b;
  b.metalC.add(x, y + 0.46, z, 0.52, 0.86, 0.52, BIN);
  b.metalC.add(x, y + 0.9, z, 0.56, 0.05, 0.56, IRON);
  kit.breakable('trash', x, z, y, 0, () => kit.walkCyl(x, z, 0.3, y + 0.93));
  kit.claim(x, z, 0.5);
}

/** Three inverted-U bike hoops in a row (yaw = the way the row runs). */
export function bikeRack(kit, x, z, yaw, y) {
  const F = frame(kit, x, z, yaw, y), b = kit.b;
  for (const s of [-0.6, 0, 0.6]) {
    for (const a of [-0.32, 0.32]) F.box(b.metalC, a, 0.4, s, 0.05, 0.8, 0.05, STEEL);
    F.box(b.metal, 0, 0.8, s, 0.69, 0.05, 0.05, STEEL);
    F.walk(-0.34, 0.34, s - 0.03, s + 0.03, 0.82, { noSeat: true });
  }
  kit.claim(x, z, 1);
}

/** A tram / bus shelter: glass back and sides, a flat roof with a lit strip, a bench inside (yaw = facing the street). */
export function busShelter(kit, x, z, yaw, y) {
  const F = frame(kit, x, z, yaw, y), b = kit.b, W = 2, D = 0.75, H = 2.6, steel = 0x3a3f45;
  const glass = b.clear || b.glass;
  F.box(glass, -D, 1.3, 0, 0.03, 2.1, W * 2 - 0.1, GLASS);
  for (const s of [-1, 1]) {
    F.box(glass, 0, 1.3, s * W, D * 2 - 0.12, 2.1, 0.03, GLASS);
    for (const a of [-D, D]) F.box(b.metal, a, H / 2, s * W, 0.08, H, 0.08, steel);
  }
  F.box(b.metal, -D, 2.38, 0, 0.06, 0.08, W * 2, steel);
  F.box(b.metal, 0.05, H + 0.05, 0, D * 2 + 0.4, 0.1, W * 2 + 0.3, steel);
  F.box(b.lamp, 0.05, H - 0.005, 0, 0.3, 0.02, W * 2 - 0.4);
  F.solid(-D - 0.05, -D + 0.05, -W, W, 0, H, { noSeat: true });
  for (const s of [-1, 1]) F.solid(-D, D, s * W - 0.05, s * W + 0.05, 0, H, { noSeat: true });
  bench(kit, ...F.at(-D + 0.42, 0), yaw, y);
  kit.claim(x, z, 2.4);
}
