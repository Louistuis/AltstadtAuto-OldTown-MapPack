import * as THREE from 'three';
import { NEAR, FAR } from '../engine/parts.js';

/*
  Bake the built Old Town into plain meshes any engine can load (for GLTFExporter -> .glb).

  The live town draws with instancing and custom world-space shaders that only three.js runs. The
  bake turns it into ordinary geometry: every instance and every merged building cell becomes
  triangles in world space, one mesh per material per 64 m tile, coloured per vertex with what the
  shader would show from a distance (the material's colour x its procedural texture's average x the
  instance tint). No textures, no custom shaders: it loads the same in Unity, Unreal, Godot,
  Babylon or Blender. Emissive lamps stay emissive.

    const glbGroup = bakeForExport(map, { detail: 'medium' });
    new GLTFExporter().parse(glbGroup, (buf) => save(buf), console.error, { binary: true });

  detail: 'medium' = the FAR stand-ins instead of the small NEAR detail (window joinery, rails,
  brackets, signs: about half the triangles); 'high' = the NEAR detail instead of the stand-ins.
*/

const TILE = 64;
/** A growable typed array (JS number arrays would need gigabytes for the whole town). */
class Grow {
  constructor(T) { this.T = T; this.a = new T(4096); this.length = 0; }
  push(...v) {
    if (this.length + v.length > this.a.length) { const b = new this.T(this.a.length * 2); b.set(this.a); this.a = b; }
    for (let i = 0; i < v.length; i++) this.a[this.length++] = v[i];
  }
  out() { return this.a.slice(0, this.length); }
}
const _m = new THREE.Matrix4(), _n = new THREE.Matrix3(), _v = new THREE.Vector3(), _c = new THREE.Color();

/** Average linear colour and tint share of a material's colour texture (sRGB bytes). */
function texAverage(tex) {
  const d = tex?.image?.data;
  if (!d || !d.length) return { rgb: [1, 1, 1], tint: 1 };
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  const step = Math.max(4, Math.floor(d.length / 4 / 4096) * 4);
  for (let i = 0; i < d.length; i += step) {
    _c.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace); // (to linear)
    r += _c.r; g += _c.g; b += _c.b;
    a += d[i + 3] / 255; n++;
  }
  return { rgb: [r / n, g / n, b / n], tint: a / n };
}

function exportMaterialFor(mat, cache) {
  const glass = mat.userData?.surf?.wOpt?.value?.z ?? 0; // worldMat kind: 1, 2 glass, 3 stained, 4 water
  const emissive = mat.emissive && mat.emissiveIntensity > 0 && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0;
  const key = [mat.name || mat.type, Math.round((mat.roughness ?? 1) * 20), Math.round((mat.metalness ?? 0) * 20), glass, emissive ? mat.emissive.getHexString() : '', mat.transparent ? mat.opacity : ''].join('|');
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      name: (mat.name || mat.userData?.batch || 'oldtown') + (glass ? '-glass' : ''),
      vertexColors: true,
      roughness: glass === 1 || glass === 2 || glass === 4 ? 0.08 : Math.min(1, mat.roughness ?? 1),
      metalness: mat.metalness ?? 0,
      side: mat.side,
      transparent: !!mat.transparent, opacity: mat.opacity ?? 1,
    });
    if (emissive) { m.emissive.copy(mat.emissive); m.emissiveIntensity = Math.min(mat.emissiveIntensity, 4); }
    if (glass === 3) { m.emissive.set(0x6a4a9a); m.emissiveIntensity = 0.4; }
    cache.set(key, m);
  }
  return m;
}

/** The colour the bake gives one instance or vertex (linear rgb), for material mat. */
function shade(mat, avg, inst) {
  const base = mat.color || _c.set(0xffffff);
  const glass = mat.userData?.surf?.wOpt?.value?.z ?? 0;
  if (glass === 1 || glass === 2) return [0.05, 0.06, 0.07];      // window glass: dark, reflective
  const t = avg.tint;
  return [
    base.r * avg.rgb[0] * (1 - t + t * inst[0]),
    base.g * avg.rgb[1] * (1 - t + t * inst[1]),
    base.b * avg.rgb[2] * (1 - t + t * inst[2]),
  ];
}

export function bakeForExport(map, { detail = 'medium', jail = true } = {}) {
  const skip = detail === 'high' ? FAR : NEAR;
  const out = new THREE.Group();
  out.name = 'AltstadtAuto_OldTown';
  out.userData = { credit: 'Old Town map by Louis Nordbø, from AltstadtAuto (https://wta.lou15.com). MIT License.', units: 'metres', up: '+y' };
  const mats = new Map(), avgs = new Map(), buckets = new Map();
  const bucket = (mat, x, z) => {
    const em = exportMaterialFor(mat, mats);
    const key = em.uuid + '|' + Math.floor(x / TILE) + ':' + Math.floor(z / TILE);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat: em, pos: new Grow(Float32Array), nor: new Grow(Float32Array), col: new Grow(Uint8Array), idx: new Grow(Uint32Array), tx: Math.floor(x / TILE), tz: Math.floor(z / TILE) }));
    return b;
  };
  const avgOf = (mat) => { let a = avgs.get(mat); if (!a) avgs.set(mat, (a = texAverage(mat.map))); return a; };

  const addGeometry = (geo, world, mat, inst, perVertexColor) => {
    const pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index;
    if (!pos) return;
    _v.fromBufferAttribute(pos, 0).applyMatrix4(world);
    const b = bucket(mat, _v.x, _v.z);
    const base = b.pos.length / 3;
    _n.getNormalMatrix(world);
    const avg = avgOf(mat);
    const flat = !nor;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(world);
      b.pos.push(_v.x, _v.y, _v.z);
      if (!flat) { _v.fromBufferAttribute(nor, i).applyMatrix3(_n).normalize(); b.nor.push(_v.x, _v.y, _v.z); }
      const ic = perVertexColor ? [perVertexColor.getX(i), perVertexColor.getY(i), perVertexColor.getZ(i)] : inst;
      const sc = shade(mat, avg, ic);
      b.col.push(Math.min(255, Math.round(sc[0] * 255)), Math.min(255, Math.round(sc[1] * 255)), Math.min(255, Math.round(sc[2] * 255)));
    }
    if (idx) for (let i = 0; i < idx.count; i++) b.idx.push(base + idx.getX(i));
    else for (let i = 0; i < pos.count; i++) b.idx.push(base + i);
    if (flat) b.flat = true;
  };

  map.group.updateMatrixWorld(true);
  map.group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.layers.mask === 2) return;                       // shadow-only copies (SHADOW_LAYER)
    const lod = o.userData.lod?.kind;
    if (lod === skip) return;
    if (!jail && o.userData.jail) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (mat === map.poolMaterial || mat.blending === THREE.AdditiveBlending) return; // light pools are a screen effect
    if (o.isInstancedMesh) {
      const merged = o.geometry.attributes.instanceColor; // a merged building cell: per-vertex colours
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, _m);
        const world = _m.premultiply(o.matrixWorld);
        const inst = o.instanceColor ? [o.instanceColor.getX(i), o.instanceColor.getY(i), o.instanceColor.getZ(i)] : [1, 1, 1];
        addGeometry(o.geometry, world.clone(), mat, inst, merged || null);
      }
    } else {
      addGeometry(o.geometry, o.matrixWorld, mat, [1, 1, 1], null);
    }
  });

  for (const b of buckets.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.pos.out(), 3));
    if (!b.flat && b.nor.length === b.pos.length) g.setAttribute('normal', new THREE.BufferAttribute(b.nor.out(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(b.col.out(), 3, true)); // (normalized bytes, linear)
    const nv = b.pos.length / 3, idx = b.idx.out();
    g.setIndex(new THREE.BufferAttribute(nv < 65536 ? Uint16Array.from(idx) : idx, 1));
    if (!g.attributes.normal) g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, b.mat);
    mesh.name = `${b.mat.name}_${b.tx}_${b.tz}`;
    out.add(mesh);
  }
  return out;
}
