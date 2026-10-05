import * as THREE from 'three';
import { generate, SIZE, AVG } from './surfacegen.js';
import { rng } from '../engine/rng.js';

/*
  Procedural PBR surface sets: every one is a pair of seamless textures worked out per pixel from
  one description of the surface (where the bricks, joints, stones and cracks are), so colour,
  relief and shine always line up (the painters are in world/surfacegen.js).
    map     sRGB colour; alpha = how much of the instance colour tints the texel (bricks take a
            building's colour, the mortar between them mostly stays mortar)
    detail  linear: r, g = the height's slope along u, v (dh / dm, 0.5 = flat, +-1 = 45 deg);
            b = roughness (times the material's own); a = cavity (1 = open, less in grooves)
  worldMat (cityparts.js) samples both in world space, plus the shared macro map (grime, wear,
  puddles and anti-tiling over tens of metres).
  The painting runs in a worker, alongside the level build: each texture is made at full size
  straight away, filled with its surface's average, and gets its real pixels when they arrive
  (a re-upload into the same storage: no new texture, no new program). Without workers it
  paints on the page instead, a set per tick. Each set is made once per page and shared.
*/

/** Painting cost (ms in the worker or on the page, per set), GPU bytes (with mipmaps), textures. */
export const SURF_STATS = { ms: 0, bytes: 0, maps: 0, sets: {}, where: '' };

const cache = new Map();
let worker = null, workerFailed = false;
const waiting = [];

function fill(S, rgba) {
  const a = new Uint8Array(S * S * 4), w = new Uint32Array(a.buffer);
  w.fill((rgba[3] << 24) | (rgba[2] << 16) | (rgba[1] << 8) | rgba[0]); // little-endian RGBA
  return a;
}
/*
  three names every texture (and its image source) with a uuid from Math.random: four draws each.
  A level build runs on a seeded Math.random whose order places things (shop stock, the survival
  map's climb spots), so the textures made here take their uuids from a stream of their own. (Where
  they replace canvas textures the build used to make, the build skips the draws those took:
  skipTextureDraws.)
*/
const ownStream = rng(0x5eed);
function offStream(make) {
  const shared = Math.random;
  Math.random = ownStream;
  try { return make(); } finally { Math.random = shared; }
}
/** Step the seeded stream past what n canvas textures used to draw for their uuids (texture + source). */
export const skipTextureDraws = (n) => { for (let i = 0; i < n * 8; i++) Math.random(); };

/** Repeat-wrapped, mipmapped S x S texture over raw RGBA bytes. */
function dataTex(data, S, srgb, aniso = 1) {
  const t = offStream(() => new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  SURF_STATS.bytes += Math.round(S * S * 4 * 4 / 3); SURF_STATS.maps++;
  return t;
}
function land(name, { col, det, ms }) {
  const s = cache.get(name);
  if (col) { s.map.image.data = col; s.map.needsUpdate = true; }
  s.detail.image.data = det; s.detail.needsUpdate = true;
  SURF_STATS.ms += ms; SURF_STATS.sets[name] = Math.round(ms);
}
function paintHere(name) {
  const t0 = performance.now(), p = generate(name);
  land(name, { ...p, ms: performance.now() - t0 });
  SURF_STATS.where = 'page';
}
function request(name) {
  if (!worker && !workerFailed) {
    try {
      worker = new Worker(new URL('./surfaceworker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => { waiting.splice(waiting.indexOf(e.data.name), 1); land(e.data.name, e.data); };
      worker.onerror = () => { workerFailed = true; worker = null; for (const n of waiting.splice(0)) setTimeout(() => paintHere(n), 0); };
      SURF_STATS.where = 'worker';
    } catch { workerFailed = true; }
  }
  if (worker) { waiting.push(name); worker.postMessage(name); }
  else setTimeout(() => paintHere(name), 0);
}

/** The { map, detail } textures of a surface (asked for on first use, shared after). */
export function surface(name, aniso = 4) {
  let s = cache.get(name);
  if (!s) {
    const S = SIZE[name], avg = AVG[name];
    s = { map: dataTex(fill(S, avg), S, true, aniso), detail: dataTex(fill(S, [128, 128, 235, 255]), S, false, aniso) };
    cache.set(name, s);
    request(name);
  }
  return s;
}
/** The shared world-scale map (linear): r grime, g streaks, b where water pools, a anti-tiling. */
export function macroMap() {
  let s = cache.get('macro');
  if (!s) {
    s = { map: null, detail: dataTex(fill(256, [128, 128, 128, 128]), 256, false, 1) };
    cache.set('macro', s);
    request('macro');
  }
  return s.detail;
}
let flatTex = null;
/** A 1 px detail map with no relief, full roughness and no cavity (for worldMats without a set). */
export function flatDetail() {
  if (!flatTex) {
    flatTex = offStream(() => new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1));
    flatTex.needsUpdate = true;
  }
  return flatTex;
}
let plain = null;
/** A plain white map over flatDetail: a worldMat that is all uniforms and instance colour (glass). */
export function plainSet() {
  if (!plain) {
    const map = offStream(() => new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1));
    map.colorSpace = THREE.SRGBColorSpace; map.needsUpdate = true;
    plain = { map, detail: flatDetail() };
  }
  return plain;
}

/** How many surface sets are still being painted (0 = every texture has its real pixels). */
export const surfacesPending = () => waiting.length;
