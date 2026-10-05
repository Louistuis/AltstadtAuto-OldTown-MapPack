import * as THREE from 'three';
import { SHADOW_LAYER } from '../../engine/parts.js';

/*
  The buildings' bodies: every wall, roof, cornice, sill and pane of the whole town merged into
  one mesh per material per MCELL x MCELL m cell, in world space. A building is unique geometry
  (true window reveals, arches, mitred cornices, roofs on any convex footprint), so it can't be
  an instance of anything; merged, it still costs no draw calls of its own.

  Each cell's mesh is an InstancedMesh of ONE identity instance whose geometry carries its own
  per-vertex `instanceColor` attribute (three binds a geometry attribute of that name ahead of
  the mesh's): the shader is exactly the one the material's Batch instances already use, so the
  merged walls share their program, their material and their tinting with everything else.
  The small near-only details (frames, rails, brackets...) stay ordinary Batch instances.
*/

const COARSE = typeof location !== 'undefined' && /bldcoarse/.test(location.search);
export const MCELL = 128;
/** Casting layers are kept in SCELL cells (a third of MCELL): each one also becomes a position-only shadow mesh. */
export const SCELL = 64;

// ---------- colours ----------
const _c = new THREE.Color();
const LIN = new Map();
/** Linear [r, g, b] for an sRGB hex (as Batch instance colours are), cached. */
export function lin(hex) {
  let c = LIN.get(hex);
  if (!c) { _c.set(hex); c = [_c.r, _c.g, _c.b]; LIN.set(hex, c); }
  return c;
}
const toLin = (col) => (typeof col === 'number' ? lin(col) : col);
/** Linear colour col (hex or linear array) times k. */
export const shadeCol = (col, k) => { const c = toLin(col); return [c[0] * k, c[1] * k, c[2] * k]; };
/** Linear mix of two colours. */
export function mixCol(a, b, t) {
  const A = toLin(a), B = toLin(b);
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
}
/** A hex colour from linear (for Batch instances, which take hex or THREE.Color). */
export const colObj = (col) => (typeof col === 'number' || col.isColor ? col : new THREE.Color(col[0], col[1], col[2]));

// ---------- the building being built ----------
/**
 * Every layer reads the current building from here: its anchor (which cell its whole body
 * files under), an optional deform (age: lean and sag, applied to every vertex) and an
 * optional shade (weathering: a colour multiplier by position, for layers that take it).
 */
// (twoSided: every face is also drawn from behind - a building you walk into: the market hall)
export const CTX = { ax: 0, az: 0, deform: null, shade: null, twoSided: false };
export function beginBody(ax, az, deform = null, shade = null) {
  CTX.ax = ax; CTX.az = az; CTX.deform = deform; CTX.shade = shade;
}
export function endBody() { CTX.deform = null; CTX.shade = null; CTX.twoSided = false; }
const D = (p) => (CTX.deform ? CTX.deform([p[0], p[1], p[2]]) : p);

class Grow {
  constructor(T, n) { this.T = T; this.a = new T(n); this.n = 0; }
  need(k) {
    if (this.n + k <= this.a.length) return;
    const b = new this.T(Math.max(this.a.length * 2, this.n + k));
    b.set(this.a); this.a = b;
  }
  out() { return this.a.slice(0, this.n); }
}
class Cell {
  constructor() {
    this.P = new Grow(Float32Array, 6144); this.N = new Grow(Float32Array, 6144);
    this.U = new Grow(Float32Array, 4096); this.C = new Grow(Uint8Array, 6144);
    this.I = new Grow(Uint32Array, 6144); this.nv = 0;
  }
}

const _n = [0, 0, 0];
function newell(ps) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i], b = ps[(i + 1) % ps.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z) || 1;
  _n[0] = x / l; _n[1] = y / l; _n[2] = z / l;
  return _n;
}

/** One material's merged geometry for the whole town, cut into cells. */
export class MergeLayer {
  constructor(mat, { cast = true, receive = true, weather = false, cell = MCELL } = {}) {
    this.mat = mat; this.cast = cast; this.receive = receive; this.weather = weather;
    // (?bldcoarse: the picture meshes cast themselves, for before / after measurements)
    this.fine = cast && !COARSE;
    this.cellSize = this.fine ? SCELL : cell; this.viewSize = cell;
    this.cells = new Map();
    this.tris = 0;
  }
  cell() {
    const S = this.cellSize;
    const k = (Math.floor(CTX.ax / S) + 2048) * 4096 + Math.floor(CTX.az / S) + 2048;
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = new Cell()));
    return c;
  }
  /** Write one vertex (world position p, unit normal n) into cell c; uv is planar by the face normal (metres). */
  vert(c, p, n, col) {
    c.P.need(3); c.N.need(3); c.U.need(2); c.C.need(3);
    const P = c.P.a, i = c.P.n;
    P[i] = p[0]; P[i + 1] = p[1]; P[i + 2] = p[2]; c.P.n += 3;
    const N = c.N.a; N[i] = n[0]; N[i + 1] = n[1]; N[i + 2] = n[2]; c.N.n += 3;
    // planar uv: horizontal tangent x up (walls), or x / -z (flat-ish faces)
    let u, v;
    if (Math.abs(n[1]) > 0.95) { u = p[0]; v = -p[2]; }
    else {
      const tl = Math.hypot(n[2], n[0]) || 1, tx = n[2] / tl, tz = -n[0] / tl;
      u = p[0] * tx + p[2] * tz;
      // B = n x T
      const bx = n[1] * tz, by = n[2] * tx - n[0] * tz, bz = -n[1] * tx;
      v = p[0] * bx + p[1] * by + p[2] * bz;
    }
    const U = c.U.a, j = c.U.n; U[j] = u; U[j + 1] = v; c.U.n += 2;
    let r = col[0], g = col[1], b = col[2];
    if (this.tint) { r *= this.tint[0]; g *= this.tint[1]; b *= this.tint[2]; }
    if (this.weather && CTX.shade) { const k = CTX.shade(p[0], p[1], p[2]); r *= k; g *= k; b *= k; }
    const C = c.C.a, q = c.C.n;
    C[q] = Math.min(255, Math.max(0, Math.round(r * 255)));
    C[q + 1] = Math.min(255, Math.max(0, Math.round(g * 255)));
    C[q + 2] = Math.min(255, Math.max(0, Math.round(b * 255)));
    c.C.n += 3;
    return c.nv++;
  }
  /** This layer under another name: same cells (no draw calls of its own), colours times tint (linear, <= 1). */
  alias(tint) { const a = Object.create(this); a.tint = tint; return a; }
  tri(c, a, b, d) { c.I.need(3); const I = c.I.a, i = c.I.n; I[i] = a; I[i + 1] = b; I[i + 2] = d; c.I.n += 3; this.tris++; }
  /**
   * Convex planar polygon (world points). If `hint` (a rough outward direction) is given and the
   * winding disagrees with it, the polygon is flipped, so callers never have to think about it.
   */
  poly(pts, col, hint) {
    if (pts.length < 3) return;
    const ps = pts.map(D);
    const n = newell(ps);
    if (n[0] === 0 && n[1] === 0 && n[2] === 0) return;
    let rev = false;
    if (hint && n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { rev = true; n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
    const c = this.cell(), cl = toLin(col), nn = [n[0], n[1], n[2]];
    const ids = ps.map((p) => this.vert(c, p, nn, cl));
    for (let i = 1; i < ids.length - 1; i++) {
      if (rev) this.tri(c, ids[0], ids[i + 1], ids[i]);
      else this.tri(c, ids[0], ids[i], ids[i + 1]);
    }
    if (CTX.twoSided && !this.oneSided && this.mat.side !== THREE.DoubleSide) {
      const bn = [-nn[0], -nn[1], -nn[2]], bk = ps.map((p) => this.vert(c, p, bn, cl));
      for (let i = 1; i < bk.length - 1; i++) {
        if (rev) this.tri(c, bk[0], bk[i], bk[i + 1]);
        else this.tri(c, bk[0], bk[i + 1], bk[i]);
      }
    }
  }
  quad(p0, p1, p2, p3, col, hint) { this.poly([p0, p1, p2, p3], col, hint); }
  /** Triangles of an indexed or plain BufferGeometry, transformed by matrix m (smooth normals kept). */
  geo(g, m, col) {
    const pos = g.attributes.position, nor = g.attributes.normal, idx = g.index;
    const c = this.cell(), cl = toLin(col);
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    const base = c.nv;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      w.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      this.vert(c, D([v.x, v.y, v.z]), [w.x, w.y, w.z], cl);
    }
    if (idx) for (let i = 0; i < idx.count; i += 3) this.tri(c, base + idx.getX(i), base + idx.getX(i + 1), base + idx.getX(i + 2));
    else for (let i = 0; i < pos.count; i += 3) this.tri(c, base + i, base + i + 1, base + i + 2);
  }
  /**
   * The picture: one InstancedMesh (a single identity instance) per MCELL cell, no shadow. A
   * casting layer adds a position-only shadow mesh per SCELL cell on SHADOW_LAYER (like Batch's
   * fine casters: engine/levelkit.js shadowLayerPass lets only the shadow pass draw them). Returns them all.
   */
  build(scene) {
    const out = [];
    const groups = new Map(); // view cell -> its cells
    const r = Math.round(this.viewSize / this.cellSize);
    for (const [k, c] of this.cells) {
      if (!c.I.n) continue;
      const ix = Math.floor(k / 4096) - 2048, iz = (k % 4096) - 2048;
      const vk = (Math.floor(ix / r) + 2048) * 4096 + Math.floor(iz / r) + 2048;
      let g = groups.get(vk);
      if (!g) groups.set(vk, (g = []));
      g.push(c);
    }
    const fin = (im, cast, recv) => {
      im.castShadow = cast; im.receiveShadow = recv;
      im.computeBoundingBox(); im.computeBoundingSphere();
      im.matrixAutoUpdate = false; im.updateMatrix();
      scene.add(im);
      im.updateMatrixWorld(); im.matrixWorldAutoUpdate = false;
      out.push(im);
    };
    for (const cs of groups.values()) {
      let nv = 0, ni = 0;
      for (const c of cs) { nv += c.nv; ni += c.I.n; }
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), Cc = new Uint8Array(nv * 3);
      const I = nv < 65536 ? new Uint16Array(ni) : new Uint32Array(ni);
      let v = 0, i = 0;
      for (const c of cs) {
        P.set(c.P.a.subarray(0, c.P.n), v * 3); N.set(c.N.a.subarray(0, c.N.n), v * 3);
        U.set(c.U.a.subarray(0, c.U.n), v * 2); Cc.set(c.C.a.subarray(0, c.C.n), v * 3);
        for (let j = 0; j < c.I.n; j++) I[i + j] = c.I.a[j] + v;
        v += c.nv; i += c.I.n;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
      g.setAttribute('instanceColor', new THREE.BufferAttribute(Cc, 3, true));
      g.setIndex(new THREE.BufferAttribute(I, 1));
      g.computeBoundingBox(); g.computeBoundingSphere();
      const im = new THREE.InstancedMesh(g, this.mat, 1);
      // non-null so the program is the instance-coloured one; the geometry's own attribute wins
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3);
      fin(im, this.cast && !this.fine, this.receive);
      if (!this.fine) continue;
      for (const c of cs) {
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(c.P.out(), 3));
        const si = c.I.out();
        sg.setIndex(new THREE.BufferAttribute(c.nv < 65536 ? Uint16Array.from(si) : si, 1));
        sg.computeBoundingBox(); sg.computeBoundingSphere();
        const sm = new THREE.InstancedMesh(sg, this.mat, 1);
        sm.layers.set(SHADOW_LAYER);
        fin(sm, true, false);
      }
    }
    this.cells.clear();
    return out;
  }
}

// ---------- facade frames ----------
const _tri = new Map();
function capTris(pts) {
  const k = pts.map((p) => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(';');
  let t = _tri.get(k);
  if (!t) { t = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []); _tri.set(k, t); }
  return t;
}

/**
 * A wall plane in local (u, y, w): u runs along the wall to the right as seen from outside,
 * y is world height, w is out of the wall (u x y = w). Origin (ax, az) on the wall line at
 * u = 0; (nx, nz) the outward normal. Everything built through a Frame lands in a MergeLayer
 * (body) or, via inst(), as a Batch instance (near detail) turned to face out.
 */
export class Frame {
  constructor(ax, az, nx, nz, len = 0) {
    this.ax = ax; this.az = az; this.nx = nx; this.nz = nz; this.len = len;
    this.ux = nz; this.uz = -nx;
    this.yaw = Math.atan2(nx, nz);
  }
  P(u, y, w) { return [this.ax + this.ux * u + this.nx * w, y, this.az + this.uz * u + this.nz * w]; }
  /** World direction of a local (du, dy, dw). */
  dir(du, dy, dw) { return [this.ux * du + this.nx * dw, dy, this.uz * du + this.nz * dw]; }
  /** A frame offset by du along and dw out (same orientation). */
  shifted(du, dw, len = this.len) { const [x, , z] = this.P(du, 0, dw); return new Frame(x, z, this.nx, this.nz, len); }

  /** Vertical rectangle at depth w facing out (dir 1) or in (dir -1). */
  face(L, u0, u1, y0, y1, w, col, dir = 1) {
    if (u1 - u0 < 1e-4 || y1 - y0 < 1e-4) return;
    L.quad(this.P(u0, y0, w), this.P(u1, y0, w), this.P(u1, y1, w), this.P(u0, y1, w), col, this.dir(0, 0, dir));
  }
  /** Horizontal rectangle at height y over u0..u1 x w0..w1, facing up (dir 1) or down. */
  hface(L, u0, u1, w0, w1, y, col, dir = 1) {
    if (u1 - u0 < 1e-4 || Math.abs(w1 - w0) < 1e-4) return;
    L.quad(this.P(u0, y, w0), this.P(u1, y, w0), this.P(u1, y, w1), this.P(u0, y, w1), col, [0, dir, 0]);
  }
  /** Side rectangle at u over y0..y1 x w0..w1, facing +u (dir 1) or -u. */
  sface(L, u, y0, y1, w0, w1, col, dir = 1) {
    if (y1 - y0 < 1e-4 || Math.abs(w1 - w0) < 1e-4) return;
    L.quad(this.P(u, y0, w0), this.P(u, y0, w1), this.P(u, y1, w1), this.P(u, y1, w0), col, this.dir(dir, 0, 0));
  }
  /** Box u0..u1 x y0..y1 x w0..w1; skip: letters of faces to leave out (f b t d l r). */
  box(L, u0, u1, y0, y1, w0, w1, col, skip = 'b') {
    if (!skip.includes('f')) this.face(L, u0, u1, y0, y1, w1, col, 1);
    if (!skip.includes('b')) this.face(L, u0, u1, y0, y1, w0, col, -1);
    if (!skip.includes('t')) this.hface(L, u0, u1, w0, w1, y1, col, 1);
    if (!skip.includes('d')) this.hface(L, u0, u1, w0, w1, y0, col, -1);
    if (!skip.includes('l')) this.sface(L, u0, y0, y1, w0, w1, col, -1);
    if (!skip.includes('r')) this.sface(L, u1, y0, y1, w0, w1, col, 1);
  }
  /**
   * Wall over u0..u1 x y0..y1 at depth w with rectangular holes [{u0, u1, y0, y1}]: cut into
   * horizontal strips at every hole edge, and the pieces of one u-span merged up through the
   * strips (piers become one quad). `clip` (convex [[u, y]...], counter-clockwise) trims the
   * pieces to a gable's outline.
   */
  wall(L, u0, u1, y0, y1, holes, col, w = 0, dir = 1, clip = null) {
    const hs = holes.filter((h) => h.u1 > u0 && h.u0 < u1 && h.y1 > y0 && h.y0 < y1);
    const ys = [y0, y1];
    for (const h of hs) { if (h.y0 > y0 && h.y0 < y1) ys.push(h.y0); if (h.y1 > y0 && h.y1 < y1) ys.push(h.y1); }
    ys.sort((a, b) => a - b);
    const open = new Map(); // "u0|u1" -> [u0, u1, ya, yb]
    // pieces overlap their neighbours by a few mm: the strips meet in T-junctions, which would
    // otherwise rasterise as hairline cracks (the overlap is coplanar and the same colour)
    const e = 0.004;
    const emit = (q) => {
      const a = q[0] - (q[0] > u0 + 1e-4 ? e : 0), b = q[1] + (q[1] < u1 - 1e-4 ? e : 0);
      const c = q[2] - (q[2] > y0 + 1e-4 ? e : 0), d = q[3] + (q[3] < y1 - 1e-4 ? e : 0);
      if (clip) this.clipFace(L, a, b, c, d, w, col, dir, clip);
      else this.face(L, a, b, c, d, w, col, dir);
    };
    for (let s = 0; s < ys.length - 1; s++) {
      const ya = ys[s], yb = ys[s + 1];
      if (yb - ya < 1e-4) continue;
      const cov = hs.filter((h) => h.y0 <= ya + 1e-4 && h.y1 >= yb - 1e-4).sort((a, b) => a.u0 - b.u0);
      const spans = [];
      let u = u0;
      for (const h of cov) { if (h.u0 > u + 1e-4) spans.push([u, Math.min(h.u0, u1)]); u = Math.max(u, h.u1); }
      if (u < u1 - 1e-4) spans.push([u, u1]);
      const seen = new Set();
      for (const [a, b] of spans) {
        const k = a.toFixed(4) + '|' + b.toFixed(4);
        seen.add(k);
        const q = open.get(k);
        if (q && Math.abs(q[3] - ya) < 1e-4) q[3] = yb;
        else { if (q) emit(q); open.set(k, [a, b, ya, yb]); }
      }
      for (const [k, q] of open) if (!seen.has(k)) { emit(q); open.delete(k); }
    }
    for (const q of open.values()) emit(q);
  }
  /** A wall rectangle clipped to a convex outline in (u, y). */
  clipFace(L, u0, u1, y0, y1, w, col, dir, clip) {
    let poly = [[u0, y0], [u1, y0], [u1, y1], [u0, y1]];
    for (let i = 0; i < clip.length && poly.length; i++) {
      const a = clip[i], b = clip[(i + 1) % clip.length];
      // keep the left of a -> b (counter-clockwise outline)
      const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const out = [];
      for (let j = 0; j < poly.length; j++) {
        const p = poly[j], q = poly[(j + 1) % poly.length], sp = side(p), sq = side(q);
        if (sp >= -1e-6) out.push(p);
        if ((sp >= -1e-6) !== (sq >= -1e-6)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      }
      poly = out;
    }
    if (poly.length < 3) return;
    L.poly(poly.map(([u, y]) => this.P(u, y, w)), col, this.dir(0, 0, dir));
  }
  /** The inner faces of a rectangular hole, from wf (front) back to wb: sides of 'tblr'. */
  reveal(L, h, wf, wb, col, sides = 'tblr') {
    if (sides.includes('t')) this.hface(L, h.u0, h.u1, wb, wf, h.y1, col, -1);
    if (sides.includes('b')) this.hface(L, h.u0, h.u1, wb, wf, h.y0, col, 1);
    if (sides.includes('l')) this.sface(L, h.u0, h.y0, h.y1, wb, wf, col, 1);
    if (sides.includes('r')) this.sface(L, h.u1, h.y0, h.y1, wb, wf, col, -1);
  }
  /**
   * A profile [[w, y]...] (from the wall at the bottom, out, and back to the wall at the top)
   * swept along u0..u1. mL / mR mitre its ends (u shifts by -mL * w / +mR * w: 1 for a square
   * outside corner, 0 for a straight cut, which gets an end cap if caps says so).
   */
  profile(L, u0, u1, pts, col, mL = 0, mR = 0, caps = [true, true]) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [wa, ya] = pts[i], [wb, yb] = pts[i + 1];
      const dw = wb - wa, dy = yb - ya;
      if (Math.abs(dw) + Math.abs(dy) < 1e-5) continue;
      const hint = this.dir(0, -dw, dy);
      L.quad(this.P(u0 - mL * wa, ya, wa), this.P(u1 + mR * wa, ya, wa), this.P(u1 + mR * wb, yb, wb), this.P(u0 - mL * wb, yb, wb), col, hint);
    }
    const capAt = (u, m, s, dir) => {
      const tris = capTris(pts.map(([w, y]) => [w, y]));
      for (const [a, b, c] of tris) {
        L.poly([a, b, c].map((i) => this.P(u + s * m * pts[i][0], pts[i][1], pts[i][0])), col, this.dir(dir, 0, 0));
      }
    };
    if (caps[0] && !mL) capAt(u0, 0, -1, -1);
    if (caps[1] && !mR) capAt(u1, 0, 1, 1);
  }
  /**
   * Annular sector in the wall plane centred (cu, cy), radii r0..r1, angles a0..a1 (from +u,
   * counter-clockwise), from w0 back to w1 front: front face, outer and inner (intrados) skins.
   */
  ring(L, cu, cy, r0, r1, a0, a1, w0, w1, col, segs = 12, parts = 'foi') {
    for (let i = 0; i < segs; i++) {
      const t0 = a0 + (a1 - a0) * i / segs, t1 = a0 + (a1 - a0) * (i + 1) / segs;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      const pt = (r, c, s, w) => this.P(cu + r * c, cy + r * s, w);
      if (parts.includes('f')) L.quad(pt(r0, c0, s0, w1), pt(r1, c0, s0, w1), pt(r1, c1, s1, w1), pt(r0, c1, s1, w1), col, this.dir(0, 0, 1));
      const cm = Math.cos((t0 + t1) / 2), sm = Math.sin((t0 + t1) / 2);
      if (parts.includes('o')) L.quad(pt(r1, c0, s0, w0), pt(r1, c1, s1, w0), pt(r1, c1, s1, w1), pt(r1, c0, s0, w1), col, this.dir(cm, sm, 0));
      if (parts.includes('i') && r0 > 0.01) L.quad(pt(r0, c0, s0, w0), pt(r0, c1, s1, w0), pt(r0, c1, s1, w1), pt(r0, c0, s0, w1), col, this.dir(-cm, -sm, 0));
    }
  }
  /**
   * The curve of an arch over u0..u1 springing at ys: radius R (span / 2 = round, more =
   * pointed). Returns the points from the left springing over the crown to the right one.
   */
  static archPts(u0, u1, ys, R, n = 6, seg = false) {
    const span = u1 - u0, mid = (u0 + u1) / 2;
    if (seg) {
      // segmental: one arc centred below the springing line
      R = Math.max(R, span / 2 + 1e-3);
      const cy = ys - Math.sqrt(R * R - span * span / 4), a = Math.acos(span / 2 / R);
      const out = [];
      for (let i = 0; i <= 2 * n; i++) { const t = Math.PI - a - (Math.PI - 2 * a) * i / (2 * n); out.push([mid + R * Math.cos(t), cy + R * Math.sin(t)]); }
      return out;
    }
    R = Math.max(R, span / 2);
    const cl = u0 + R, tc = Math.acos(Math.min(1, Math.max(-1, (mid - cl) / R)));
    const left = [];
    for (let i = 0; i <= n; i++) { const t = Math.PI + (tc - Math.PI) * i / n; left.push([cl + R * Math.cos(t), ys + R * Math.sin(t)]); }
    const right = left.slice(0, -1).reverse().map(([u, y]) => [u0 + u1 - u, y]);
    return [...left, ...right];
  }
  /**
   * The arched head of an opening whose wall hole is the rectangle u0..u1 up to the crown:
   * spandrel fills at w = wf in the hole's top corners, the intrados back to wb, and the
   * back pane (the whole arched outline from y0) in layer G if given.
   */
  archHead(L, u0, u1, y0, ys, R, wf, wb, col, G, gcol, n = 6, seg = false) {
    const pts = Frame.archPts(u0, u1, ys, R, n, seg);
    const crown = Math.max(...pts.map((p) => p[1]));
    const mid = Math.floor(pts.length / 2);
    const fan = (corner, chain) => {
      for (let i = 0; i < chain.length - 1; i++) {
        L.poly([this.P(corner[0], corner[1], wf), this.P(chain[i][0], chain[i][1], wf), this.P(chain[i + 1][0], chain[i + 1][1], wf)], col, this.dir(0, 0, 1));
      }
    };
    fan([u0, crown], pts.slice(0, mid + 1));
    fan([u1, crown], pts.slice(mid));
    const cu = (u0 + u1) / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const hint = this.dir(cu - (a[0] + b[0]) / 2, ys - (a[1] + b[1]) / 2, 0);
      L.quad(this.P(a[0], a[1], wf), this.P(b[0], b[1], wf), this.P(b[0], b[1], wb), this.P(a[0], a[1], wb), col, hint);
    }
    if (G) {
      const outline = [[u0, y0], [u1, y0], ...pts.slice().reverse()];
      G.poly(outline.map(([u, y]) => this.P(u, y, wb)), gcol, this.dir(0, 0, 1));
    }
    return crown;
  }
  /** Near-detail instance: a w x h x d piece whose back sits `w` out of the wall, centre (u, y). */
  inst(b, u, y, w, sw, sh, sd, col = 0xffffff, pitch = 0, roll = 0, yawAdd = 0) {
    const p = D(this.P(u, y, w + sd / 2));
    b.add(p[0], p[1], p[2], sw, sh, sd, colObj(col), this.yaw + yawAdd, pitch, roll);
  }
}

/** Instance a piece at a world point (deformed like the body it belongs to). */
export function instAt(b, x, y, z, sx, sy, sz, col = 0xffffff, yaw = 0, pitch = 0, roll = 0) {
  const p = D([x, y, z]);
  b.add(p[0], p[1], p[2], sx, sy, sz, colObj(col), yaw, pitch, roll);
}
