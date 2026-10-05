/*
  The Old Town as plain data: everything the generator decided, in world metres (y up), with
  no three.js objects in it. This is what data/oldtown-plan.json is made from, so an engine that
  is not three.js can rebuild the town (or just its layout) from it.

    import { planToJSON } from './code/index.js';
    const json = planToJSON(map);   // map = buildOldTown(...)
*/

const r3 = (v) => Math.round(v * 1000) / 1000;
const hex = (c) => (typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c);
const rect = (o) => ({ x0: r3(o.x0), x1: r3(o.x1), z0: r3(o.z0), z1: r3(o.z1) });
const v3 = (v) => v && [r3(v.x), r3(v.y), r3(v.z)];

export function planToJSON(map) {
  const P = map.plan;
  const street = (s) => ({
    id: s.id, name: s.name, kind: s.kind, runsAlong: s.axis, centre: s.c, tram: !!s.tram,
    carriagewayHalfWidth: s.carr,
    lowSide: { parking: s.n.park, pavement: s.n.pave }, highSide: { parking: s.p.park, pavement: s.p.pave },
    buildingLines: [r3(s.lo), r3(s.hi)], kerbLines: [r3(s.kerbLo), r3(s.kerbHi)],
  });
  const houseById = new Map((map.houses || []).map((h) => [h.lot.id, h]));
  return {
    meta: {
      name: 'AltstadtAuto Old Town',
      credit: 'Old Town map by Louis Nordbø, from AltstadtAuto (https://wta.lou15.com). MIT License.',
      units: 'metres', up: '+y', axes: 'three.js, right-handed, y up. The code calls +z north (the river runs along x; the promenade and the cathedral are on the +z bank). The evening sun stands toward -x, -z.',
      seed: P.seed,
      bounds: { x0: -P.WALL, x1: P.WALL, z0: -P.WALL, z1: P.WALL, innerWallFace: P.B },
      heights: { riverBed: 0, water: P.WY, quays: P.QY, street: P.T, kerb: P.CH, pavement: r3(P.T + P.CH) },
      storeys: { groundFloor: 4.2, upperFloor: 3.2 },
      notes: 'Rects are axis-aligned x0..x1 by z0..z1. Fronts: zn = faces -z, zp = +z, xn = -x, xp = +x.',
    },
    streets: P.streets.map(street),
    junctions: P.junctions.map((j) => ({ x: j.x, z: j.z, xStreet: j.xs.id, zStreet: j.zs.id })),
    road: P.ROAD,
    river: { ...P.RIVER, runsAlong: 'x', note: 'z0..z1 between the embankment walls; q0, q1 = the lower quays\' inner edges' },
    promenade: { ...P.PROM, along: 'north bank' },
    bridges: P.bridges.map((b) => ({ x: b.x, kind: b.kind, width: r3(b.w), carriagewayHalfWidth: b.carr, street: b.street?.id ?? null })),
    quays: P.quays.map((q) => ({ ...rect(q), bank: q.side < 0 ? 'south' : 'north' })),
    stairs: P.stairs.map((s) => ({ x: r3(s.x), z: s.z, bank: s.side < 0 ? 'south' : 'north', dir: s.dir, top: r3(s.top), steps: s.n, rise: r3(s.rise), run: s.run, width: s.w, landing: s.landing })),
    squares: P.squares.map((q) => ({ ...rect(q), kind: q.kind, name: q.name || null, street: q.street || null })),
    lanes: P.lanes.map((l) => ({ ...rect(l), runsAlong: l.axis, width: r3(l.w), kind: l.kind, edgeOfSquare: l.square })),
    blocks: P.blocks.map((b) => ({ id: b.id, ...rect(b), fronts: b.fronts || [] })),
    courtyards: P.courtyards.map((c) => ({ ...rect(c), block: c.block })),
    yards: P.yards.map(rect),
    landmarks: P.sites.map((s) => ({ kind: s.kind, ...rect(s), base: s.base, front: s.front })),
    reservedBuildings: Object.values(P.stores).filter(Boolean).map((s) => ({ kind: s.kind, ...rect(s), base: r3(s.base), floors: s.floors, colour: hex(s.colour), roof: s.roof })),
    features: { fountain: P.fountain, well: P.well, cafeTree: P.cafeTree },
    lots: P.lots.map((l) => {
      const h = houseById.get(l.id);
      return {
        id: l.id, block: l.block, ...rect(l), base: r3(l.base), fronts: l.fronts, corner: l.corner,
        floors: l.floors, style: l.style, roof: l.roof, colour: hex(l.colour), age: l.age,
        groundUse: l.groundUse, name: l.name, faces: l.faces,
        eavesY: h ? r3(h.H) : null, storeyYs: h ? h.ys.map(r3) : null, wall: h?.wallKey ?? null,
      };
    }),
    furniture: {
      lamps: (map.lamps || []).map(([x, z, y, r]) => ({ x: r3(x), z: r3(z), lampY: r3(y), glowRadius: r })),
      seats: (map.seats || []).map((s) => ({ at: v3(s.o), yaw: r3(s.yaw), height: s.h })),
      parked: (map.parking || []).map((p) => ({ x: r3(p.x), z: r3(p.z), y: r3(p.y), yaw: r3(p.yaw), kind: p.kind, colour: hex(p.color) })),
      movable: (map.props || []).map((p) => ({ kind: p.kind, x: r3(p.x), z: r3(p.z), y: r3(p.y), yaw: r3(p.yaw) })),
    },
    walk: {
      lines: map.walk.lines.map((l) => l.map(r3)),
      crossings: map.walk.cross.map((l) => l.map((v) => (typeof v === 'number' ? r3(v) : v))),
    },
    jail: map.jail ? { island: map.jail.island, bridge: { x0: map.jail.bridge.x0, x1: map.jail.bridge.x1, deckY: r3(map.jail.bridge.deck) } } : null,
    spawn: { at: v3(map.spawn), yaw: r3(map.spawnYaw) },
    collision: {
      note: 'boxes = walkable tops (minX..maxX, minZ..maxZ at height top); circles = walkable discs; solids = physics boxes (centre x,y,z, size w,h,d) and upright cylinders (centre, r, h)',
      boxes: map.colliders.boxes.map((b) => ({ minX: r3(b.minX), maxX: r3(b.maxX), minZ: r3(b.minZ), maxZ: r3(b.maxZ), top: r3(b.top) })),
      circles: map.colliders.circles.map((c) => ({ x: r3(c.x), z: r3(c.z), r: r3(c.r), top: r3(c.top) })),
      solids: map.colliders.solids.map((s) => (s.type === 'cyl'
        ? { type: 'cyl', x: r3(s.x), y: r3(s.y), z: r3(s.z), r: r3(s.r), h: r3(s.h) }
        : { type: 'box', x: r3(s.x), y: r3(s.y), z: r3(s.z), w: r3(s.w), h: r3(s.h), d: r3(s.d) })),
    },
  };
}
