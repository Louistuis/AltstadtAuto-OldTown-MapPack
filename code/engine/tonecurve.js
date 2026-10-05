import * as THREE from 'three';

/*
  AltstadtAuto's tone curve and renderer setup.
*/

// exposure for the tone curve below (sunlit pavement comes out about 80% up, shade about 35%, a white wall in the sun near the top)
const EXPOSURE = 1.5;
/*
  The tone curve: three's AgX, narrowed and with a "look" on it. Plain AgX takes 16.5 stops
  (log2 -12.5 .. +4) and lays them out flat and grey, like an ungraded log photo: a sunny
  street needs about 11, so the range is cut to `min`..`max` (the contrast a camera gives) and,
  as Blender's AgX looks do, a power and a saturation go on in AgX's log space before it goes
  back to display. Highlights still roll off and lose colour the AgX way (no hue twists).
  ?tone=min:-9.5,max:2.2,power:1.1,sat:1.1 to try others.
*/
export function installLook(Q = new URLSearchParams(typeof location !== "undefined" ? location.search : "")) {
  const C = THREE.ShaderChunk, t = C.tonemapping_pars_fragment;
  const a = t.indexOf('vec3 AgXToneMapping'), b = t.indexOf('\n}', a);
  const stub = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (a < 0 || b < 0 || !t.includes(stub) || !t.includes('color = agxDefaultContrastApprox( color );')) return false;
  const k = { min: -9.5, max: 2.2, power: 1.1, sat: 1.1 };
  for (const kv of (Q.get('tone') || '').split(',').filter(Boolean)) { const [n, v] = kv.split(':'); if (n in k && Number.isFinite(+v)) k[n] = +v; }
  const look = `color = agxDefaultContrastApprox( color );
	color = pow( max( color, vec3( 0.0 ) ), vec3( ${k.power.toFixed(3)} ) );
	float lookL = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
	color = max( vec3( 0.0 ), lookL + ${k.sat.toFixed(3)} * ( color - lookL ) );`;
  const fn = t.slice(a, b + 2).replace('vec3 AgXToneMapping', 'vec3 CustomToneMapping').replace('color = agxDefaultContrastApprox( color );', look)
    .replace(/const float AgxMinEv = [^;]+;/, `const float AgxMinEv = ${k.min.toFixed(3)};`).replace(/const float AgxMaxEv = [^;]+;/, `const float AgxMaxEv = ${k.max.toFixed(3)};`);
  C.tonemapping_pars_fragment = t.replace(stub, fn);
  return true;
}


/**
 * A WebGLRenderer set up the way the Old Town expects: shadows on (soft), the custom AgX look as
 * the tone curve, sRGB output. The post chain (engine/post.js) applies the curve in its last pass.
 */
export function makeRenderer(canvas, { pixelRatio = Math.min(devicePixelRatio, 1.5) } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const look = installLook();
  renderer.toneMapping = look ? THREE.CustomToneMapping : THREE.AgXToneMapping;
  renderer.toneMappingExposure = look ? EXPOSURE : 1.4;
  return renderer;
}
