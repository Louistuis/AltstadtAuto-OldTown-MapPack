import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

/*
  The atmosphere: a physically based daylight sky (three's Preetham Sky) for the sun where the
  level puts it, rendered once at load into
    - the background (a cube map, sun disc and all),
    - the environment light every PBR surface picks up (the same sky without the disc, a ground
      below the horizon for bounce, prefiltered), and
    - the fog colour: far things fade into the sky behind them, not into one flat colour (the
      horizon is brighter toward the sun). The sky's colours are read back and baked into the
      fog shader chunk, so it costs nothing per frame.
  Units: linear, with a sunlit white wall at about 0.7. The sky is scaled so its horizon comes
  out at `horizon` (a clear sky's horizon is roughly a third as bright as white paper in the sun),
  and the environment light so a white surface in shade gets `ambient` (sunlit : shade about 4-5 : 1,
  as on a clear day). With the two in step the environment's intensity stays near 1, so the
  sky glossy surfaces reflect is the sky you see.
*/

const AZ = 16; // fog colour samples round the horizon
const ELEV = [1, 12, 35, 70]; // degrees: the low two for the fog, all of them for the ambient level

/** A Sky with a brightness knob (and, for the environment, no sun disc: the sun light does that). */
function makeSky(sunDir, o, disc) {
  const sky = new Sky();
  sky.scale.setScalar(900);
  const m = sky.material;
  const u = m.uniforms;
  u.turbidity.value = o.turbidity;
  u.rayleigh.value = o.rayleigh;
  u.mieCoefficient.value = o.mie;
  u.mieDirectionalG.value = o.mieG;
  u.sunPosition.value.copy(sunDir);
  u.skyScale = { value: 1 };
  u.skySat = { value: 1 };
  m.fragmentShader = m.fragmentShader
    .replace('uniform vec3 up;', 'uniform vec3 up;\nuniform float skyScale, skySat;')
    .replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( mix( vec3( dot( retColor, vec3( 0.2126, 0.7152, 0.0722 ) ) ), retColor, skySat ) * skyScale, 1.0 );');
  if (!disc) m.fragmentShader = m.fragmentShader.replace('L0 += ( vSunE * 19000.0 * Fex ) * sundisk;', '');
  return sky;
}

/** Below the horizon: the ground's bounce colour, shading into the horizon right at the edge. */
function makeGround(horizon, ground) {
  const geo = new THREE.SphereGeometry(800, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { hor: { value: horizon }, gnd: { value: ground } },
    vertexShader: 'varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 hor, gnd; varying vec3 vD; void main() { gl_FragColor = vec4(mix(hor, gnd, smoothstep(0.0, 0.12, -vD.y)), 1.0); }',
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 1;
  return m;
}

/** The sky's radiance in direction `dir`: a few pixels rendered and read back (null if the GPU can't). */
function sampler(renderer, scene) {
  let rt;
  try {
    rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.FloatType, depthBuffer: false });
  } catch { return null; }
  const cam = new THREE.PerspectiveCamera(1.5, 1, 1, 2000);
  const buf = new Float32Array(4 * 4 * 4);
  const prev = renderer.getRenderTarget();
  const read = (dir) => {
    cam.position.set(0, 0, 0);
    cam.up.set(Math.abs(dir.y) > 0.99 ? 1 : 0, Math.abs(dir.y) > 0.99 ? 0 : 1, 0);
    cam.lookAt(dir);
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, 4, 4, buf);
    const c = new THREE.Color(0, 0, 0);
    for (let i = 0; i < 16; i++) { c.r += buf[i * 4] / 16; c.g += buf[i * 4 + 1] / 16; c.b += buf[i * 4 + 2] / 16; }
    return c;
  };
  return {
    read(dir) {
      try { const c = read(dir); return [c.r, c.g, c.b].every(Number.isFinite) ? c : null; } catch { return null; } finally { renderer.setRenderTarget(prev); }
    },
    dispose() { rt.dispose(); },
  };
}

const dirAt = (azDeg, elDeg) => {
  const a = THREE.MathUtils.degToRad(azDeg), e = THREE.MathUtils.degToRad(elDeg);
  return new THREE.Vector3(Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a));
};

/** The sunlight's colour for how high the sun stands: warm and dimmer near the horizon. */
export function sunColor(sunDir) {
  const el = Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1));
  const t = Math.pow(THREE.MathUtils.clamp((el - 0.03) / 0.7, 0, 1), 0.5);
  return new THREE.Color(0xff9a52).lerp(new THREE.Color(0xfff4e8), t);
}

/**
 * Builds the sky for `sunDir` (normalised, pointing at the sun) into `scene`: background,
 * environment, fog. Returns { env, horizon, ... } (env: the prefiltered map, for materials that
 * take one of their own). `prev`: what an earlier build returned - its targets are drawn into
 * again, so materials holding the old environment map see the new sky (a change of time of day).
 */
export function buildAtmosphere(renderer, scene, sunDir, opts = {}, prev = null) {
  const o = { turbidity: 3.2, rayleigh: 1.4, mie: 0.004, mieG: 0.82, horizon: 0.36, ambient: 0.21, ground: [0.32, 0.3, 0.27], haze: 0.0012, hazeH: 70, envSat: 0.7, ...opts };
  const skyScene = new THREE.Scene();
  const envSky = makeSky(sunDir, o, false);
  skyScene.add(envSky);

  // read the raw sky round the horizon and up toward the zenith
  const S = sampler(renderer, skyScene);
  const rows = ELEV.map((el) => Array.from({ length: AZ }, (_, i) => (S && S.read(dirAt((i / AZ) * 360 - 180, el))) || null));
  S?.dispose();
  const ok = rows.every((r) => r.every(Boolean));
  // (no readback: a plain, believable daylight)
  const fallback = (el) => new THREE.Color(0x9fb9d6).lerp(new THREE.Color(0x4f7fbf), el / 90).multiplyScalar(1);
  const row = (k) => (ok ? rows[k] : Array.from({ length: AZ }, () => fallback(ELEV[k])));
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const horAvg = row(0).reduce((a, c) => a + lum(c), 0) / AZ;
  const scale = o.horizon / Math.max(1e-4, horAvg);
  envSky.material.uniforms.skyScale.value = scale;
  const lo = row(0).map((c) => c.clone().multiplyScalar(scale));
  const hi = row(1).map((c) => c.clone().multiplyScalar(scale));
  const horizonCol = lo.reduce((a, c) => a.add(c), new THREE.Color(0, 0, 0)).multiplyScalar(1 / AZ);

  // ambient level: the cosine-weighted average of the upper sky (rings at each sampled elevation)
  let wSum = 0, lSum = 0;
  ELEV.forEach((el, k) => {
    const e = THREE.MathUtils.degToRad(el), w = Math.cos(e) * Math.sin(e) + 0.02; // (ring area x cos to the up axis)
    for (const c of row(k)) { lSum += lum(c) * scale * w; wSum += w; }
  });
  const skyL = lSum / wSum;

  // (the PBR ambient from the sky: about `ambient` of a white surface's colour in shade)
  const eI = o.ambient / Math.max(1e-4, skyL);
  // the environment: sky (no disc) over a ground that bounces light back up: its own colour
  // times the sun (`sunE`: a white floor's radiance in it; about half the ground is shaded) and the sky
  const groundCol = new THREE.Color(...o.ground).multiplyScalar(((o.sunE ?? 0.8) * 0.55 + o.ambient) / eI);
  const ground = makeGround(horizonCol, groundCol);
  skyScene.add(ground);
  // (the light from the sky a little less blue than the sky looks: shade in photos reads near
  // neutral, the eye and the camera's white balance take most of the cast out)
  envSky.material.uniforms.skySat.value = o.envSat;
  const envCube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  new THREE.CubeCamera(0.1, 1000, envCube).update(renderer, skyScene);
  // (the generator's kept: drawing into last time's target needs its scratch target from then)
  const pm = prev?.pm || new THREE.PMREMGenerator(renderer);
  const envRT = pm.fromCubemap(envCube.texture, prev?.envRT || null);
  const env = envRT.texture;
  envCube.dispose();

  // the background: the same sky with the sun's disc in it, rendered into a cube
  skyScene.remove(envSky);
  const bgSky = makeSky(sunDir, o, true);
  bgSky.material.uniforms.skyScale.value = scale;
  skyScene.add(bgSky);
  const cube = prev?.cube || new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType });
  if (o.bgHorizon) skyScene.remove(ground); // (old town: below the horizon the backdrop carries on the horizon's own colour round the compass, as the fog does: no band past the far plane)
  new THREE.CubeCamera(0.1, 1000, cube).update(renderer, skyScene);
  for (const m of [envSky, bgSky, ground]) { m.geometry.dispose(); m.material.dispose(); }

  scene.background = cube.texture;
  scene.environment = env;
  scene.environmentIntensity = eI;
  if (scene.fog) scene.fog.color.copy(horizonCol);
  installSkyFog(lo, hi, o.haze, o.hazeH);
  scene.userData.atmos = { scale, skyL, eI, ok };
  return { env, envRT, cube, pm, horizon: horizonCol, scale, ok };
}

const v3 = (c) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

/*
  Fog toward the sky behind it: the fog chunks get the view direction in world space and a
  table of sky colours round the horizon (lo: at the horizon, hi: 12 deg up), baked in as
  constants. Two parts:
    - aerial perspective: haze that thins with height (`haze`: extinction per metre at the
      ground, `hazeH`: the height it falls off over), integrated along the view ray - so the
      street far below the tower is softer than the tower across the way at the same distance
    - the edge: the last stretch before fog.far (the camera's far plane) blends fully into the
      sky, so nothing pops in or gets cut off
  Every material compiled after this uses it.
*/
function installSkyFog(lo, hi, haze, hazeH) {
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vFogDir;\n#endif\n';
  C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvFogDir = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;\n#endif\n';
  C.fog_pars_fragment = `#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogDir;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
	const vec3 SKY_LO[${AZ}] = vec3[${AZ}]( ${lo.map(v3).join(', ')} );
	const vec3 SKY_HI[${AZ}] = vec3[${AZ}]( ${hi.map(v3).join(', ')} );
	vec3 skyFogColor( vec3 d ) {
		float t = ( atan( d.z, d.x ) / 6.2831853 + 0.5 ) * ${AZ.toFixed(1)};
		int i0 = int( floor( t ) ) % ${AZ}, i1 = ( i0 + 1 ) % ${AZ};
		float f = fract( t );
		vec3 a = mix( SKY_LO[ i0 ], SKY_LO[ i1 ], f ), b = mix( SKY_HI[ i0 ], SKY_HI[ i1 ], f );
		return mix( a, b, clamp( d.y / 0.2079, 0.0, 1.0 ) );
	}
	// haze along the ray from the camera: density haze * exp(-y / hazeH), integrated in closed form
	float skyHaze( vec3 d, float camY ) {
		float k = d.y / ${hazeH.toFixed(2)};
		float fall = abs( k ) > 1e-4 ? ( 1.0 - exp( - k ) ) / k : 1.0 - 0.5 * k;
		return 1.0 - exp( - ${haze.toExponential(4)} * exp( - camY / ${hazeH.toFixed(2)} ) * length( d ) * fall );
	}
#endif
`;
  C.fog_fragment = `#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	fogFactor = 1.0 - ( 1.0 - fogFactor ) * ( 1.0 - skyHaze( vFogDir, cameraPosition.y ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, skyFogColor( normalize( vFogDir ) ), fogFactor );
#endif
`;
}
