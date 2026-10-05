import * as THREE from 'three';
import { buildAtmosphere, sunColor } from '../world/sky.js';
import { addFarShadow } from '../world/shadows.js';
import { glowFor, glowFrame } from '../world/glow.js';
import { SHADOW_LAYER } from './parts.js';

/*
  Times of day, each from the level's own sun (`sunOff`: its compass direction is kept, the
  height in the sky changes). `sun`: its strength against the level's (lower = through more air),
  `exposure`: against the base exposure (a low sun is a dimmer day), `wb`: a white balance on
  the picture (engine/post.js: warmer in the evening, as a camera left on daylight sees it); the rest go to the sky
  (world/sky.js buildAtmosphere). A level picks its own with addSky's `time`; a viewer can
  override it (setTimeOfDay(scene, name), or ?time=evening in the viewer's URL).
*/
export const TIMES = {
  day: {}, // the level's own sun as given
  afternoon: { elev: 30, sun: 0.95, exposure: 1.05, turbidity: 3.6, ambient: 0.19, horizon: 0.34 },
  evening: { elev: 16, sun: 0.9, exposure: 1.45, wb: [1.07, 1.0, 0.9], turbidity: 4, rayleigh: 1.8, mie: 0.005, ambient: 0.2, horizon: 0.33, haze: 0.0014 },
  golden: { elev: 9, sun: 0.82, exposure: 1.55, wb: [1.09, 1.0, 0.86], turbidity: 4.5, mie: 0.005, rayleigh: 2.0, ambient: 0.18, horizon: 0.3, haze: 0.0015 },
};
// (the tallest thing whose shadow must reach the player from the sun's side: sets how far
// back toward a low sun the shadow camera has to sit)
const CASTER_H = 28;

/**
 * The Old Town's sky and sun. Adds to `scene`: the physical sky (world/sky.js: background,
 * prefiltered environment light, fog toward the sky), a faint hemisphere fill and the
 * shadow-casting sun, placed at `sunOff` (an offset from the point it follows, so also its
 * direction). `time`: one of TIMES ('evening' for the Old Town). The prefiltered sky lands in
 * scene.userData.env for materials that take an environment map. Returns the sun.
 */
export function addSky(scene, { renderer, sunOff = new THREE.Vector3(8, 14, 6), time = 'day', fogNear = 40, fogFar = 160, hemi = 1.3, sunI = 2.6, span = 14, near = 1, far = 50, atmos, shadowRes = 2048, timeOverride = null } = {}) {
  // the sky's haze does the distance; the fog only closes the last stretch before the far plane
  scene.fog = new THREE.Fog(0xa9c1d6, Math.max(fogNear, fogFar * 0.72), fogFar);
  const hemiL = new THREE.HemisphereLight(0xffffff, 0x4a4238, hemi * 0.18);
  const sun = new THREE.DirectionalLight(0xffffff, sunI * 1.12);
  // the sun's shadow: a square box `span` m either side of the point it follows
  Object.assign(sun.shadow, { bias: -0.0004, normalBias: 0.02 });
  sun.shadow.mapSize.setScalar(shadowRes);
  Object.assign(sun.shadow.camera, { left: -span, right: span, bottom: -span, top: span, near, far });
  shadowLayerPass(renderer);
  sun.castShadow = true;
  scene.add(hemiL, sun, sun.target);
  scene.userData.sky = {
    renderer, base: sunOff.clone(), off: sunOff, sun, hemiL, sunI, span, far, atmos: { ...atmos },
    levelTime: TIMES[time] ? time : 'day', urlTime: TIMES[timeOverride] ? timeOverride : null, time: null, built: null,
  };
  setTimeOfDay(scene, 'level');
  sun.position.copy(sunOff);
  scene.userData.env = scene.userData.sky.built.env;
  // past the sun's own box: every static caster drawn once into a map over the whole town (world/shadows.js)
  scene.userData.farShadow = addFarShadow(scene, renderer, sun, sunOff.clone().normalize(), { res: Math.min(shadowRes, 2048) });
  return sun;
}

/**
 * The sun to another time of day (TIMES, or 'level': the level's own): its place, colour and
 * strength, the sky, its light and fog, the shadow camera, the far shadows. Returns false if
 * there's nothing to change; true means the fog chunk changed, so every material wants
 * recompiling.
 */
export function setTimeOfDay(scene, name) {
  const S = scene.userData.sky;
  if (!S) return false;
  const t = S.urlTime || (TIMES[name] ? name : S.levelTime);
  if (S.time === t) return false;
  S.time = t;
  const T = TIMES[t];
  const b = S.base, len = b.length(), az = Math.atan2(b.z, b.x);
  // ('day' on a level whose own sun is low, the old town's evening: a midday height instead)
  const own = Math.asin(b.y / len), elev0 = t === 'day' && S.levelTime !== 'day' ? THREE.MathUtils.degToRad(55) : own;
  const el = T.elev !== undefined ? THREE.MathUtils.degToRad(T.elev) : elev0;
  const sinEl = Math.sin(el);
  /*
    The shadow camera for this sun. Low sun: shadows run long, so it sits further back toward
    the sun (far enough that a CASTER_H building's shadow still reaches the player), and its
    box is squashed along the sun's direction so a shadow-map texel stays near square on the
    ground (as the sun drops, a square box would cover a long thin strip at low resolution
    along it; this keeps the ground it covers within about 2:1 down to a 15 deg sun).
  */
  const L = Math.max(len, Math.min(160, CASTER_H / Math.max(0.1, sinEl) + 5));
  S.off.set(Math.cos(el) * Math.cos(az), sinEl, Math.cos(el) * Math.sin(az)).multiplyScalar(L);
  const cam = S.sun.shadow.camera;
  cam.far = L + Math.max(20, S.far - len);
  cam.top = S.span * Math.max(0.5, sinEl); cam.bottom = -cam.top;
  cam.updateProjectionMatrix();
  const dir = S.off.clone().normalize();
  const sunI = S.sunI * (T.sun ?? 1);
  // (a white floor's radiance in full sun: what the ground bounces back up)
  const sunE = sunI * 1.12 * Math.max(0, dir.y) / Math.PI;
  const { elev, sun: _s, exposure, wb, ...sky } = T;
  S.wb = wb || [1, 1, 1];
  S.built = buildAtmosphere(S.renderer, scene, dir, { sunE, ...sky, ...S.atmos }, S.built);
  S.sun.color.copy(sunColor(dir));
  S.sun.intensity = sunI * 1.12;
  S.hemiL.color.copy(S.built.horizon);
  S.exposure0 ??= S.renderer.toneMappingExposure;
  S.renderer.toneMappingExposure = S.exposure0 * (exposure ?? 1);
  scene.userData.farShadow?.redraw(dir);
  glowFor(t);
  return true;
}

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _c = new THREE.Vector3();
/**
 * The sun's shadow box follows `p` (the player or their car), at their height (the tower roof is
 * 120 m up), pushed ahead along where the camera looks (`fwd`: what's in front matters more than
 * what's behind). Its centre snaps to whole shadow-map texels in the light's own frame, so the
 * edges of shadows stand still while you move instead of crawling.
 */
export function placeSun(sun, off, p, fwd) {
  const s = sun.shadow.camera, span = s.right - s.left;
  const ahead = fwd ? span * 0.3 / Math.max(1e-3, Math.hypot(fwd.x, fwd.z)) : 0;
  glowFrame(p);
  _c.set(p.x + (fwd ? fwd.x * ahead : 0), p.y, p.z + (fwd ? fwd.z * ahead : 0));
  // the light's frame (as lookAt builds it: z back toward the sun, x level, y the rest)
  _z.copy(off).normalize();
  _x.set(0, 1, 0).cross(_z).normalize();
  _y.crossVectors(_z, _x);
  const tx = span / sun.shadow.mapSize.x, ty = (s.top - s.bottom) / sun.shadow.mapSize.y;
  const u = _c.dot(_x), v = _c.dot(_y);
  _c.addScaledVector(_x, Math.round(u / tx) * tx - u).addScaledVector(_y, Math.round(v / ty) * ty - v);
  sun.target.position.copy(_c);
  sun.position.copy(_c).add(off);
}

/**
 * Shadow-only meshes (the merged building bodies keep a light copy of themselves for the shadow
 * map) live on SHADOW_LAYER, which the picture never draws. three.js tests a caster's layers
 * against the VIEW camera during the shadow pass, so the view camera gets that layer for the
 * shadow pass only. Installed once per renderer.
 */
export function shadowLayerPass(renderer) {
  const sm = renderer.shadowMap;
  if (sm.userData_shadowLayer) return;
  sm.userData_shadowLayer = true;
  const draw = sm.render.bind(sm);
  sm.render = (lights, scene, camera) => {
    const had = camera.layers.isEnabled(SHADOW_LAYER);
    if (!had) camera.layers.enable(SHADOW_LAYER);
    try { draw(lights, scene, camera); } finally { if (!had) camera.layers.disable(SHADOW_LAYER); }
  };
}
