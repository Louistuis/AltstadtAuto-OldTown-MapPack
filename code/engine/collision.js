/*
  Collision output of the Old Town generator, engine-agnostic.

  The generator does not simulate anything. It only records shapes, in world space (metres,
  y up), into three plain lists you can feed to any physics engine or character controller:

    colliders.boxes    walkable tops      { minX, maxX, minZ, maxZ, top, ...flags }
                       (an axis-aligned footprint whose surface is at height `top`: ground tiles,
                       pavements, steps, stairs, building footprints, benches...)
    colliders.circles  walkable discs     { x, z, r, top }   (posts, bollards, trunks, fountains)
    colliders.solids   physics solids     { type: 'box', x, y, z, w, h, d, ...flags }  (centre + size)
                                          { type: 'cyl', x, y, z, r, h }               (upright cylinder)

  Flags you may see: topOnly (only the top is a surface, e.g. the ground plateau), cam (the camera
  should stay out of it), noSeat, seatYaw (a seat facing that way).

  Everything is axis-aligned boxes and upright cylinders: the Old Town is laid out on a grid, so a
  static-body list of boxes and cylinders is the whole physics world. See README.md for how to load
  them into Rapier, Ammo, cannon-es, PhysX, Unity or Godot.

  groundAt(x, z) and blocked(x, z, y, r) are small helpers the generator itself uses while placing
  things (simple linear scans over a coarse grid; fast enough for a one-off build).
*/

const CELL = 8; // metres per lookup cell

export class Colliders {
  constructor() {
    this.boxes = [];
    this.circles = [];
    this.solids = [];
    this._grid = null;
    this._gridCount = -1;
  }

  /** Lazily (re)index boxes and circles into a coarse xz grid. */
  _index() {
    const count = this.boxes.length + this.circles.length;
    if (this._grid && this._gridCount === count) return this._grid;
    const grid = new Map();
    const put = (shape, x0, x1, z0, z1) => {
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
        for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
          const key = i + ':' + j;
          let list = grid.get(key);
          if (!list) grid.set(key, (list = []));
          list.push(shape);
        }
      }
    };
    for (const b of this.boxes) put(b, b.minX, b.maxX, b.minZ, b.maxZ);
    for (const c of this.circles) put(c, c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r);
    this._grid = grid;
    this._gridCount = count;
    return grid;
  }

  _near(x, z) {
    return this._index().get(Math.floor(x / CELL) + ':' + Math.floor(z / CELL)) || [];
  }

  /** Height of the highest walkable surface under (x, z) that is not above fromY (0 if none). */
  groundAt(x, z, fromY = Infinity) {
    let best = 0;
    for (const s of this._near(x, z)) {
      const under = s.r !== undefined
        ? (x - s.x) ** 2 + (z - s.z) ** 2 <= s.r * s.r
        : x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ;
      if (under && s.top <= fromY && s.top > best) best = s.top;
    }
    return best;
  }

  /** True if a disc of radius r at (x, z), standing at height y, would overlap something taller than y. */
  blocked(x, z, y, r) {
    for (const s of this._near(x, z)) {
      if (s.top <= y) continue;
      if (s.r !== undefined) {
        if (Math.hypot(x - s.x, z - s.z) < s.r + r) return true;
      } else {
        const dx = Math.max(s.minX - x, 0, x - s.maxX), dz = Math.max(s.minZ - z, 0, z - s.maxZ);
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
    return false;
  }

  /** Plain-data copy (for JSON export or a worker). */
  toJSON() {
    return { boxes: this.boxes, circles: this.circles, solids: this.solids };
  }
}

/** A walkable box top. */
export function addWalkBox(col, x0, x1, z0, z1, top, flags) {
  col.boxes.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, top, ...flags });
}
/** A walkable disc top. */
export function addWalkCyl(col, x, z, r, top) {
  col.circles.push({ x, z, r, top });
}
/** A physics box from its centre and size. */
export function physBoxAt(col, x, y, z, w, h, d, flags) {
  col.solids.push({ type: 'box', x, y, z, w, h, d, ...flags });
}
/** A physics cylinder from its centre and height. */
export function physCylAt(col, x, y, z, r, h) {
  col.solids.push({ type: 'cyl', x, y, z, r, h });
}
/** A physics box from its extents. */
export function addPhysBox(col, x0, x1, z0, z1, y0, y1, flags) {
  physBoxAt(col, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, flags);
}
/** Walkable top plus physics box, x0..x1 by z0..z1, from y0 up to top. */
export function addSolid(col, x0, x1, z0, z1, y0, top, flags = {}) {
  addWalkBox(col, x0, x1, z0, z1, top, flags);
  addPhysBox(col, x0, x1, z0, z1, y0, top, { cam: !!flags.cam });
}
/** Walkable disc plus physics cylinder at (x, z), radius r, from y0 up h. */
export function addCyl(col, x, z, r, y0, h) {
  addWalkCyl(col, x, z, r, y0 + h);
  physCylAt(col, x, y0 + h / 2, z, r, h);
}

/**
 * Seats: the generator records benches and cafe chairs as it places them (map.seats). This
 * helper exists for API compatibility and finds nothing extra.
 */
export function findSeats() {
  return [];
}
