import * as THREE from 'three';

/*
  Evening lights, cheap. Street lamps and lit windows are emissive materials: no light per lamp,
  the bloom (engine/post.js) gives them their glow, and their brightness follows the time of day
  (off at midday, on in the evening). For the ground under the lamps, a small pool of real
  point lights (High: 2, Ultra: 4, none below) follows the player round the nearest lamps,
  each fading out before it's handed to another lamp, so nothing pops.

  API:
    lampMaterial(color?)       the glowing glass of a lamp head (one shared material per colour)
    windowGlowMaterial(color?) a lit window pane: warm light from inside. Instance colours tint
                               AND scale its glow (white = full, 0x404040 = a dim room), so one
                               material and one batch serve every lit window
    registerLamps(scene, pts)  where the lamp heads are (Vector3s): the point-light pool uses them
    GLOW                       { lamps, windows }: how lit, 0..1, from the time of day
  Brightness in the scene's units (a sunlit white wall is about 0.7): lamp glass ~8 (well into
  the bloom), a lit window ~1.2 (reads lit against the evening sky, no bloom).
*/
export const GLOW = { lamps: 0, windows: 0 };
const BY_TIME = { day: [0, 0], afternoon: [0, 0.08], evening: [1, 0.75], golden: [0.85, 0.6] };
const LAMP = 8, WINDOW = 1.2, POOL_I = 15, POOL_R = 16;
const mats = [];
let time = 'day';

const shared = new Map();
/** The glowing glass of a street lamp (shared per colour). */
export function lampMaterial(color = 0xffd3a0) {
  const key = 'lamp' + color;
  if (shared.has(key)) return shared.get(key);
  const m = new THREE.MeshStandardMaterial({ color: 0x3a342c, roughness: 0.35, emissive: color, emissiveIntensity: 0 });
  m.userData.glow = ['lamps', LAMP];
  return reg(key, m);
}
/** A lit window pane (shared per colour); the instance colour scales its glow. */
export function windowGlowMaterial(color = 0xffc58a) {
  const key = 'window' + color;
  if (shared.has(key)) return shared.get(key);
  const m = new THREE.MeshStandardMaterial({ color: 0x15120f, roughness: 0.12, emissive: color, emissiveIntensity: 0 });
  m.userData.glow = ['windows', WINDOW];
  // (instance colour on the glow too, not only on the dark glass under it)
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )\n\ttotalEmissiveRadiance *= vColor.rgb;\n#endif');
  };
  return reg(key, m);
}
function reg(key, m) {
  shared.set(key, m);
  mats.push(m);
  apply(m);
  return m;
}
const apply = (m) => { const [k, base] = m.userData.glow; m.emissiveIntensity = base * GLOW[k]; };

// ---- the point-light pool ----
let lamps = [], pool = [], poolSize = 0, scene = null;
const lastAt = new THREE.Vector3(1e9, 0, 0);
let frame = 0;

/** Where the lamp heads are (world positions), for the pool. */
export function registerLamps(sc, points) {
  scene = sc;
  lamps = points.map((p) => p.clone());
  syncPool();
}
/** How many pool lights (the host picks it, e.g. from a quality preset). Changing it recompiles. */
export function setLampPool(n) {
  poolSize = n;
  syncPool();
}
function syncPool() {
  const want = scene && lamps.length && GLOW.lamps > 0 ? Math.min(poolSize, lamps.length) : 0;
  while (pool.length > want) pool.pop().removeFromParent();
  while (pool.length < want) {
    const l = new THREE.PointLight(0xffc98a, 0, POOL_R, 2);
    l.castShadow = false;
    pool.push(l);
    scene.add(l);
  }
  lastAt.set(1e9, 0, 0);
}

/** The time of day's glow (world/levelkit.js setTimeOfDay). */
export function glowFor(t) {
  time = t;
  [GLOW.lamps, GLOW.windows] = BY_TIME[t] || [0, 0];
  for (const m of mats) apply(m);
  syncPool();
}

const near = [];
/** Each frame (world/levelkit.js placeSun): the pool onto the lamps nearest `p`. */
export function glowFrame(p) {
  if (!pool.length) return;
  // (re-pick every few frames, or straight away after a jump of more than a few metres)
  if (++frame % 6 && lastAt.distanceToSquared(p) < 9) return;
  lastAt.copy(p);
  near.length = 0;
  for (const l of lamps) near.push([l.distanceToSquared(p), l]);
  near.sort((a, b) => a[0] - b[0]);
  // (each light fades to nothing by the distance of the first lamp left out: a hand-over is invisible)
  const cut = Math.sqrt(near[pool.length]?.[0] ?? (POOL_R * POOL_R * 4));
  pool.forEach((l, i) => {
    const [d2, at] = near[i];
    l.position.copy(at).y -= 0.15;
    const w = 1 - THREE.MathUtils.smoothstep(Math.sqrt(d2), cut * 0.7, cut);
    l.intensity = POOL_I * GLOW.lamps * w;
  });
}
export const glowTime = () => time;
