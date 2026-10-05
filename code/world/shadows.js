import * as THREE from 'three';

/*
  Shadows past the sun's own shadow box. The sun's map follows the player and covers some 50 m;
  beyond it a second map takes over: the level's static buildings (whatever casts a shadow the
  moment the level's been built, before anyone or anything moves in), drawn once over the whole
  level. It's a second directional light that gives no light, only its map: the lights chunk
  reads it for the sun wherever the sun's own map doesn't reach, and skips it as a light. Cost:
  the one-off render, and the far map's memory (a texture the size of the sun's); per pixel it
  replaces the near lookup rather than adding one (both only in a thin band where they blend).
*/
export const FAR_LAYER = 6;

/** The lights chunk: light 0 (the sun) reads the far map past its own; light 1 (the far map's) gives no light. */
function patchChunks() {
  const C = THREE.ShaderChunk;
  if (C.lights_fragment_begin.includes('sunShadow(')) return;
  const sh = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
  const at = C.lights_fragment_begin.indexOf(sh);
  const re = C.lights_fragment_begin.indexOf('RE_Direct( directLight', at);
  if (at < 0 || re < 0) { console.warn('far shadows: lights chunk not as expected, left off'); return false; }
  const reEnd = C.lights_fragment_begin.indexOf('\n', re);
  const s = C.lights_fragment_begin;
  C.lights_fragment_begin = s.slice(0, at) + `#if ( NUM_DIR_LIGHT_SHADOWS > 1 ) && ( UNROLLED_LOOP_INDEX == 0 )
		directLight.color *= ( directLight.visible && receiveShadow ) ? sunShadow() : 1.0;
		#elif ( NUM_DIR_LIGHT_SHADOWS > 1 ) && ( UNROLLED_LOOP_INDEX == 1 )
		directLight.visible = false;
		#else
		${sh}
		#endif` + s.slice(at + sh.length, re) + `#if !( ( NUM_DIR_LIGHT_SHADOWS > 1 ) && ( UNROLLED_LOOP_INDEX == 1 ) )
		${s.slice(re, reEnd).trim()}
		#endif` + s.slice(reEnd);
  C.shadowmap_pars_fragment += `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1
	// the sun's own map near the player, the far one past it (blended over the last tenth of the near box)
	float sunShadow() {
		vec3 p = vDirectionalShadowCoord[ 0 ].xyz / vDirectionalShadowCoord[ 0 ].w;
		vec2 e = abs( p.xy - 0.5 ) * 2.0;
		float w = p.z > 1.0 ? 1.0 : smoothstep( 0.86, 0.98, max( e.x, e.y ) );
		float near = 1.0, far = 1.0;
		if ( w < 1.0 ) { DirectionalLightShadow s = directionalLightShadows[ 0 ]; near = getShadow( directionalShadowMap[ 0 ], s.shadowMapSize, s.shadowIntensity, s.shadowBias, s.shadowRadius, vDirectionalShadowCoord[ 0 ] ); }
		if ( w > 0.0 ) { DirectionalLightShadow s = directionalLightShadows[ 1 ]; far = getShadow( directionalShadowMap[ 1 ], s.shadowMapSize, s.shadowIntensity, s.shadowBias, s.shadowRadius, vDirectionalShadowCoord[ 1 ] ); }
		return mix( near, far, w );
	}
#endif
`;
  return true;
}

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _p = new THREE.Vector3();

/**
 * The far map for `sun` (the light from world/levelkit.js addSky), `dir` toward the sun. Call
 * while the level's being built: it waits for the build to finish (a microtask: the caller awaits
 * right after), takes every shadow caster there is then and draws them once.
 * Returns { light, casters, redraw(dir) } (redraw: after the sun moves).
 */
export function addFarShadow(scene, renderer, sun, dir, { res = 2048 } = {}) {
  if (patchChunks() === false) return null;
  const light = new THREE.DirectionalLight(0xffffff, 0);
  light.name = 'farShadow';
  light.shadow.mapSize.set(res, res);
  light.shadow.autoUpdate = false;
  light.shadow.camera.layers.set(FAR_LAYER);
  scene.add(light, light.target);
  light.layers.enable(FAR_LAYER);
  const probe = new THREE.OrthographicCamera(-0.01, 0.01, 0.01, -0.01, 0.01, 0.02);
  probe.position.set(0, -1e4, 0); // (nothing's down there)
  probe.layers.set(FAR_LAYER);
  const speck = new THREE.WebGLRenderTarget(1, 1), plain = new THREE.MeshBasicMaterial();
  // (active: there's a level's worth of casters past the sun's own box; off, the light's
  // castShadow stays off and the lights chunk takes its plain path)
  const F = { light, casters: [], box: new THREE.Box3(), active: false };
  F.enable = (on) => { light.castShadow = on && F.active; };
  light.castShadow = false;

  F.redraw = (d = dir) => {
    dir = d;
    if (!F.casters.length) return;
    // fit the light's box round the casters, in its own frame
    _z.copy(dir).normalize();
    _x.set(0, 1, 0).cross(_z).normalize();
    _y.crossVectors(_z, _x);
    const b = F.box, c = b.getCenter(new THREE.Vector3());
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      _p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(c);
      const u = _p.dot(_x), v = _p.dot(_y), w = _p.dot(_z);
      x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); z0 = Math.min(z0, w); z1 = Math.max(z1, w);
    }
    const cam = light.shadow.camera;
    light.position.copy(c).addScaledVector(_z, z1 + 5);
    light.target.position.copy(c);
    cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1;
    cam.near = 1; cam.far = z1 - z0 + 10;
    cam.updateProjectionMatrix();
    // (a texel here is tens of cm: the bias follows it)
    const texel = Math.max(x1 - x0, y1 - y0) / light.shadow.mapSize.x;
    light.shadow.bias = -0.0006;
    light.shadow.normalBias = texel * 1.2;
    // every caster in, whatever the per-frame culling or LOD last left it at; drawn; put back
    const was = F.casters.map((o) => [o.castShadow, o.visible]);
    for (const o of F.casters) { o.castShadow = true; o.visible = true; }
    const on = light.castShadow, enabled = renderer.shadowMap.enabled, ov = scene.overrideMaterial, prev = renderer.getRenderTarget();
    light.castShadow = renderer.shadowMap.enabled = true;
    light.shadow.needsUpdate = true;
    // (shadow maps are only drawn inside a render: one through a camera that sees nothing but
    // this light - a speck of a frustum on its layer - into a 1-pixel target, all one cheap material)
    scene.overrideMaterial = plain;
    renderer.setRenderTarget(speck);
    renderer.render(scene, probe);
    renderer.setRenderTarget(prev);
    scene.overrideMaterial = ov;
    light.castShadow = on; renderer.shadowMap.enabled = enabled;
    F.casters.forEach((o, i) => { [o.castShadow, o.visible] = was[i]; });
  };

  queueMicrotask(() => {
    const b = F.box.makeEmpty(), ob = new THREE.Box3();
    scene.traverse((o) => {
      if (!o.castShadow || !(o.isMesh || o.isInstancedMesh || o.isBatchedMesh) || o.isSkinnedMesh) return;
      o.layers.enable(FAR_LAYER);
      F.casters.push(o);
      b.union(ob.setFromObject(o));
    });
    // (all inside a couple of the sun's own boxes, as on the baseplate: not worth a map)
    const size = b.getSize(new THREE.Vector3());
    const span = sun.shadow.camera.right - sun.shadow.camera.left;
    if (!F.casters.length || b.isEmpty() || Math.max(size.x, size.z) < span * 2) return;
    F.active = true;
    F.enable(sun.castShadow);
    F.redraw();
  });
  return F;
}
