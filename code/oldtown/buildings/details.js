import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLOW } from '../../world/glow.js';

/*
  Shared geometries for the near-only facade details (each one instanced thousands of times
  through a Batch, so each is built once), and the shop-sign atlas.
  Every piece is modelled at a reference size and then normalised to a unit box centred on
  the origin, so Batch.add's size arguments are its real size in metres; at sizes near the
  reference its bars and mouldings keep their true thickness.
*/

// box faces in BoxGeometry's order (+x -x +y -y +z -z); `skip` drops hidden ones, e.g. 'yYz'
const FACES = 'XxYyZz';
const bx = (w, h, d, x = 0, y = 0, z = 0, rx = 0, skip = '') => {
  let g = new THREE.BoxGeometry(w, h, d);
  if (skip) {
    const n = g.toNonIndexed(), keep = [];
    for (let f = 0; f < 6; f++) if (!skip.includes(FACES[f])) for (let v = 0; v < 6; v++) keep.push(f * 6 + v);
    g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) {
      const a = n.attributes[k], o = new Float32Array(keep.length * a.itemSize);
      keep.forEach((v, i) => { for (let c = 0; c < a.itemSize; c++) o[i * a.itemSize + c] = a.array[v * a.itemSize + c]; });
      g.setAttribute(k, new THREE.BufferAttribute(o, a.itemSize));
    }
  }
  if (rx) g.rotateX(rx);
  return g.translate(x, y, z);
};
/** Merge parts (non-indexed), then scale a reference w x h x d down to the unit box. */
function unit(parts, w, h, d) {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  g.scale(1 / w, 1 / h, 1 / d);
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/** Casement window joinery at 1.2 x 2.0 x 0.06: outer frame, centre mullion, transom; bars = glazing bars per leaf. */
function windowFrame(bars) {
  const W = 1.2, H = 2.0, D = 0.06, f = 0.065, m = 0.05;
  // (no back faces: they face the glass; no ends where a bar meets the frame)
  const V = 'yYz', Hz = 'xXz';
  const p = [
    bx(f, H - 2 * f, D, -W / 2 + f / 2, 0, 0, 0, V), bx(f, H - 2 * f, D, W / 2 - f / 2, 0, 0, 0, V),
    bx(W, f, D, 0, H / 2 - f / 2, 0, 0, 'z'), bx(W, f, D, 0, -H / 2 + f / 2, 0, 0, 'z'),
    bx(m, H - 2 * f, D * 0.9, 0, 0, 0, 0, V), bx(W - 2 * f, m, D * 0.9, 0, H * 0.22, 0, 0, Hz),
  ];
  for (let i = 1; i <= bars; i++) {
    const y = -H / 2 + (H * 0.72) * i / (bars + 1);
    p.push(bx(W - 2 * f, 0.03, D * 0.6, 0, y, 0, 0, Hz));
  }
  if (bars) p.push(bx(0.03, H * 0.28, D * 0.6, -W / 4, H * 0.36, 0, 0, V), bx(0.03, H * 0.28, D * 0.6, W / 4, H * 0.36, 0, 0, V));
  return unit(p, W, H, D);
}

/** A louvred shutter leaf at 0.6 x 1.9 x 0.05: stiles, three rails, tilted slats between. */
function louvre() {
  const W = 0.6, H = 1.9, D = 0.05, s = 0.06;
  const p = [bx(s, H, D, -W / 2 + s / 2), bx(s, H, D, W / 2 - s / 2), bx(W, 0.08, D, 0, H / 2 - 0.04), bx(W, 0.08, D, 0, -H / 2 + 0.04), bx(W, 0.07, D, 0, 0)];
  const iw = W - 2 * s;
  for (const [a, b] of [[-H / 2 + 0.08, -0.035], [0.035, H / 2 - 0.08]]) {
    const n = Math.round((b - a) / 0.085);
    for (let i = 0; i < n; i++) {
      const y = a + (i + 0.5) * (b - a) / n;
      p.push(new THREE.PlaneGeometry(iw, 0.095).rotateX(-0.55).translate(0, y, 0));
    }
  }
  return unit(p, W, H, D);
}

/** A wrought-iron railing module at 1.0 x 0.95 x 0.05: handrail, bottom rail, bars; fancy adds rings and a scroll band. */
function railing(fancy) {
  const W = 1.0, H = 0.95, D = 0.05;
  // (modules sit end to end: rails have no ends, bars none where they meet the rails)
  const p = [bx(W, 0.045, D, 0, H / 2 - 0.0225, 0, 0, 'xX'), bx(W, 0.03, 0.03, 0, -H / 2 + 0.06, 0, 0, 'xX'), bx(W, 0.02, 0.02, 0, H / 2 - 0.16, 0, 0, 'xX')];
  const n = 8;
  for (let i = 0; i < n; i++) p.push(bx(0.016, H - 0.06, 0.016, -W / 2 + (i + 0.5) * W / n, -0.02, 0, 0, 'yY'));
  if (fancy) {
    for (let i = 0; i < n; i += 2) {
      const t = new THREE.TorusGeometry(0.045, 0.008, 3, 7);
      p.push(t.translate(-W / 2 + (i + 1) * W / n, H / 2 - 0.1, 0));
    }
    for (let i = 0; i < 2; i++) {
      const t = new THREE.TorusGeometry(0.12, 0.009, 3, 9, Math.PI * 1.4);
      t.rotateZ(i ? -0.2 : Math.PI + 0.2);
      p.push(t.translate(i ? 0.18 : -0.18, -0.12, 0));
    }
  }
  return unit(p, W, H, D);
}

/** A scrolled console (bracket): the side profile, 1 deep (out of the wall) x 1 high, swept 1 wide. */
function consoleGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, 1); s.lineTo(1, 1); s.lineTo(1, 0.86);
  s.bezierCurveTo(0.92, 0.82, 0.55, 0.78, 0.4, 0.5);
  s.bezierCurveTo(0.3, 0.3, 0.32, 0.12, 0.2, 0.05);
  s.bezierCurveTo(0.12, 0.0, 0.04, 0.02, 0, 0);
  s.lineTo(0, 1);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 3 });
  g.rotateY(-Math.PI / 2); // shape x -> out of the wall (+z), extrusion -> along the wall
  g.translate(0.5, -0.5, -0.5);
  g.computeVertexNormals();
  return g;
}

/** A turned stone baluster (unit height, about half as wide). */
function balusterGeo() {
  const prof = [[0, 0], [0.5, 0], [0.5, 0.08], [0.32, 0.12], [0.3, 0.2], [0.46, 0.38], [0.42, 0.5], [0.22, 0.66], [0.18, 0.78], [0.3, 0.84], [0.44, 0.9], [0.44, 1], [0, 1]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 6);
  g.translate(0, -0.5, 0);
  return g;
}

let G = null;
/** The shared detail geometries (built once per page). */
export function detailGeos() {
  if (G) return G;
  G = {
    win: windowFrame(0), win6: windowFrame(2), louvre: louvre(),
    rail: railing(false), railFancy: railing(true),
    console: consoleGeo(), baluster: balusterGeo(),
    plane: new THREE.PlaneGeometry(1, 1),
    pot: new THREE.CylinderGeometry(0.5, 0.42, 1, 7),
    ball: new THREE.IcosahedronGeometry(0.5, 1),
    cone: new THREE.ConeGeometry(0.5, 1, 8),
    col: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
  };
  return G;
}

// ---------- shop signs ----------
/** How each kind of shop letters its fascia: [font, background, ink]. */
export const SIGN_STYLE = {
  shop: ['700 {s}px Georgia, "Times New Roman", serif', null, '#e8cf8a'],
  cafe: ['italic 700 {s}px Georgia, "Times New Roman", serif', null, '#f3e6c8'],
  restaurant: ['700 {s}px Georgia, "Times New Roman", serif', null, '#f0d79a'],
  bakery: ['italic 700 {s}px Georgia, "Times New Roman", serif', null, '#5a2e14'],
  pharmacy: ['700 {s}px "Helvetica Neue", Arial, sans-serif', null, '#ffffff'],
  bank: ['600 {s}px Georgia, "Times New Roman", serif', '#cfc6b4', '#3b352c'],
  gallery: ['300 {s}px "Helvetica Neue", Arial, sans-serif', '#f4f2ee', '#1a1a1a'],
};
const CW = 512, CH = 80, SH = 64; // cell, and the sign inside it (8 px of its own background above and below)
/**
 * One texture holding every sign: 4 cells per row, a cell per distinct (text, look). The
 * material picks the cell from the instance colour (red = index low byte, green = high byte)
 * and draws untinted. signs: [{ text, bg, style }] -> { mat, cell(text, bg, style) -> Color }.
 */
export function signAtlas(signs, aniso = 4) {
  const keys = new Map();
  for (const s of signs) {
    const k = s.style + '|' + s.bg + '|' + s.text;
    if (!keys.has(k)) keys.set(k, { ...s, i: keys.size });
  }
  const n = Math.max(1, keys.size), rows = Math.ceil(n / 4);
  let H = 256; while (H < rows * CH && H < 4096) H *= 2;
  const cap = 4 * Math.floor(H / CH);
  const c = document.createElement('canvas');
  c.width = 4 * CW; c.height = H;
  const g = c.getContext('2d');
  for (const s of keys.values()) {
    if (s.i >= cap) continue;
    const x = (s.i % 4) * CW, y = Math.floor(s.i / 4) * CH;
    const [font, bgOver, ink] = SIGN_STYLE[s.style] || SIGN_STYLE.shop;
    const bg = bgOver || '#' + s.bg.toString(16).padStart(6, '0');
    g.fillStyle = bg; g.fillRect(x, y, CW, CH);
    // a thin lined border, then the name as large as fits
    g.strokeStyle = ink; g.globalAlpha = 0.45; g.lineWidth = 2;
    g.strokeRect(x + 10, y + 12, CW - 20, SH - 8); g.globalAlpha = 1;
    let size = 46;
    g.font = font.replace('{s}', size);
    while (g.measureText(s.text).width > CW - 60 && size > 18) { size -= 2; g.font = font.replace('{s}', size); }
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(s.text, x + CW / 2, y + CH / 2 + 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.flipY = false;
  const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.55 });
  // in the evening the fascias are lit (small lamps over them): the board gives its own colour
  // back as light, brightest under the cornice (the uniform follows the time of day)
  const glow = { get value() { return GLOW.windows; } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSignGlow = glow;
    shader.fragmentShader = 'uniform float uSignGlow;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * uSignGlow * (0.7 - 0.35 * smoothstep(0.1, 0.9, fract(vMapUv.y * ${H}.0 / ${CH}.0)));`);
    // the instance colour carries the sign's atlas cell (r + 256 g): turn it into the cell's uv
    const atlasUv = `
      #ifdef USE_INSTANCING_COLOR
        float id_ = floor(instanceColor.r * 255.0 + 0.5) + 256.0 * floor(instanceColor.g * 255.0 + 0.5);
        float col_ = mod(id_, 4.0), row_ = floor(id_ / 4.0);
        vMapUv = vec2((col_ + uv.x) * 0.25, (row_ * ${CH}.0 + ${(CH - SH) / 2}.0 + (1.0 - uv.y) * ${SH}.0) / ${H}.0);
        vColor = vec3(1.0);
      #endif`;
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n' + atlasUv);
  };
  mat.customProgramCacheKey = () => 'bldsignatlas';
  const cell = (text, bg, style) => {
    const s = keys.get(style + '|' + bg + '|' + text);
    const i = s ? s.i % cap : 0;
    return new THREE.Color((i % 256) / 255, Math.floor(i / 256) / 255, 1);
  };
  return { mat, cell };
}
