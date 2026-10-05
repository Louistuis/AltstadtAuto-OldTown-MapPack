import * as THREE from 'three';
import { Colliders, addSolid, addCyl } from '../engine/collision.js';
import { addSky, placeSun, setTimeOfDay } from '../engine/levelkit.js';
import { rng } from '../engine/rng.js';
import { Batch, ChunkSite, BOX, CONE, CYL, updateLod } from '../engine/parts.js';
import { oldTownMaterials } from './materials.js';
import { makePlan, T, CH } from './plan.js';
import { plateau, layGround, ZEBRA, ZW } from './streets.js';
import { buildRiver, buildWall } from './river.js';
import { buildBridges } from './bridges.js';
import { furnitureKit, furnish, lightPools, poolLevel, POOL_MAT } from './furniture.js';
import { buildSites } from './sites.js';
import { navLines } from './walklines.js';
import { buildLots, buildLandmark } from './buildings/index.js';
import { PRISM, HIP } from './placeholder.js';
import { buildPrison } from './prison.js';

/*
  The Old Town of AltstadtAuto: a dense central European old town on a river, at dusk.

  The plan (plan.js) lays it out from a seed; this builds it in phases over one build context C:
  the plateau and its ground, the river and the town wall, the bridges, a house on every lot and
  the landmarks on their sites, the three reserved buildings, the street furniture, the island
  jail, the light pools under the lanterns and the traffic signals. Then every batch is built into
  InstancedMeshes inside one THREE.Group.

  Heights: the river bed is the world's floor (y = 0); streets, lanes and squares are at T (4 m),
  pavements a kerb (CH, 14 cm) higher, the lower quays at QY (1.2 m), the water at WY (0.62 m).
  Units are metres, y is up, the town spans x and z from -200 to +200 (inside the wall).

  buildOldTown(scene, renderer, options) -> the map (see the return value at the end).
*/

export function buildOldTown(scene, renderer, {
  seed = 20261004,     // the plan's seed: lanes, lots, storeys, styles, colours, shop names
  detailSeed = 4242,   // furniture placement and small variation
  sky = true,          // add the Old Town's own sky, sun, fog and environment light to `scene`
  jail = true,         // the jail on its river island (and its footbridge)
  fog = { near: 85, far: 260 },
  shadowRes = 2048,
  time = null,         // override the time of day: 'day' | 'afternoon' | 'evening' | 'golden'
} = {}) {
  const t0 = performance.now();
  const P = makePlan(seed);
  const R = rng(detailSeed);
  const group = new THREE.Group();
  group.name = 'OldTown';
  scene.add(group);

  // a low evening sun from the south-west: long shadows down the streets
  const sunOff = new THREE.Vector3(-34, 19, -24);
  const skyScene = sky ? scene : new THREE.Scene(); // (no sky wanted: build it aside, keep only its environment map)
  const sun = addSky(skyScene, {
    renderer, sunOff, time: 'evening', fogNear: fog.near, fogFar: fog.far, hemi: 1.1, sunI: 2.6, span: 26, far: 80, shadowRes,
    atmos: { haze: 0.0008, ground: [0.5, 0.45, 0.39], bgHorizon: 1 }, timeOverride: time,
  });
  const env = skyScene.userData.env;

  const colliders = new Colliders();
  colliders.groundY = T;
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const C = { scene: group, R, env, colliders, aniso, site: new ChunkSite(), plan: P, BOX };
  C.M = oldTownMaterials(C);
  // the layout's own few materials (lit things and plain interior surfaces)
  C.X = {
    lampGlow: new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffb860, emissiveIntensity: 2.2, roughness: 0.3 }),
    plain: new THREE.MeshStandardMaterial({ roughness: 0.7 }),
    caseGlass: new THREE.MeshStandardMaterial({ color: 0xcfe4ee, roughness: 0.05, metalness: 0.1, envMap: env, envMapIntensity: 0.6, transparent: true, opacity: 0.16, depthWrite: false }),
  };
  // batches: one per geometry + material + options, whatever a module calls it (the order they
  // are made is the draw order); each named after the first key asked for
  const batches = C.batches = new Map(), names = new Map();
  C.batch = (key, geo, mat, opts = {}) => {
    const k = `${geo.uuid}|${mat.uuid}|${opts.cast ?? true}|${opts.lod || 0}|${!!opts.fade}`;
    let b = batches.get(k);
    if (!b) { batches.set(k, (b = new Batch(geo, mat, opts, C.site))); names.set(b, key); }
    return b;
  };
  C.box = (key, mat, opts) => C.batch(key, BOX, C.M[mat], opts);
  C.B = {};
  C.solidBox = (x0, x1, z0, z1, y0, top, extra) => {
    addSolid(colliders, x0, x1, z0, z1, y0, top, extra);
    if (extra?.topOnly) colliders.solids[colliders.solids.length - 1].topOnly = true;
  };
  C.solidCyl = (x, z, r, top) => addCyl(colliders, x, z, r, 0, top);
  C.roofPrism = C.batch('b.roofTile', PRISM, C.M.roofTile);
  C.hipRoof = C.batch('b.roofHip', HIP, C.M.roofTile);
  C.roofCone = C.batch('roofCone', CONE, C.M.roofTile);
  const walk = navLines(P);
  C.walkLines = walk.lines; // furniture keeps off these

  const laps = [];
  const lap = (k) => laps.push(`${k} ${Math.round(performance.now() - t0)}`);
  plateau(C);
  layGround(C, P);
  C.B.rail = C.box('rail', 'rail', { cast: false });
  lap('ground');
  furnitureKit(C);
  buildRiver(C, P);
  buildWall(C, P);
  buildBridges(C, P);
  lap('river');
  const houses = buildLots(C, P.lots);
  for (const s of P.sites) buildLandmark(C, s);
  lap('buildings');
  buildSites(C, P);
  furnish(C, P);
  const jailInfo = jail ? buildPrison(C, P) : null;
  lightPools(C);
  const lights = trafficSignals(C, P);
  lap('furniture');

  // every batch into its InstancedMeshes
  const meshes = [];
  for (const b of batches.values()) for (const m of b.build(group)) { m.userData.batch ||= names.get(b); meshes.push(m); }
  lap('batches');
  console.log(`[oldtown] built in ${Math.round(performance.now() - t0)} ms: ${P.lots.length} lots, ${batches.size} batches, ${meshes.length} meshes (${laps.join(', ')})`);

  const skyState = skyScene.userData.sky;
  let clock = 0;
  return {
    /** Everything visible, in one group (already added to `scene`). */
    group,
    /** Collision shapes (engine/collision.js): boxes, circles, solids. */
    colliders,
    /** A good place to start: the market square, west of the fountain, looking across to the town hall. */
    spawn: new THREE.Vector3(P.fountain.x - 10, T, P.fountain.z - 6),
    spawnYaw: Math.PI * 0.85,
    /** The full plan (plan.js): streets, squares, lanes, blocks, lots, sites, bridges, quays, stairs... */
    plan: P,
    sun, env,
    /** Benches and cafe chairs: { o: Vector3, yaw, h }. */
    seats: C.manualSeats,
    /** Where vehicles are parked: { x, z, y, yaw, kind, color }. */
    parking: C.parking || [],
    /** Movable props (cafe tables and chairs, bins): { kind, x, z, y, yaw }. */
    props: C.props,
    /** Pedestrian lines { lines: [[x0, z0, x1, z1, y]], cross: [...] } (walklines.js). */
    walk,
    /** Every house's resolved plan (planLot in buildings/house.js): storey heights ys, eaves height H, materials... */
    houses,
    /** Every lantern: [x, z, lampY, glowRadius]. */
    lamps: C.pools,
    /** The island jail's layout (rooms, doors), if built. */
    jail: jailInfo,
    /** All meshes built, and the ones that swap with distance. */
    meshes, lodMeshes: C.site.lodMeshes,
    /**
     * Call every frame: LOD swap round the camera, the sun's shadow box following `focus`
     * (default: the camera), the traffic signal cycle, the lamp pools for the time of day.
     */
    update(dt, camera, focus = camera.position) {
      clock += dt;
      updateLod(C.site.lodMeshes, camera.position.x, camera.position.z);
      if (skyState) {
        const fwd = camera.getWorldDirection(_fwd);
        placeSun(sun, skyState.off, focus, fwd);
      }
      lights.set(clock);
      POOL_MAT.opacity = poolLevel(skyState?.time);
    },
    /** 'level' (the Old Town's own evening), 'day', 'afternoon', 'evening' or 'golden'. */
    setTime(name) { return setTimeOfDay(skyScene, name); },
  };
}
const _fwd = new THREE.Vector3();

/**
 * Traffic signals on every corner of every junction: a dark green pole with a pedestrian head
 * (walking figure / red hand) for each crossing and a three-lamp vehicle head for each approach.
 * Returns { set(t) }: lights them for time t (s) on a 24 s cycle, the two directions in turn.
 */
function trafficSignals(C, P) {
  const { B } = C;
  const lamp = (c) => new THREE.MeshStandardMaterial({ color: 0x151515, emissive: c, emissiveIntensity: 0, roughness: 0.4 });
  // per direction g ('x' = traffic along x, 'z' = along z): vehicle lamps and pedestrian lamps
  const heads = {};
  for (const g of ['x', 'z']) {
    heads[g] = {
      r: lamp(0xff2a1a), y: lamp(0xffb020), g: lamp(0x3dff7a),
      walk: lamp(0xf4f4ff), hand: lamp(0xff7a1a),
    };
  }
  const lampBatch = {};
  for (const g of ['x', 'z']) for (const k of ['r', 'y', 'g', 'walk', 'hand']) {
    lampBatch[g + k] = C.batch(`signal.${g}.${k}`, k.length === 1 ? CYL : BOX, heads[g][k], { cast: false });
  }
  const Y = T + CH;
  for (const J of P.junctions) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      // on the pavement just behind the zebra, at the stop line
      const x = J.x + sx * (J.xs.carr + 0.9), z = J.z + sz * (J.zs.carr + ZEBRA + ZW + 0.6);
      B.ironC.add(x, Y + 2.3, z, 0.15, 4.6, 0.15, 0x24382f);
      C.solidCyl(x, z, 0.12, Y + 4.6);
      C.claim(x, z, 0.5);
      // pedestrian heads, facing the people about to cross each way
      for (const [nx, nz, g] of [[-sx, 0, 'x'], [0, -sz, 'z']]) {
        const facing = Math.atan2(nx, nz), px = x + nx * 0.2, pz = z + nz * 0.2;
        B.ironB.add(px, Y + 2.75, pz, 0.36, 0.62, 0.22, 0x1f2a24, facing);
        const fx = px + nx * 0.115, fz = pz + nz * 0.115;
        lampBatch[g + 'hand'].add(fx, Y + 2.9, fz, 0.24, 0.22, 0.01, 0xffffff, facing);
        lampBatch[g + 'walk'].add(fx, Y + 2.6, fz, 0.24, 0.22, 0.01, 0xffffff, facing);
      }
      // vehicle heads, facing the approaching traffic
      for (const [nx, nz, g] of [[0, sz, 'z'], [sx, 0, 'x']]) {
        const facing = Math.atan2(nx, nz), hx = x + nx * 0.25, hz = z + nz * 0.25;
        B.ironB.add(hx, Y + 3.9, hz, 0.36, 1.05, 0.3, 0x1f2a24, facing);
        const fx = hx + nx * 0.16, fz = hz + nz * 0.16;
        ['r', 'y', 'g'].forEach((c, k) => lampBatch[g + c].add(fx, Y + 4.22 - k * 0.32, fz, 0.22, 0.02, 0.22, 0xffffff, facing, Math.PI / 2));
      }
    }
  }
  // traffic along x: green 0-10 s, amber 10-12, red 12-24; along z the same, 12 s later.
  // People cross alongside the green traffic (their figure lit), the hand otherwise.
  const phase = (t) => (t < 10 ? 'g' : t < 12 ? 'y' : 'r');
  return {
    set(time) {
      const t = time % 24;
      const state = { x: phase(t), z: phase((t + 12) % 24) };
      for (const g of ['x', 'z']) {
        const H = heads[g], s = state[g];
        for (const c of ['r', 'y', 'g']) H[c].emissiveIntensity = s === c ? 2.6 : 0;
        H.walk.emissiveIntensity = s === 'g' ? 2.2 : 0;
        H.hand.emissiveIntensity = s === 'g' ? 0 : 2.2;
      }
    },
  };
}
