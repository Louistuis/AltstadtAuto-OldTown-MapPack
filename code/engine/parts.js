import * as THREE from 'three';
import { macroMap, flatDetail, plainSet } from '../world/surfaces.js';

/*
  The building blocks every Old Town module draws with:

  1. Materials (worldMat, windowGlass, waterMat): MeshStandardMaterials whose procedural textures
     are sampled in WORLD space (or along each piece's own axes), so one unit box scaled into any
     wall, slab or beam never stretches its texture. One shader program serves every material.

  2. Instancing (Batch, ChunkSite): the town is mostly transformed copies of a few unit shapes
     (BOX, CYL, CYL_LO, SPHERE, CONE, PLANE). A Batch collects copies of one geometry + material
     and builds them into InstancedMeshes, one per CELL x CELL m tile of the ground plan (so the
     renderer can frustum-cull by area). Instance colours tint the (mostly white) materials.

       const site = new ChunkSite();
       const b = new Batch(BOX, mat, { cast, receive, lod: 0 | NEAR | FAR }, site);
       b.add(x, y, z, sx, sy, sz, color, yaw, pitch, roll);   // centre, size, hex colour, Euler YXZ
       site.anchorAt(cx, cz) ... site.anchorOff();             // a building's parts share one tile
       const meshes = b.build(parentObject3D);

  3. LOD: a batch made with lod NEAR holds small detail (window joinery, rails, brackets...); one
     with lod FAR holds its cheap stand-ins. updateLod(site.lodMeshes, camX, camZ) shows each tile's
     NEAR meshes within LOD_FAR metres of the camera and its FAR meshes beyond.
*/

// ---------- materials ----------
/*
  worldMat: a standard material whose textures are sampled in world space, picked by the
  surface normal (walls: horizontal x vertical, floors: x / z), so one unit box scales into any
  wall without stretching. With a surface set (world/surfaces.js) it is full PBR: colour (whose
  alpha says how much the instance colour tints it), relief turned into the shading normal,
  roughness and cavity. Over that the shared macro map lays grime, rain streaks, splash dirt at
  the foot of walls and puddles over tens of metres, and (tile2) a second, turned sample of the
  same tile blended in by it, so ground and render never repeat visibly.
  `local` maps the set in the object's own frame instead (metres along its scaled axes, u along
  each face's longer side): grain runs down a bench slat or a pole whichever way it is turned.
  Every worldMat compiles to one program (per flat-shading / side choice): all of that is uniforms.
*/
const WM_DEFAULTS = { bump: 1, dirt: 0.35, wet: 0, grime: 0.3, tile2: [0, 1, 0, 0], local: 0, base: 0, glass: 0, glow: 0 };
/** Seconds, for the river's moving ripples (set by the water material just before it draws). */
const wTime = { value: 0 };
/**
 * opts: MeshStandardMaterial options; scale: texture repeats per metre; set: { map, detail }
 * from surface() (or just opts.map: no relief); o: { bump, dirt, wet, grime, tile2, local, base }:
 * tile2 = [blend 0..1, scale, offset u, offset v] of the second (90 degree turned) sample, base =
 * the ground's height (walls get splash dirt just above it), glass = a special kind: 1 window
 * panes, 2 shop windows (windowGlass), 3 stained glass (glows its colour times `glow`), 4 water
 * (the set's slopes as ripples drifting two ways: waterMat).
 */
export function worldMat(opts, scale, set, o = {}) {
  o = { ...WM_DEFAULTS, ...o };
  const m = new THREE.MeshStandardMaterial(set ? { ...opts, map: set.map } : opts);
  const U = {
    uvScale: { value: scale }, detailMap: { value: set ? set.detail : flatDetail() }, macroMap: { value: macroMap() },
    surf: { value: new THREE.Vector4(o.bump, o.dirt, o.wet, o.grime) }, tile2: { value: new THREE.Vector4(...o.tile2) },
    wOpt: { value: new THREE.Vector4(o.local, o.base, o.glass, o.glow) }, wTime,
  };
  m.userData.surf = U;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP, vWN, vLP, vLN;
        flat varying vec3 vLX, vLY, vLZ, vLS, vLC;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        // object (and instance) to world, once
        mat4 toWorld_ = modelMatrix;
        #ifdef USE_INSTANCING
          toWorld_ = modelMatrix * instanceMatrix;
        #endif
        mat3 m3_ = mat3(toWorld_);
        vWP = (toWorld_ * vec4(transformed, 1.0)).xyz;
        vWN = normalize(m3_ * objectNormal);
        // the object's own frame: axes, scale, position in metres along them
        vLS = vec3(length(m3_[0]), length(m3_[1]), length(m3_[2]));
        vLX = m3_[0] / vLS.x; vLY = m3_[1] / vLS.y; vLZ = m3_[2] / vLS.z;
        vLP = transformed * vLS;
        vLN = objectNormal;
        vLC = toWorld_[3].xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP, vWN, vLP, vLN;
        // (flat: one piece's own frame, never interpolated - a hash of a smeared centre speckles)
        flat varying vec3 vLX, vLY, vLZ, vLS, vLC;
        uniform float uvScale;
        uniform vec4 wOpt;
        uniform float wTime;
        uniform sampler2D detailMap, macroMap;
        uniform vec4 surf, tile2;
        vec4 wDet_, mA_, mB_;
        vec3 wT_, wB_;
        float wTint_, wWet_;
        bool wFloor_;
        // window glass: the pane's centre, along, out (this face) and (width, height, 1 = can look in)
        vec3 gC_, gT_, gN_, gS_;
        float gHash_(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
        // the room behind the pane: what the view ray d, entering at the pane, sees in it (radiance)
        vec3 gRoom_(vec3 d, float lit) {
          vec3 N = normalize(vec3(gN_.x, 0.0, gN_.z)), U = vec3(0.0, 1.0, 0.0), T = normalize(cross(U, N));
          vec3 p = vWP - gC_;
          float px = dot(p, T), py = p.y;
          float dx = dot(d, T), dy = d.y, dz = max(-dot(d, N), 1e-3);
          // rooms along the pane: one round a window, several 4.8 m ones behind a band of glass
          float w = gS_.x, h = gS_.y;
          float cw = w > 4.0 ? 4.8 : max(w + 1.8, 3.2);
          float cell = floor((px + cw * 0.5) / cw);
          float l = cell * cw - cw * 0.5, r = l + cw;
          float rnd = gHash_(floor(gC_ * 20.0 + 0.5) * 0.37 + T * cell * 7.1);
          float rnd2 = fract(rnd * 17.31), rnd3 = fract(rnd * 61.7);
          float fl = -h * 0.5 - clamp(2.6 - h, 0.15, 0.9);
          float ce = fl + max(2.8, h * 0.5 - fl + 0.35);
          float D = 3.2 + rnd2 * 2.5;
          float tx = ((dx > 0.0 ? r : l) - px) / (abs(dx) > 1e-4 ? dx : 1e-4);
          float ty = ((dy > 0.0 ? ce : fl) - py) / (abs(dy) > 1e-4 ? dy : 1e-4);
          float tz = D / dz;
          float t = min(tz, min(tx, ty));
          vec3 hp = vec3(px + dx * t, py + dy * t, dz * t); // across, up, depth
          float depth = hp.z / D;
          // the room's colours (linear): walls off-white to pale, floor wood or carpet
          vec3 wallC = mix(vec3(0.62, 0.58, 0.5), vec3(0.45, 0.5, 0.52), rnd3) * (0.75 + 0.3 * rnd2);
          vec3 floorC = mix(vec3(0.16, 0.1, 0.06), vec3(0.12, 0.12, 0.13), step(0.5, rnd));
          vec3 c;
          float u = 0.0;
          if (t == tz) {
            c = wallC;
            // back wall: a band of furniture, a door or a picture
            float bx = hp.x - l, by = hp.y - fl;
            float f = step(by, 0.75 + 0.3 * rnd3) * step(0.25, fract(bx * 0.23 + rnd));
            c = mix(c, vec3(0.08, 0.07, 0.065) * (1.0 + rnd2), f * 0.85);
            float dr = step(abs(bx - (0.6 + rnd2 * (cw - 1.2))), 0.45) * step(by, 2.05) * step(0.6, rnd3);
            c = mix(c, vec3(0.22, 0.16, 0.11), dr);
            u = 1.0;
          } else if (t == tx) {
            c = wallC * 0.8;
            float by = hp.y - fl;
            c *= 1.0 - 0.6 * step(by, 0.8 + 0.25 * rnd) * step(0.4, fract(hp.z * 0.37 + rnd2)) ;
          } else if (dy < 0.0) {
            c = floorC;
          } else {
            c = vec3(0.7, 0.69, 0.66);
            // ceiling light panels
            vec2 q = vec2(fract((hp.x - l) / 2.4) - 0.5, fract(hp.z / 2.2) - 0.5);
            c += step(abs(q.x), 0.18) * step(abs(q.y), 0.3) * mix(0.3, 3.0, lit);
          }
          // corners go dark; daylight falls off with depth, room lights don't as much
          vec3 hn = vec3((hp.x - l) / cw, (hp.y - fl) / (ce - fl), depth);
          vec3 e = min(hn, 1.0 - hn) * vec3(cw, ce - fl, D);
          float ao = smoothstep(0.0, 0.5, min(e.x, e.y)) * 0.4 + 0.6;
          float light = mix(mix(1.0, 0.25, depth), 1.0 - 0.3 * depth, lit);
          vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.25, 0.95, 0.65), lit);
          return c * ao * light * tint * mix(0.22, 0.65, lit);
        }`)
      .replace('#include <map_fragment>', `
        {
          vec3 an_ = abs(vWN);
          vec2 wuv_;
          wFloor_ = an_.y > 0.6;
          if (wFloor_ && an_.y < 0.97) {
            // a pitched roof: v runs up the slope, u along the ridge (shingle courses stay level)
            vec2 up_ = -normalize(vWN.xz);
            wT_ = vec3(up_.y, 0.0, -up_.x); wB_ = vec3(up_.x, 0.0, up_.y);
            wuv_ = vec2(dot(vWP, wT_), dot(vWP, wB_));
          }
          else if (wFloor_) { wuv_ = vWP.xz; wT_ = vec3(1.0, 0.0, 0.0); wB_ = vec3(0.0, 0.0, 1.0); }
          else if (an_.x > an_.z) { wuv_ = vWP.zy; wT_ = vec3(0.0, 0.0, 1.0); wB_ = vec3(0.0, 1.0, 0.0); }
          else { wuv_ = vWP.xy; wT_ = vec3(1.0, 0.0, 0.0); wB_ = vec3(0.0, 1.0, 0.0); }
          vec2 tuv_ = wuv_ * uvScale;
          if (wOpt.x > 0.5) {
            // the object's frame: project along its own face normal, u along the face's longer side
            vec3 ln_ = abs(vLN);
            vec2 luv_;
            if (ln_.y >= ln_.x && ln_.y >= ln_.z) {
              if (vLS.x >= vLS.z) { luv_ = vLP.xz; wT_ = vLX; wB_ = vLZ; } else { luv_ = vLP.zx; wT_ = vLZ; wB_ = vLX; }
            } else if (ln_.x >= ln_.z) {
              if (vLS.z >= vLS.y) { luv_ = vLP.zy; wT_ = vLZ; wB_ = vLY; } else { luv_ = vLP.yz; wT_ = vLY; wB_ = vLZ; }
            } else {
              if (vLS.x >= vLS.y) { luv_ = vLP.xy; wT_ = vLX; wB_ = vLY; } else { luv_ = vLP.yx; wT_ = vLY; wB_ = vLX; }
            }
            tuv_ = luv_ * uvScale;
          }
          mA_ = texture2D(macroMap, wuv_ * 0.041 + vec2(0.37, 0.11));
          mB_ = texture2D(macroMap, wuv_ * 0.0113 + vec2(0.71, 0.53));
          vec4 tex_ = texture2D(map, tuv_);
          wDet_ = texture2D(detailMap, tuv_);
          wDet_.rg = wDet_.rg * 2.0 - 1.0;
          if (tile2.x > 0.0) {
            // the same tile again, turned 90 degrees, scaled and shifted, blended in by patches
            vec2 uv2_ = vec2(-tuv_.y, tuv_.x) * tile2.y + tile2.zw;
            vec4 tex2_ = texture2D(map, uv2_);
            vec4 det2_ = texture2D(detailMap, uv2_);
            vec2 s2_ = (det2_.rg * 2.0 - 1.0) * tile2.y;
            float b_ = smoothstep(0.42, 0.58, mA_.a * 0.55 + mB_.a * 0.45) * tile2.x;
            tex_ = mix(tex_, tex2_, b_);
            wDet_ = mix(wDet_, vec4(s2_.y, -s2_.x, det2_.ba), b_);
          }
          if (wOpt.z > 3.5) {
            // water: two drifts of the ripple tile, crossing, summed
            vec2 a_ = (texture2D(detailMap, tuv_ * 0.83 + vec2(0.021, 0.013) * wTime).rg * 2.0 - 1.0) * 0.83;
            vec2 b2_ = texture2D(detailMap, vec2(-tuv_.y, tuv_.x) * 1.31 + vec2(-0.017, 0.024) * wTime).rg * 2.0 - 1.0;
            wDet_ = vec4(a_ + vec2(b2_.y, -b2_.x) * 1.31, 1.0, 1.0);
          }
          diffuseColor.rgb *= tex_.rgb;
          wTint_ = tex_.a;
        }`)
      .replace('#include <color_fragment>', `
        #if defined( USE_COLOR )
          diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb, wTint_);
        #endif
        {
          // grime: big soft patches everywhere; on walls also rain streaks and splash dirt low down
          float d_ = smoothstep(0.35, 0.8, mA_.r * 0.55 + mB_.r * 0.45);
          float g_ = 0.0;
          if (!wFloor_) {
            float st_ = texture2D(macroMap, vec2((abs(vWN.x) > abs(vWN.z) ? vWP.z : vWP.x) * 0.16, vWP.y * 0.02)).g;
            g_ = smoothstep(0.56, 0.82, st_) * 0.55 + (1.0 - smoothstep(0.1, 1.5, vWP.y - wOpt.y)) * 0.75;
          }
          float k_ = clamp(d_ * surf.y + g_ * surf.w, 0.0, 1.0);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.6, 0.56, 0.5), k_);
          // puddles: darker, mirror smooth, flat
          wWet_ = wFloor_ ? smoothstep(0.69, 0.76, mB_.b * 0.7 + mA_.b * 0.3) * surf.z : 0.0;
          diffuseColor.rgb *= 1.0 - 0.4 * wWet_;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor * wDet_.b, 0.06, wWet_);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 s_ = wDet_.rg * surf.x * (1.0 - wWet_);
          normal = normalize(normal - mat3(viewMatrix) * (s_.x * wT_ + s_.y * wB_));
        }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= wDet_.a;
        reflectedLight.indirectSpecular *= wDet_.a;
        reflectedLight.directDiffuse *= mix(1.0, wDet_.a, 0.5);
        // glass: a stronger mirror of the sky and the street (old crown glass, display glass)
        // (the environment is only sky: a ray mirrored down or level would meet the street and
        // the facades opposite, so it gets little of it; one mirrored upward gets more sky)
        if (wOpt.z > 0.5 && wOpt.z < 2.5) {
          vec3 rW_ = reflect(normalize(vWP - cameraPosition), normalize(vWN));
          reflectedLight.indirectSpecular *= mix(0.12, wOpt.z > 1.5 ? 1.6 : 1.8, smoothstep(0.05, 0.35, rW_.y));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 gTint_ = vec3(1.0);
        float gLit_ = 0.0;
        // stained glass: its own colours, glowing
        if (wOpt.z > 2.5 && wOpt.z < 3.5) totalEmissiveRadiance += diffuseColor.rgb * wOpt.w;
        if (wOpt.z > 0.5 && wOpt.z < 2.5) {
          #if defined( USE_COLOR )
            gLit_ = smoothstep(0.05, 0.2, vColor.r - vColor.b);
            gTint_ = mix(vColor.rgb / max(max(vColor.r, vColor.g), max(vColor.b, 1e-3)), vec3(1.0), gLit_);
          #endif
          bool thinX_ = vLS.x < vLS.z;
          float side_ = thinX_ ? vLN.x : vLN.z; // +-1 on the pane's faces, 0 on its edges
          gC_ = vLC;
          gN_ = (thinX_ ? vLX : vLZ) * sign(side_);
          gT_ = thinX_ ? vLZ : vLX;
          gS_ = vec3(thinX_ ? vLS.z : vLS.x, vLS.y, step(0.5, abs(side_)) * step(min(vLS.x, vLS.z), vLS.y * 0.5));
          vec3 d_ = normalize(vWP - cameraPosition);
          float on_ = gS_.z * step(abs(gN_.y), 0.3) * step(0.5, gS_.x) * step(0.8, gS_.y) * step(0.0, -dot(d_, gN_));
          // (shop windows: lit, the display set further back)
          bool shop_ = wOpt.z > 1.5;
          vec3 room_ = on_ > 0.5 ? gRoom_(d_, shop_ ? max(gLit_, 0.6) : gLit_) : vec3(0.0);
          // a third of the windows have a blind part way down (on the glass: lit by the day)
          float bh_ = gHash_(floor(gC_ * 20.0 + 0.5) * 0.71 + 3.1);
          float py_ = (vWP.y - gC_.y) / max(gS_.y, 0.1) + 0.5;
          float blind_ = shop_ ? 0.0 : on_ * step(bh_, 0.33) * step(1.0 - bh_ * 2.4, py_) * step(gS_.x, 4.0);
          room_ = mix(room_, vec3(0.42, 0.39, 0.34) * (0.85 + 0.15 * step(0.5, fract(py_ * gS_.y * 25.0))) * mix(0.5, 1.2, gLit_), blind_);
          if (shop_ && on_ > 0.5) {
            // a shop's display: goods on a low stand and a shelf 0.7 m behind the glass (parallax),
            // the shop itself dim and warm behind them - glass with a lit room, not a lightbox
            float dz2_ = max(-dot(d_, gN_), 0.05);
            vec3 pp_ = vWP - gC_;
            float al_ = dot(pp_, gT_) + dot(d_, gT_) * 0.7 / dz2_;
            float up_ = pp_.y + d_.y * 0.7 / dz2_ + gS_.y * 0.5;
            float cl_ = floor(al_ * 4.5);
            float hh_ = gHash_(vec3(cl_, gC_.x * 3.1, gC_.z * 1.7));
            float sh_ = step(1.15, up_) * step(up_, 1.18 + 0.3 * hh_);
            float goods_ = max(step(up_, 0.12 + 0.4 * hh_) * step(0.0, up_), sh_) * step(0.18, fract(al_ * 4.5)) * step(0.2, hh_);
            vec3 gcol_ = mix(vec3(0.5, 0.36, 0.24), 0.5 + 0.5 * cos(6.2832 * (hh_ * 3.7 + vec3(0.0, 0.33, 0.67))), 0.7);
            float shelf_ = step(1.1, up_) * step(up_, 1.15);
            room_ = room_ * 0.3 * vec3(1.0, 0.86, 0.68);
            room_ = mix(room_, gcol_ * 0.2, goods_);
            room_ = mix(room_, vec3(0.03, 0.025, 0.02), shelf_);
            // the street and the sky in the glass (reflected ray: dark facades below the horizon)
            vec3 rf_ = reflect(d_, gN_);
            vec3 sky_ = mix(vec3(0.03, 0.028, 0.026), mix(vec3(0.42, 0.36, 0.3), vec3(0.22, 0.28, 0.38), clamp(rf_.y * 2.0, 0.0, 1.0)), smoothstep(0.08, 0.3, rf_.y));
            totalEmissiveRadiance += sky_ * (0.18 + 0.82 * pow(1.0 - clamp(abs(dot(d_, gN_)), 0.0, 1.0), 5.0)) * 0.4;
          }
          float cos_ = clamp(abs(dot(d_, gN_)), 0.0, 1.0);
          float fr_ = 0.1 + 0.9 * pow(1.0 - cos_, 5.0);
          totalEmissiveRadiance += (room_ + 0.012 * gTint_) * (1.0 - fr_);
        }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        if (wOpt.z > 0.5 && wOpt.z < 2.5) {
          // glass: no diffuse at all, a little tinted reflection (two panes' worth of Fresnel)
          material.diffuseColor = vec3(0.0);
          material.specularColor = 0.1 * mix(vec3(1.0), gTint_, 0.6);
        }`);
  };
  // everything above is a uniform: every worldMat shares one program (onBeforeCompile still
  // runs per material, so each keeps its own)
  m.customProgramCacheKey = () => 'worldmat';
  return m;
}

/*
  windowGlass: a worldMat (same program) whose panes look into rooms. Each pane's thin axis is
  its normal; a fragment on a big face casts the view ray on into a box room behind it (interior
  mapping: no geometry, no textures) - side walls, floor, ceiling lights, back wall, a furniture
  band, a door, a blind on some - shaded darker the deeper it goes, and gives that out as emitted
  light, weighed against the Fresnel reflection of the sky the glass itself shows. Wide panes
  (office bands) are split into several rooms. Panes that are small, lie flat or are seen edge on
  are plain dark glass. An instance colour warmer than it is blue means the lights are on.
*/
export function windowGlass(opts = {}, shop = false) {
  return worldMat({ roughness: 0.04, metalness: 0, ...opts }, 1, plainSet(), { bump: 0, dirt: 0, grime: 0, glass: shop ? 2 : 1 });
}
/**
 * Moving water: a worldMat drawing the ripple set as two crossing drifts (opts: colour, roughness,
 * envMap...; scale: ripple tiles per metre). It keeps the shared clock: just before it draws it
 * sets the time every worldMat program reads.
 */
export function waterMat(opts, scale, set, o = {}) {
  const m = worldMat({ roughness: 0.05, metalness: 0, ...opts }, scale, set, { dirt: 0, grime: 0, ...o, glass: 4 });
  m.onBeforeRender = () => { wTime.value = performance.now() / 1000; };
  return m;
}

// ---------- unit shapes ----------
export const BOX = new THREE.BoxGeometry(1, 1, 1);
export const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
export const CYL_LO = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
export const SPHERE = new THREE.IcosahedronGeometry(0.5, 1);
export const CONE = new THREE.ConeGeometry(0.5, 1, 12);
/** A 1 x 1 floor tile (facing up). */
export const PLANE = new THREE.PlaneGeometry(1, 1);
PLANE.rotateX(-Math.PI / 2);

// ---------- LOD ----------
export const NEAR = 1, FAR = 2;
/** Metres from the camera to a tile at which NEAR detail hands over to FAR stand-ins. */
export const LOD_FAR = 60;
/** Ground-plan tile size in metres (instances are grouped into one InstancedMesh per tile). */
export const CELL = 64;
/** Layer for shadow-only meshes (the merged building bodies add some): enable it on the shadow pass only. */
export const SHADOW_LAYER = 1;

/** Shared build state: the current anchor (a building's parts all file under its tile) and every LOD mesh built. */
export class ChunkSite {
  constructor() {
    this.anchor = null;
    this.lodMeshes = [];
  }
  anchorAt(x, z) { this.anchor = [x, z]; }
  anchorOff() { this.anchor = null; }
  /** Run fn with the anchor at (x, z), unless an outer anchor is already set. */
  anchored(x, z, fn) {
    if (this.anchor) return fn();
    this.anchorAt(x, z);
    try { return fn(); } finally { this.anchorOff(); }
  }
}

/**
 * Show or hide LOD meshes for a camera at (x, z). Each mesh carries userData.lod =
 * { kind: NEAR | FAR, x0, z0, size } (its tile); the tile's distance decides.
 */
export function updateLod(meshes, x, z, far = LOD_FAR) {
  for (const m of meshes) {
    const L = m.userData.lod;
    const dx = Math.max(L.x0 - x, 0, x - (L.x0 + L.size));
    const dz = Math.max(L.z0 - z, 0, z - (L.z0 + L.size));
    const near = Math.hypot(dx, dz) < far;
    m.visible = L.kind === NEAR ? near : !near;
  }
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _col = new THREE.Color();

/** Copies of one geometry + material, built into one InstancedMesh per ground tile. */
export class Batch {
  constructor(geo, mat, { cast = true, receive = true, lod = 0, fade = false } = {}, site = new ChunkSite()) {
    this.geo = geo;
    this.mat = mat;
    this.cast = cast;
    this.receive = receive;
    this.lod = lod;
    this.fade = fade;
    this.site = site;
    this.count = 0;
    this.mats = new Float32Array(16 * 64);
    this.cols = new Float32Array(3 * 64);
    this.keys = new Float32Array(2 * 64);
  }
  _grow() {
    const grow = (a, k) => { const b = new Float32Array(a.length * 2); b.set(a); return b; };
    this.mats = grow(this.mats);
    this.cols = grow(this.cols);
    this.keys = grow(this.keys);
  }
  /**
   * One copy: centre (x, y, z), size (sx, sy, sz), colour (hex or THREE.Color), then yaw about Y,
   * pitch about the local X and roll about the local Z (Euler order YXZ).
   */
  add(x, y, z, sx, sy, sz, color = 0xffffff, yaw = 0, pitch = 0, roll = 0) {
    if (this.count * 16 >= this.mats.length) this._grow();
    _e.set(pitch, yaw, roll, 'YXZ');
    _q.setFromEuler(_e);
    _m4.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    _m4.toArray(this.mats, this.count * 16);
    _col.set(color);
    this.cols[this.count * 3] = _col.r; this.cols[this.count * 3 + 1] = _col.g; this.cols[this.count * 3 + 2] = _col.b;
    const a = this.site.anchor;
    this.keys[this.count * 2] = a ? a[0] : x;
    this.keys[this.count * 2 + 1] = a ? a[1] : z;
    this.count++;
    return this;
  }
  /** Build the InstancedMeshes into `parent` (any Object3D); returns them. */
  build(parent) {
    const tiles = new Map();
    for (let i = 0; i < this.count; i++) {
      const tx = Math.floor(this.keys[i * 2] / CELL), tz = Math.floor(this.keys[i * 2 + 1] / CELL);
      const key = tx + ':' + tz;
      let t = tiles.get(key);
      if (!t) tiles.set(key, (t = { tx, tz, idx: [] }));
      t.idx.push(i);
    }
    const out = [];
    for (const t of tiles.values()) {
      const n = t.idx.length;
      const im = new THREE.InstancedMesh(this.geo, this.mat, n);
      const colors = new Float32Array(n * 3);
      t.idx.forEach((src, j) => {
        im.instanceMatrix.array.set(this.mats.subarray(src * 16, src * 16 + 16), j * 16);
        colors.set(this.cols.subarray(src * 3, src * 3 + 3), j * 3);
      });
      im.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = this.cast;
      im.receiveShadow = this.receive;
      im.computeBoundingBox();
      im.computeBoundingSphere();
      im.matrixAutoUpdate = false;
      if (this.lod) {
        im.userData.lod = { kind: this.lod, x0: t.tx * CELL, z0: t.tz * CELL, size: CELL };
        im.visible = this.lod === FAR;
        this.site.lodMeshes.push(im);
      }
      parent.add(im);
      im.updateMatrixWorld();
      out.push(im);
    }
    this.count = 0;
    this.mats = this.cols = this.keys = null;
    return out;
  }
}
