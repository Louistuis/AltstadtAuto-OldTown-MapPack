// The picture after the scene is drawn: ambient occlusion, bloom, tone mapping and a light
// grade. The scene renders once into a linear HDR target (fog, sky and lights all agree in one
// space) that keeps its depth; everything after works from that colour and depth alone (no second
// scene pass: the AO rebuilds the normals it needs from the depth). One pass tone-maps and
// grades, and FXAA puts it on the screen.
import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

/*
  Quality presets (makePost(...).setQuality(name)), each a step up in cost. Every one is 4x MSAA on the
  scene plus FXAA after the tone curve: MSAA resolves before tone mapping, so a bright sky
  behind a dark edge still steps, and shading inside surfaces (glints, thin wires, far window
  bars) MSAA never touches; FXAA takes both out.
    low    - the scene, tone-mapped, FXAA (no grade). Two full-screen passes (phones)
    medium - + the grade, a soft vignette, a little bloom from a quarter-resolution chain
    high   - + ambient occlusion at half resolution (normals from depth, GTAO, a denoise), bloom
             from half resolution
    ultra  - ambient occlusion at full resolution, more AO samples, a wider bloom
  (a GPU that can't render to half-float targets gets the old direct path: tone mapping in the
  materials, the canvas's own MSAA, no post at all)
*/
export const QUALITY = {
  low: { msaa: 4, ao: 0, bloom: 0, grade: false, fxaa: true },
  medium: { msaa: 4, ao: 0, bloom: 4, bloomScale: 0.25, grade: true, fxaa: true },
  high: { msaa: 4, ao: 0.5, aoSamples: 12, bloom: 5, bloomScale: 0.5, grade: true, fxaa: true },
  ultra: { msaa: 4, ao: 1, aoSamples: 16, bloom: 6, bloomScale: 0.5, grade: true, fxaa: true },
};
const DIRECT = { direct: true }, ONE = [1, 1, 1];
// (the tone curve the renderer's set to, called by name in the last pass: engine/tonecurve.js installs Custom)
const TONE = { [THREE.CustomToneMapping]: 'CustomToneMapping', [THREE.AgXToneMapping]: 'AgXToneMapping', [THREE.ACESFilmicToneMapping]: 'ACESFilmicToneMapping', [THREE.NeutralToneMapping]: 'NeutralToneMapping', [THREE.ReinhardToneMapping]: 'ReinhardToneMapping' };

// what the look is made of (all in one place, for tuning)
export const LOOK = {
  bloom: 0.045, // how much of the glow gets added (per mip level, roughly)
  threshold: 1.6, // linear HDR level bloom starts at (a sunlit white wall is about 1, the sun's glints far more)
  knee: 0.6,
  ao: 1.0, // AO strength in shade
  aoLit: 0.35, // ... and on brightly lit surfaces (direct sun isn't occluded by the corner next to it)
  contrast: 1.06, saturation: 1.06, vignette: 0.2,
};
// (A/B without code edits: ?look=bloom:0.06,ao:1)
export const urlKnobs = (k) => Object.fromEntries((new URLSearchParams(location.search).get(k) || '').split(',').filter(Boolean).map((kv) => kv.split(':')).map(([a, b]) => [a, +b]));
Object.assign(LOOK, urlKnobs('look'));

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const quad = new FullScreenQuad(null);
const mat = (o) => new THREE.ShaderMaterial({ vertexShader: VERT, depthTest: false, depthWrite: false, ...o });

// view-space normals rebuilt from depth (the sharper side of each pixel, so edges stay clean), packed into RGB
const NormalShader = () => mat({
  uniforms: { tDepth: { value: null }, projInv: { value: new THREE.Matrix4() } },
  fragmentShader: `
    #include <packing>
    uniform highp sampler2D tDepth; uniform mat4 projInv; varying vec2 vUv;
    vec3 viewPos(vec2 uv, float d) { vec4 p = projInv * vec4(vec3(uv, d) * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
    float fd(ivec2 p) { return texelFetch(tDepth, p, 0).x; }
    void main() {
      vec2 size = vec2(textureSize(tDepth, 0));
      ivec2 p = ivec2(vUv * size);
      float c0 = fd(p);
      if (c0 >= 1.0) { gl_FragColor = vec4(0.5, 0.5, 0.5, 1.0); return; }
      float l1 = fd(p - ivec2(1, 0)), l2 = fd(p - ivec2(2, 0)), r1 = fd(p + ivec2(1, 0)), r2 = fd(p + ivec2(2, 0));
      float b1 = fd(p - ivec2(0, 1)), b2 = fd(p - ivec2(0, 2)), t1 = fd(p + ivec2(0, 1)), t2 = fd(p + ivec2(0, 2));
      vec2 px = 1.0 / size, uv = (vec2(p) + 0.5) * px;
      vec3 ce = viewPos(uv, c0);
      vec3 dx = abs(2.0 * l1 - l2 - c0) < abs(2.0 * r1 - r2 - c0) ? ce - viewPos(uv - vec2(px.x, 0.0), l1) : viewPos(uv + vec2(px.x, 0.0), r1) - ce;
      vec3 dy = abs(2.0 * b1 - b2 - c0) < abs(2.0 * t1 - t2 - c0) ? ce - viewPos(uv - vec2(0.0, px.y), b1) : viewPos(uv + vec2(0.0, px.y), t1) - ce;
      gl_FragColor = vec4(packNormalToRGB(normalize(cross(dx, dy))), 1.0);
    }`,
});

// bloom (the 13-tap down / tent up chain of Jimenez 2014): the first step keeps only what's
// brighter than the threshold and evens out single bright pixels so they don't flicker
const DownShader = (first) => mat({
  uniforms: { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 1 }, knee: { value: 0.5 } },
  defines: first ? { FIRST: 1 } : {},
  fragmentShader: `
    uniform sampler2D tSrc; uniform vec2 texel; uniform float threshold, knee; varying vec2 vUv;
    vec3 t(float x, float y) { return texture2D(tSrc, vUv + texel * vec2(x, y)).rgb; }
    float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    void main() {
      vec3 a = t(-2.0, 2.0), b = t(0.0, 2.0), c = t(2.0, 2.0), d = t(-2.0, 0.0), e = t(0.0, 0.0), f = t(2.0, 0.0);
      vec3 g = t(-2.0, -2.0), h = t(0.0, -2.0), i = t(2.0, -2.0), j = t(-1.0, 1.0), k = t(1.0, 1.0), l = t(-1.0, -1.0), m = t(1.0, -1.0);
    #ifdef FIRST
      vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25, g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
      float w0 = 0.5 / (1.0 + lum(g0)), w1 = 0.125 / (1.0 + lum(g1)), w2 = 0.125 / (1.0 + lum(g2)), w3 = 0.125 / (1.0 + lum(g3)), w4 = 0.125 / (1.0 + lum(g4));
      vec3 col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
      col = min(col, vec3(64.0));
      float br = max(col.r, max(col.g, col.b));
      float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
      soft = soft * soft / (4.0 * knee + 1e-4);
      col *= max(soft, br - threshold) / max(br, 1e-4);
    #else
      vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    #endif
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const UpShader = () => mat({
  uniforms: { tSrc: { value: null }, texel: { value: new THREE.Vector2() } },
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
  fragmentShader: `
    uniform sampler2D tSrc; uniform vec2 texel; varying vec2 vUv;
    vec3 t(float x, float y) { return texture2D(tSrc, vUv + texel * vec2(x, y)).rgb; }
    void main() {
      vec3 s = t(-1.0, 1.0) + t(1.0, 1.0) + t(-1.0, -1.0) + t(1.0, -1.0) + 2.0 * (t(0.0, 1.0) + t(-1.0, 0.0) + t(1.0, 0.0) + t(0.0, -1.0)) + 4.0 * t(0.0, 0.0);
      gl_FragColor = vec4(s / 16.0, 1.0);
    }`,
});

// the tone-map pass: AO, bloom, exposure + tone mapping (the renderer's curve, so full
// bright's "none" carries through), then in display space a touch of contrast and saturation
// and a soft vignette. Written display-ready (sRGB) for FXAA, so it does its own tone mapping
// and encoding instead of three's (which only happen when drawing to the screen).
const FinalShader = () => mat({
  toneMapped: false,
  uniforms: {
    tScene: { value: null }, tAO: { value: null }, tBloom: { value: null },
    ao: { value: 0 }, aoLit: { value: 0 }, bloom: { value: 0 },
    contrast: { value: 1 }, saturation: { value: 1 }, vignette: { value: 0 },
    toneMappingExposure: { value: 1 }, wb: { value: new THREE.Vector3(1, 1, 1) },
  },
  fragmentShader: `
    ${THREE.ShaderChunk.tonemapping_pars_fragment}
    uniform sampler2D tScene, tAO, tBloom; uniform float ao, aoLit, bloom, contrast, saturation, vignette; uniform vec3 wb; varying vec2 vUv;
    float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    void main() {
      vec3 col = texture2D(tScene, vUv).rgb;
    #ifdef USE_AO
      // (direct sun reaches into a corner that the sky can't: brightly lit pixels take less of it)
      float k = mix(ao, aoLit, smoothstep(0.35, 1.2, lum(col)));
      col *= mix(1.0, texture2D(tAO, vUv).r, k);
      #ifdef SHOW_AO
        col = vec3(texture2D(tAO, vUv).r * 0.25);
      #endif
    #endif
    #ifdef USE_BLOOM
      col += texture2D(tBloom, vUv).rgb * bloom;
    #endif
    #ifdef TONE
      col = TONE(col * wb);
    #endif
      gl_FragColor = sRGBTransferOETF(vec4(col, 1.0));
    #ifdef GRADE
      vec3 c = gl_FragColor.rgb;
      float l = lum(c);
      c = mix(vec3(l), c, saturation);
      c = (c - 0.5) * contrast + 0.5;
      vec2 d = vUv - 0.5;
      c *= 1.0 - vignette * smoothstep(0.15, 0.75, dot(d, d) * 2.0);
      gl_FragColor.rgb = clamp(c, 0.0, 1.0);
    #endif
    }`,
});

/** AO from a depth texture (normals rebuilt from it in a pass of their own, at the AO's size). */
function makeAO(depth, q, camera) {
  const normalRT = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  const normalMat = NormalShader();
  normalMat.uniforms.tDepth.value = depth;
  const gtao = new GTAOPass(null, camera, 1, 1);
  gtao.setGBuffer(depth, normalRT.texture);
  gtao.output = GTAOPass.OUTPUT.Off;
  gtao.updateGtaoMaterial({ radius: 1.0, distanceExponent: 1.4, thickness: 1.0, scale: 1.25, samples: q.aoSamples });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
  return {
    get map() { return gtao.gtaoMap; },
    setSize(w, h) { normalRT.setSize(w, h); gtao.setSize(w, h); },
    render(renderer, cam) {
      gtao.camera = cam;
      normalMat.uniforms.projInv.value.copy(cam.projectionMatrixInverse);
      renderer.setRenderTarget(normalRT);
      quad.material = normalMat;
      quad.render(renderer);
      gtao.render(renderer, null, null);
    },
    dispose() { normalRT.dispose(); normalMat.dispose(); gtao.dispose(); },
  };
}

/** The bloom chain: n targets, each half the last, down then back up; mips[0] ends up holding the glow. */
function makeBloom(n) {
  const mips = Array.from({ length: n }, () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
  const first = DownShader(true), down = DownShader(false), up = UpShader();
  for (const m of mips) m.texture.generateMipmaps = false;
  return {
    get map() { return mips[0].texture; },
    setSize(w, h) { for (const m of mips) { m.setSize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h))); w /= 2; h /= 2; } },
    render(renderer, src) {
      // (taps half a target texel apart: right for any step down from the source)
      first.uniforms.tSrc.value = src;
      first.uniforms.texel.value.set(0.5 / mips[0].width, 0.5 / mips[0].height);
      first.uniforms.threshold.value = LOOK.threshold;
      first.uniforms.knee.value = LOOK.knee;
      renderer.setRenderTarget(mips[0]);
      quad.material = first;
      quad.render(renderer);
      quad.material = down;
      for (let i = 1; i < n; i++) {
        down.uniforms.tSrc.value = mips[i - 1].texture;
        down.uniforms.texel.value.set(1 / mips[i - 1].width, 1 / mips[i - 1].height);
        renderer.setRenderTarget(mips[i]);
        quad.render(renderer);
      }
      quad.material = up;
      for (let i = n - 1; i > 0; i--) {
        up.uniforms.tSrc.value = mips[i].texture;
        up.uniforms.texel.value.set(1 / mips[i].width, 1 / mips[i].height);
        renderer.setRenderTarget(mips[i - 1]);
        quad.render(renderer); // (adds onto what the way down left there)
      }
    },
    dispose() { for (const m of mips) m.dispose(); first.dispose(); down.dispose(); up.dispose(); },
  };
}

export function makePost(renderer, scene, camera) {
  let q = null, rt = null, ldr = null, ao = null, bloom = null, final = null, fxaa = null;
  const P = { flat: false, passes: {}, target: () => rt };
  const size = new THREE.Vector2();
  // (HDR targets need float colour buffers: every desktop and most phones; else the direct path)
  const hdr = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');

  function build() {
    for (const x of [rt, rt?.depthTexture, ldr, ao, bloom, final, fxaa]) x?.dispose();
    rt = ldr = ao = bloom = final = fxaa = null;
    if (q.direct) { P.passes = {}; return; }
    const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q.msaa, depthTexture: depth });
    if (q.ao) ao = makeAO(depth, q, camera);
    if (q.bloom) bloom = makeBloom(q.bloom);
    final = FinalShader();
    if (LOOK.debug === 1) final.defines.SHOW_AO = 1; // (?look=debug:1 shows the AO alone)
    final.uniforms.tScene.value = rt.texture;
    if (ao) final.uniforms.tAO.value = ao.map;
    if (bloom) final.uniforms.tBloom.value = bloom.map;
    if (q.fxaa && LOOK.fxaa !== 0) {
      ldr = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false }); // (display-ready 8-bit)
      fxaa = new THREE.ShaderMaterial({ ...FXAAShader, uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), depthTest: false, depthWrite: false, toneMapped: false });
      fxaa.uniforms.tDiffuse.value = ldr.texture;
    }
    P.passes = { scene: true, ao: !!ao, bloom: !!bloom, grade: !!q.grade, fxaa: !!fxaa };
    P.setSize();
  }
  P.setQuality = (name) => {
    let nq = QUALITY[name] || QUALITY.high;
    if (!hdr || LOOK.direct === 1) nq = DIRECT;
    if (nq === q) return;
    q = nq;
    build();
  };
  P.setSize = () => {
    if (!rt) return;
    renderer.getDrawingBufferSize(size);
    rt.setSize(size.x, size.y);
    ldr?.setSize(size.x, size.y);
    fxaa?.uniforms.resolution.value.set(1 / size.x, 1 / size.y);
    ao?.setSize(Math.max(1, Math.round(size.x * q.ao)), Math.max(1, Math.round(size.y * q.ao)));
    bloom?.setSize(size.x * q.bloomScale, size.y * q.bloomScale);
  };
  /** Draw the frame through `camera` (full bright: no AO or bloom, they'd only lie about it). */
  P.render = (cam) => {
    if (q.direct) { renderer.setRenderTarget(null); renderer.render(scene, cam); return; }
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    const useAO = !!ao && !P.flat, useBloom = !!bloom && !P.flat;
    // (every pass after the scene covers its whole target: no clears, and the bloom's way back up adds onto what's there)
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    if (useAO) ao.render(renderer, cam);
    if (useBloom) bloom.render(renderer, rt.texture);
    const d = final.defines, tone = TONE[renderer.toneMapping] || '';
    const want = `${useAO ? 'a' : ''}${useBloom ? 'b' : ''}${q.grade ? 'g' : ''}${tone}`;
    if (final.userData.want !== want) {
      final.userData.want = want;
      for (const [on, k] of [[useAO, 'USE_AO'], [useBloom, 'USE_BLOOM'], [q.grade, 'GRADE'], [tone, 'TONE']]) { if (on) d[k] = on === true ? 1 : on; else delete d[k]; }
      final.needsUpdate = true;
    }
    const u = final.uniforms;
    u.ao.value = LOOK.ao; u.aoLit.value = LOOK.aoLit; u.bloom.value = LOOK.bloom;
    u.contrast.value = LOOK.contrast; u.saturation.value = LOOK.saturation; u.vignette.value = LOOK.vignette;
    u.toneMappingExposure.value = renderer.toneMappingExposure;
    u.wb.value.fromArray(scene.userData.sky?.wb || ONE); // (the time of day's white balance: world/levelkit.js TIMES)
    renderer.setRenderTarget(ldr);
    quad.material = final;
    quad.render(renderer);
    if (fxaa) {
      renderer.setRenderTarget(null);
      quad.material = fxaa;
      quad.render(renderer);
    }
    renderer.autoClear = autoClear;
  };
  return P;
}
