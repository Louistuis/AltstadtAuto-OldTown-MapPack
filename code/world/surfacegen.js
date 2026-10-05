import { rng } from '../engine/rng.js';

/*
  The surface painters behind world/surfaces.js: plain maths over typed arrays (no three, no DOM),
  so they run in a worker (world/surfaceworker.js) as well as on the page.
  generate(name) -> { S, col, det }: S x S RGBA bytes each, laid out as surfaces.js describes.
  Everything draws from its own seeded rng: never Math.random or a level's R().
*/

const F = (S) => new Float32Array(S * S);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------- fields ----------
/** Adds seamless value noise (p lattice cells across the S px tile, -amp..amp) into out. */
function vnoise(out, S, p, seed, amp = 1, py = p) {
  const r = rng(seed), L = new Float32Array(p * py);
  for (let i = 0; i < L.length; i++) L[i] = r() * 2 - 1;
  const ax = new Int32Array(S), bx = new Int32Array(S), wx = new Float32Array(S);
  const ay = new Int32Array(S), by = new Int32Array(S), wy = new Float32Array(S);
  for (let x = 0; x < S; x++) {
    let f = (x * p) / S, a = Math.floor(f), t = f - a;
    ax[x] = a % p; bx[x] = (a + 1) % p; wx[x] = t * t * (3 - 2 * t);
    f = (x * py) / S; a = Math.floor(f); t = f - a;
    ay[x] = (a % py) * p; by[x] = ((a + 1) % py) * p; wy[x] = t * t * (3 - 2 * t);
  }
  for (let y = 0; y < S; y++) {
    const r0 = ay[y], r1 = by[y], v = wy[y], row = y * S;
    for (let x = 0; x < S; x++) {
      const i0 = ax[x], i1 = bx[x], u = wx[x];
      const top = L[r0 + i0] + (L[r0 + i1] - L[r0 + i0]) * u;
      const bot = L[r1 + i0] + (L[r1 + i1] - L[r1 + i0]) * u;
      out[row + x] += (top + (bot - top) * v) * amp;
    }
  }
  return out;
}
/** Fractal value noise, roughly -1..1: oct octaves from p cells across, each twice as fine. */
function fbm(S, p, oct, seed, gain = 0.5, py = p) {
  const o = F(S);
  let a = 1, n = 0;
  for (let k = 0; k < oct && (p << k) <= S; k++) { vnoise(o, S, p << k, seed + k * 101, a, py << k); n += a; a *= gain; }
  for (let i = 0; i < o.length; i++) o[i] /= n * 0.55;
  return o;
}
/** White noise, -0.5..0.5 a pixel. */
function grain(S, seed) {
  const r = rng(seed), o = F(S);
  for (let i = 0; i < o.length; i++) o[i] = r() - 0.5;
  return o;
}
/** Seamless box blur of radius rad px (two passes each way: close to a gaussian). */
function blur(src, S, rad) {
  const a = Float32Array.from(src), b = F(S), n = rad * 2 + 1, line = new Float32Array(S + n);
  // one line at a time, padded with its wrapped ends: then a plain running sum
  const pass = (from, to, horiz) => {
    for (let l = 0; l < S; l++) {
      const base = horiz ? l * S : l, step = horiz ? 1 : S;
      for (let k = 0; k < S + n; k++) line[k] = from[base + ((k - rad + S) % S) * step];
      let s = 0;
      for (let k = 0; k < n; k++) s += line[k];
      for (let k = 0; k < S; k++) { to[base + k * step] = s / n; s += line[k + n] - line[k]; }
    }
  };
  for (let it = 0; it < 2; it++) { pass(a, b, true); pass(b, a, false); }
  return a;
}
/**
 * Seamless cellular noise over n x n jittered cells: f1 / f2 = distance to the nearest / second
 * nearest point (in cell widths), id = the nearest point's index (0 .. n*n - 1).
 */
function cells(S, n, seed) {
  const r = rng(seed), jx = new Float32Array(n * n), jy = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) { jx[i] = 0.1 + r() * 0.8; jy[i] = 0.1 + r() * 0.8; }
  const f1 = F(S), f2 = F(S), id = new Int32Array(S * S), k = n / S;
  for (let y = 0; y < S; y++) {
    const fy = (y + 0.5) * k, cy = Math.floor(fy);
    for (let x = 0; x < S; x++) {
      const fx = (x + 0.5) * k, cx = Math.floor(fx);
      let d1 = 9, d2 = 9, best = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const gy = cy + dy, wy = ((gy % n) + n) % n;
        for (let dx = -1; dx <= 1; dx++) {
          const gx = cx + dx, j = wy * n + (((gx % n) + n) % n);
          const ex = gx + jx[j] - fx, ey = gy + jy[j] - fy, d = ex * ex + ey * ey;
          if (d < d1) { d2 = d1; d1 = d; best = j; } else if (d < d2) d2 = d;
        }
      }
      const i = y * S + x;
      f1[i] = Math.sqrt(d1); f2[i] = Math.sqrt(d2); id[i] = best;
    }
  }
  return { f1, f2, id };
}
/** A soft disc (1 at the centre, 0 at rad px) into mask, keeping the larger value; wraps. */
function stamp(mask, S, x, y, rad, v = 1) {
  const R = Math.ceil(rad);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const d = Math.sqrt(dx * dx + dy * dy) / rad;
    if (d >= 1) continue;
    const i = (((Math.round(y) + dy) % S + S) % S) * S + (((Math.round(x) + dx) % S + S) % S);
    const t = (1 - d * d) * v;
    if (t > mask[i]) mask[i] = t;
  }
}
/**
 * n hairline cracks into mask, each ~len px long and w px wide (tapering at the ends): short
 * straight runs at jittered headings round a slowly turning course, now and then a branch.
 */
function cracks(mask, S, n, len, w, seed, region) {
  const r = rng(seed);
  for (let c = 0; c < n; c++) {
    let x = region ? region[0] + r() * region[2] : r() * S, y = region ? region[1] + r() * region[3] : r() * S;
    let base = r() * Math.PI * 2, a = base, seg = 0;
    const steps = Math.floor(len * 2 * (0.6 + r() * 0.8));
    for (let s = 0; s < steps; s++) {
      if (seg-- <= 0) { base += (r() - 0.5) * 0.5; a = base + (r() - 0.5) * 1.1; seg = 6 + r() * 16; }
      x += Math.cos(a) * 0.5; y += Math.sin(a) * 0.5;
      const taper = Math.min(1, s / 20, (steps - s) / 20);
      stamp(mask, S, x, y, Math.max(0.6, w * taper), 0.55 + 0.45 * taper);
      if (r() < 0.0015) cracks(mask, S, 1, len * 0.3, w * 0.7, Math.floor(r() * 1e9), [x, y, 0, 0]);
    }
  }
}

// ---------- baking ----------
/**
 * Pack a surface: h (height, m), ro (roughness 0..1), col r/g/b (sRGB 0..1), tint (0..1, or one
 * number for all), ao (extra occlusion 0..1, optional); `tile` = metres the S px tile covers.
 * Cavity: how far each texel sits below its blurred surroundings (aoDepth m -> 0.45 left).
 */
function bake(S, tile, { h, ro, r, g, b, tint = 1, ao = null, aoDepth = 0.003, aoRad = 3 }) {
  const col = new Uint8Array(S * S * 4), det = new Uint8Array(S * S * 4);
  // (clamped views: a store rounds and clamps to 0..255 by itself)
  const C = new Uint8ClampedArray(col.buffer), D = new Uint8ClampedArray(det.buffer);
  const avg = blur(h, S, aoRad);
  const k = (S / tile / 2) * 127.5; // central difference over 2 px, per metre, to bytes
  const tA = typeof tint === 'number' ? null : tint, t0 = tA ? 0 : tint * 255, cK = 0.55 / aoDepth;
  for (let y = 0; y < S; y++) {
    const yu = ((y + 1) % S) * S, yd = ((y - 1 + S) % S) * S, row = y * S;
    for (let x = 0; x < S; x++) {
      const i = row + x, o = i * 4;
      const xr = x + 1 === S ? 0 : x + 1, xl = x === 0 ? S - 1 : x - 1;
      D[o] = 127.5 + (h[row + xr] - h[row + xl]) * k;
      D[o + 1] = 127.5 + (h[yu + x] - h[yd + x]) * k;
      D[o + 2] = ro[i] * 255;
      let dep = avg[i] - h[i];
      dep = dep < 0 ? 0 : dep * cK;
      const cav = (dep > 0.55 ? 0.45 : 1 - dep) * 255;
      D[o + 3] = ao ? cav * ao[i] : cav;
      C[o] = r[i] * 255; C[o + 1] = g[i] * 255; C[o + 2] = b[i] * 255;
      C[o + 3] = tA ? tA[i] * 255 : t0;
    }
  }
  return { S, col, det };
}
// ---------- the surfaces ----------
/** asphalt: 4 m a tile. Dark binder, fine exposed aggregate polished by tyres, hairline cracks. */
function asphalt(S) {
  const T = 4, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const big = fbm(S, 4, 4, 701), mid = fbm(S, 24, 3, 702), gr = grain(S, 705);
  const nc = Math.round(S / 2.6); // stones ~2 cm apart
  const st = cells(S, nc, 703);
  const tr = rng(704), tone = new Float32Array(nc * nc).map(() => tr());
  const crack = F(S); cracks(crack, S, 4, 200, 0.9, 706);
  for (let i = 0; i < N; i++) {
    const t = tone[st.id[i]];
    const stone = sstep(0.44, 0.3, st.f1[i] + mid[i] * 0.05);
    let v = 0.235 + big[i] * 0.02 + mid[i] * 0.015 + gr[i] * 0.05;
    const sv = 0.25 + t * t * 0.2 + gr[i] * 0.03;
    v += (sv - v) * stone * 0.8;
    const c = crack[i];
    v *= 1 - c * 0.35;
    h[i] = stone * (0.0007 + t * 0.0006) + mid[i] * 0.0005 + gr[i] * 0.0002 - c * 0.003;
    ro[i] = 0.93 - stone * (0.1 + t * 0.12) + big[i] * 0.03 + c * 0.06;
    r[i] = v * 0.99; g[i] = v; b[i] = v * 1.025 + 0.004;
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.0012, aoRad: 2 });
}

/** sidewalk: 3 m a tile, 2 x 2 slabs of 1.5 m with dirty joints, each slab its own tone and tilt. */
function sidewalk(S) {
  const T = 3, N = S * S, half = S / 2, px = T / S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const big = fbm(S, 6, 4, 711), fine = fbm(S, 96, 2, 712), gr = grain(S, 713), edgeN = fbm(S, 64, 2, 714), stain = fbm(S, 12, 3, 717);
  const sr = rng(715);
  const slab = [0, 1, 2, 3].map(() => ({ tone: (sr() - 0.5) * 0.12, warm: (sr() - 0.5) * 0.02, tx: (sr() - 0.5) * 0.004, ty: (sr() - 0.5) * 0.004 }));
  // chewing gum and drips: small dark discs
  const spot = F(S);
  for (let k = 0; k < 45; k++) stamp(spot, S, sr() * S, sr() * S, 1 + sr() * 1.8, 0.4 + sr() * 0.6);
  const crack = F(S); cracks(crack, S, 1, 160, 0.9, 716, [half * 0.2, half * 0.3, half * 0.5, half * 0.3]);
  const jw = 1.0; // joint half-width, px (~6 mm)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const sx = x % half + 0.5, sy = y % half + 0.5, sl = slab[(x >= half ? 1 : 0) + (y >= half ? 2 : 0)];
    const e = Math.min(sx, half - sx, sy, half - sy) + edgeN[i] * 0.5;
    const inS = sstep(jw - 0.3, jw + 0.8, e);
    const bevel = sstep(jw, jw + 2.5, e);
    const nearJ = 1 - sstep(jw, jw + 10, e);   // grime creeps in from the joint
    let v = 0.68 + sl.tone + big[i] * 0.05 + Math.max(0, stain[i]) * -0.04 + fine[i] * 0.012 + gr[i] * 0.05;
    v *= 1 - nearJ * 0.12;
    const sp = spot[i], c = crack[i];
    v = v * (1 - sp * 0.4) * (1 - c * 0.45);
    v = v * inS + (0.3 + big[i] * 0.04 + gr[i] * 0.05) * (1 - inS);
    h[i] = inS * (0.002 * bevel + (sx - half / 2) * px * sl.tx + (sy - half / 2) * px * sl.ty + fine[i] * 0.0003 + gr[i] * 0.00015 + sp * 0.0004) - (1 - inS) * 0.006 - c * 0.003;
    ro[i] = (0.88 + big[i] * 0.04 - sp * 0.25) * inS + (1 - inS) * 0.97;
    r[i] = v * (1 + sl.warm); g[i] = v; b[i] = v * (0.97 - sl.warm);
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.004, aoRad: 3 });
}

/** brick: 2 m a tile, 9 bricks x 27 courses (22 x 7.4 cm with the joint), running bond, raked joints. */
function brick(S) {
  const T = 2, rows = 27, cols = 9, rowH = S / rows, colW = S / cols, mh = 1.2; // half joint px (~1 cm joint)
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S), tint = F(S);
  const big = fbm(S, 4, 3, 721), pit = fbm(S, 128, 2, 722), gr = grain(S, 723), chip = fbm(S, 48, 2, 724);
  const br = rng(725), nB = rows * cols;
  const lum = new Float32Array(nB), hue = new Float32Array(nB), lift = new Float32Array(nB), rough = new Float32Array(nB);
  for (let k = 0; k < nB; k++) {
    const dark = br() < 0.09;
    lum[k] = dark ? 0.62 + br() * 0.08 : 0.8 + (br() - 0.5) * 0.18;
    hue[k] = -0.02 + br() * 0.08; lift[k] = (br() - 0.5) * 0.0012; rough[k] = 0.82 + br() * 0.1;
  }
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / rowH), fy = y + 0.5 - row * rowH, off = (row % 2) * colW / 2;
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const xx = (x + 0.5 + off) % S, col = Math.floor(xx / colW), fx = xx - col * colW;
      const k = row * cols + (col % cols);
      const e = Math.min(fx, colW - fx, fy, rowH - fy) + chip[i] * 0.7;
      const inB = sstep(mh - 0.4, mh + 0.6, e);
      const round = sstep(mh, mh + 2.2, e);
      const p = pit[i];
      const bv = lum[k] * (1 + big[i] * 0.05) + gr[i] * 0.045 - Math.max(0, p - 0.5) * 0.25;
      const mv = 0.7 + big[i] * 0.04 + gr[i] * 0.07;
      h[i] = inB * (0.0045 * round + lift[k] + p * 0.00015) + gr[i] * 0.00015;
      ro[i] = inB * rough[k] + (1 - inB) * 0.97;
      r[i] = inB * bv * (1 + hue[k]) + (1 - inB) * mv;
      g[i] = inB * bv + (1 - inB) * mv * 0.985;
      b[i] = inB * bv * (1 - hue[k] * 0.8) + (1 - inB) * mv * 0.95;
      tint[i] = 0.2 + 0.8 * inB;
    }
  }
  return bake(S, T, { h, ro, r, g, b, tint, aoDepth: 0.004, aoRad: 3 });
}

/** render / stucco: 2 m a tile. Sand-float finish and trowel patches. */
function stucco(S) {
  const T = 2, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const big = fbm(S, 3, 4, 731), mid = fbm(S, 12, 3, 732), fine = fbm(S, 128, 2, 733), gr = grain(S, 734);
  // (no cracks: on a 2 m tile any one mark repeats all over the wall)
  for (let i = 0; i < N; i++) {
    const v = 0.88 + big[i] * 0.03 + mid[i] * 0.018 + fine[i] * 0.015 + gr[i] * 0.02;
    h[i] = fine[i] * 0.0004 + gr[i] * 0.00022 + mid[i] * 0.0008;
    ro[i] = 0.9 + mid[i] * 0.04 + gr[i] * 0.04;
    r[i] = v; g[i] = v * 0.995; b[i] = v * 0.98;
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.0016, aoRad: 2 });
}

/** concrete panels: 3 m a tile, one cast panel: formwork joint, tie holes, pour lines and bug holes. */
function concrete(S) {
  const T = 3, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const big = fbm(S, 4, 4, 741), mid = fbm(S, 16, 3, 742), gr = grain(S, 743), bands = fbm(S, 2, 3, 744, 0.5, 40);
  const cr = rng(745), holes = F(S), ties = F(S);
  for (let k = 0; k < 520; k++) stamp(holes, S, cr() * S, cr() * S, 0.6 + cr() * cr() * 2.2);
  for (const u of [0.25, 0.75]) for (const v of [0.25, 0.75]) stamp(ties, S, u * S, v * S, S * 0.0045 * 3 / T * 1.3);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const e = Math.min(x + 0.5, S - x - 0.5, y + 0.5, S - y - 0.5);
    const joint = 1 - sstep(0.6, 1.6, e);
    const ho = holes[i], ti = ties[i];
    let v = 0.82 + big[i] * 0.045 + mid[i] * 0.02 + bands[i] * 0.025 + gr[i] * 0.04;
    v *= (1 - ho * 0.3) * (1 - ti * 0.45) * (1 - joint * 0.35);
    h[i] = mid[i] * 0.0004 + gr[i] * 0.0002 - ho * 0.0018 - ti * 0.012 - joint * 0.005;
    ro[i] = 0.86 + big[i] * 0.05 + ho * 0.08;
    r[i] = v; g[i] = v; b[i] = v * 0.985;
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.003, aoRad: 2 });
}

/** granite curb stone: 2 m a tile, fine speckled grains, honed smooth. */
function granite(S) {
  const T = 2, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const nc = Math.round(S / 1.4);
  const st = cells(S, nc, 751), big = fbm(S, 4, 3, 752), gr = grain(S, 753);
  const tr = rng(754), tone = new Float32Array(nc * nc).map(() => { const t = tr(); return t < 0.15 ? 0.42 : t < 0.8 ? 0.6 + tr() * 0.1 : 0.76; });
  for (let i = 0; i < N; i++) {
    const v = tone[st.id[i]] * (0.95 + big[i] * 0.04) + gr[i] * 0.04;
    h[i] = gr[i] * 0.0002 + big[i] * 0.0004 - st.f1[i] * 0.0002;
    ro[i] = 0.62 + big[i] * 0.06 + (tone[st.id[i]] < 0.3 ? -0.08 : 0);
    r[i] = v; g[i] = v * 0.99; b[i] = v * 0.985;
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.001, aoRad: 2 });
}

/** road paint: 2 m a tile. Thermoplastic lines worn through to the asphalt in patches and pinholes. */
function roadpaint(S) {
  const T = 2, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S), tint = F(S);
  const wear = fbm(S, 6, 4, 761 + 100), fine = fbm(S, 48, 2, 862), gr = grain(S, 863);
  const st = cells(S, Math.round(S / 2.6), 864);
  for (let i = 0; i < N; i++) {
    const worn = sstep(0.5, 0.66, fine[i] * 0.5 + wear[i] * 0.35 + gr[i] * 0.35);
    const stone = sstep(0.42, 0.3, st.f1[i]);
    const paint = (0.93 + gr[i] * 0.05 - Math.max(0, fine[i]) * 0.06) * (1 - stone * 0.08);
    const tar = 0.24 + gr[i] * 0.05 + stone * 0.06;
    const v = paint * (1 - worn) + tar * worn;
    h[i] = stone * 0.0007 + gr[i] * 0.0002 + (1 - worn) * 0.0008;
    ro[i] = 0.55 * (1 - worn) + 0.92 * worn + gr[i] * 0.04;
    r[i] = v; g[i] = v; b[i] = v * 0.99;
    tint[i] = 1 - worn;
  }
  return bake(S, T, { h, ro, r, g, b, tint, aoDepth: 0.0012, aoRad: 2 });
}

// ---------- the outer districts ----------
/** lawn: 4 m a tile. Clumps of blades in two greens, dry straw patches, soil showing through. */
function grass(S) {
  const T = 4, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const big = fbm(S, 4, 4, 801), mid = fbm(S, 20, 3, 802), gr = grain(S, 803), gr2 = grain(S, 804);
  const nc = Math.round(S / 5);
  const cl = cells(S, nc, 805);
  const tr = rng(806), tone = new Float32Array(nc * nc).map(() => tr());
  for (let i = 0; i < N; i++) {
    const t = tone[cl.id[i]];
    const tuft = 1 - sstep(0.15, 0.75, cl.f1[i]);      // the clump's crown
    const dry = sstep(0.25, 0.75, big[i] * 0.6 + mid[i] * 0.4);
    const soil = sstep(0.55, 0.85, cl.f1[i] + gr[i] * 0.25 - mid[i] * 0.2) * 0.6;
    const blade = gr[i] * 0.5 + gr2[i] * 0.5;
    let R = 0.3 + t * 0.08 + blade * 0.1, G = 0.47 + t * 0.12 + blade * 0.14, B = 0.2 + blade * 0.06;
    R += dry * 0.16; G += dry * 0.05; B += dry * 0.05;
    const sh = 0.75 + 0.35 * tuft;
    R = (R * (1 - soil) + 0.33 * soil) * sh; G = (G * (1 - soil) + 0.27 * soil) * sh; B = (B * (1 - soil) + 0.19 * soil) * sh;
    h[i] = tuft * 0.012 + blade * 0.004 + mid[i] * 0.003 - soil * 0.004;
    ro[i] = 0.92 - tuft * 0.08 + soil * 0.06;
    r[i] = R; g[i] = G; b[i] = B;
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.008, aoRad: 3 });
}

/** desert sand: 5 m a tile. Wind ripples (~9 cm), darker grit in their troughs, the odd pebble. */
function sand(S) {
  const T = 5, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const big = fbm(S, 4, 4, 811), warp = fbm(S, 6, 3, 812), gr = grain(S, 813);
  const pr = rng(814), peb = F(S);
  for (let k = 0; k < 90; k++) stamp(peb, S, pr() * S, pr() * S, 1 + pr() * 2.2, 0.6 + pr() * 0.4);
  const waves = 56; // ripples across the tile (a whole number: seamless)
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    // ripples run roughly along x, bent by the warp field
    const ph = ((y + x * 0.25) / S * waves + warp[i] * 1.6) * Math.PI * 2;
    const rip = Math.sin(ph) * 0.5 + 0.5, sharp = rip * rip;
    const p = peb[i];
    let v = 0.78 + big[i] * 0.05 + gr[i] * 0.06 - (1 - sharp) * 0.04;
    v = v * (1 - p) + (0.45 + gr[i] * 0.2) * p;
    h[i] = sharp * 0.006 + big[i] * 0.01 + gr[i] * 0.0006 + p * 0.004;
    ro[i] = 0.95 - p * 0.15;
    r[i] = v * 1.0; g[i] = v * 0.85; b[i] = v * 0.62;
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.004, aoRad: 3 });
}

/** clapboard siding: 2 m a tile, ten 20 cm painted boards, each lapped over the one below. */
function siding(S) {
  const T = 2, n = 10, bh = S / n;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const grainW = fbm(S, 4, 3, 821, 0.5, 96), big = fbm(S, 3, 3, 822), gr = grain(S, 823), peel = fbm(S, 16, 3, 824);
  for (let y = 0; y < S; y++) {
    // rows run up the wall (v = height): each board is thickest at its bottom (butt) edge
    const fy = (y % bh + 0.5) / bh;
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const shadow = sstep(0.86, 1, fy); // the shadow line under the board above
      const worn = sstep(0.62, 0.85, peel[i] * 0.5 + big[i] * 0.5) * 0.5;
      let v = 0.9 + grainW[i] * 0.03 + gr[i] * 0.025 + big[i] * 0.02;
      v *= 1 - shadow * 0.25;
      h[i] = (1 - fy) * 0.01 + grainW[i] * 0.0003 - worn * 0.0003;
      ro[i] = 0.6 + worn * 0.3 + gr[i] * 0.05;
      r[i] = v * (1 - worn * 0.25); g[i] = v * (1 - worn * 0.28); b[i] = v * (1 - worn * 0.34);
    }
  }
  return bake(S, T, { h, ro, r, g, b, tint: 0.95, aoDepth: 0.004, aoRad: 2 });
}

/** asphalt shingles: 2 m a tile, 12 courses of three-tab strips with grit, staggered slots. */
function shingle(S) {
  const T = 2, rows = 12, rh = S / rows, tabs = 6, tw = S / tabs;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const gr = grain(S, 831), gr2 = grain(S, 832), big = fbm(S, 3, 3, 833);
  const tr = rng(834), tone = new Float32Array(rows * tabs).map(() => (tr() - 0.5) * 0.14);
  for (let y = 0; y < S; y++) {
    // v runs up the slope: each course's thick lower edge overlaps the one below
    const row = Math.floor(y / rh), fy = (y - row * rh + 0.5) / rh, off = (row % 2) * tw / 2;
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const xx = (x + 0.5 + off) % S, tab = Math.floor(xx / tw), fx = xx - tab * tw;
      const slot = 1 - sstep(0.8, 2.2, Math.min(fx, tw - fx)) * 1;
      const inSlot = slot * (fy < 0.62 ? 1 : 0);
      const edge = sstep(0.88, 1, fy); // in the shadow of the next course's edge
      let v = 0.62 + tone[row * tabs + tab] + gr[i] * 0.2 + gr2[i] * 0.08 + big[i] * 0.04;
      v *= (1 - edge * 0.35) * (1 - inSlot * 0.5);
      h[i] = (1 - fy) * 0.004 + gr[i] * 0.0006 - inSlot * 0.003;
      ro[i] = 0.95;
      r[i] = v; g[i] = v; b[i] = v * 0.98;
    }
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.002, aoRad: 2 });
}

/** cut stone: 2 m a tile, five 40 cm courses of rock-faced blocks with bevelled edges, deep joints. */
function stone(S) {
  const T = 2, rows = 5, rh = S / rows;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S), tint = F(S);
  const face = fbm(S, 16, 4, 841), big = fbm(S, 4, 3, 842), gr = grain(S, 843), chip = fbm(S, 40, 2, 844);
  const br = rng(845);
  // each course: block edges (px along u, wrapping) and a tone per block
  // (all cuts inside the tile; the last block runs on round the edge to the first cut)
  const courses = [];
  for (let k = 0; k < rows; k++) {
    const x0 = br() * 40, cuts = [x0];
    for (let x = x0; ;) { const w = 45 + br() * 55; if (x + w > x0 + S - 40) break; x += w; cuts.push(x); }
    courses.push({ cuts, tone: cuts.map(() => (br() - 0.5) * 0.12) });
  }
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / rh), fy = y + 0.5 - row * rh, c = courses[row];
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      // which block: the last cut at or before x (wrapping round the tile)
      let k = c.cuts.length - 1, xl = c.cuts[k] - S;
      for (let j = 0; j < c.cuts.length; j++) if (c.cuts[j] <= x + 0.5) { k = j; xl = c.cuts[j]; }
      const xr = k + 1 < c.cuts.length ? c.cuts[k + 1] : c.cuts[0] + S;
      const e = Math.min(x + 0.5 - xl, xr - x - 0.5, fy, rh - fy) + chip[i] * 1.2;
      const inB = sstep(1.2, 2.2, e), bev = sstep(1.5, 6, e);
      const v = (0.78 + c.tone[k] + big[i] * 0.04 + face[i] * 0.05 + gr[i] * 0.05) * inB + (0.55 + gr[i] * 0.06) * (1 - inB);
      h[i] = inB * (0.006 * bev + face[i] * 0.004) + gr[i] * 0.0003;
      ro[i] = 0.9 + face[i] * 0.04;
      r[i] = v; g[i] = v * 0.985; b[i] = v * 0.955;
      tint[i] = 0.4 + 0.6 * inB;
    }
  }
  return bake(S, T, { h, ro, r, g, b, tint, aoDepth: 0.006, aoRad: 3 });
}

/** sandstone: 6 m a tile. Strata of varying hardness (ledges and recesses), iron staining, pitting. */
function rock(S) {
  const T = 6, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const strata = fbm(S, 2, 4, 851, 0.5, 10), big = fbm(S, 4, 4, 852), pit = fbm(S, 64, 2, 853), gr = grain(S, 854);
  for (let i = 0; i < N; i++) {
    const s = strata[i] + big[i] * 0.25;
    const band = Math.sin(s * 6) * 0.5 + 0.5;
    const ledge = sstep(0.35, 0.65, band);
    const v = 0.72 + (band - 0.5) * 0.16 + big[i] * 0.06 + gr[i] * 0.03 - Math.max(0, pit[i] - 0.5) * 0.15;
    h[i] = ledge * 0.03 + big[i] * 0.02 + pit[i] * 0.002 + gr[i] * 0.0006;
    ro[i] = 0.93;
    const iron = sstep(0.2, 0.7, big[i]) * 0.12;
    r[i] = v * (1.0 + iron * 0.2); g[i] = v * (0.66 - iron * 0.1); b[i] = v * (0.47 - iron * 0.12);
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.02, aoRad: 4 });
}

// ---------- things (mapped in their own frame: u runs along the piece) ----------
/** timber: 1 m a tile, grain along u. Growth rings bent by knots, open pores, weathered grey in places. */
function wood(S) {
  const T = 1, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const warp = fbm(S, 2, 3, 871, 0.5, 6), streak = fbm(S, 2, 3, 872, 0.5, 48), gr = grain(S, 873), wx = fbm(S, 4, 3, 874);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    // rings: lines along u, wandering across v
    const ring = Math.sin(((y / S) * 40 + warp[i] * 1.1) * Math.PI * 2) * 0.5 + 0.5;
    const late = Math.pow(ring, 6);
    const weather = sstep(0.4, 0.9, wx[i]) * 0.35;
    let v = 0.82 - late * 0.22 + streak[i] * 0.06 + gr[i] * 0.04;
    const grey = v * 0.85;
    h[i] = -late * 0.0004 + streak[i] * 0.0002 + gr[i] * 0.0001;
    ro[i] = 0.62 + late * 0.12 + weather * 0.25;
    r[i] = v * (1 - weather) + grey * weather; g[i] = v * (1 - weather) + grey * 1.02 * weather; b[i] = v * (1 - weather) + grey * 1.06 * weather;
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.0004, aoRad: 1 });
}

/** painted steel: 1 m a tile. Orange-peel paint, scuffs along u, chips down to dark primer and rust. */
function metal(S) {
  const T = 1, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S), tint = F(S);
  const peel = fbm(S, 64, 2, 881), big = fbm(S, 3, 4, 882), scuff = fbm(S, 3, 3, 883, 0.5, 90), chipN = fbm(S, 12, 4, 884), gr = grain(S, 885);
  for (let i = 0; i < N; i++) {
    const chip = sstep(0.92, 0.95, chipN[i] + gr[i] * 0.05);
    const sc = sstep(0.35, 0.8, scuff[i]) * 0.5;
    const v = 0.9 + big[i] * 0.04 + gr[i] * 0.02 + sc * 0.06;
    h[i] = peel[i] * 0.00012 - chip * 0.0003;
    ro[i] = 0.42 + big[i] * 0.08 + sc * 0.2 + chip * 0.35;
    r[i] = v * (1 - chip) + 0.3 * chip; g[i] = v * (1 - chip) + 0.22 * chip; b[i] = v * (1 - chip) + 0.17 * chip;
    tint[i] = 1 - chip * 0.6;
  }
  return bake(S, T, { h, ro, r, g, b, tint, aoDepth: 0.0004, aoRad: 1 });
}

/** awning canvas: 1 m a tile. A coarse weave, slubs, rain-water tide marks and soot. */
function canvas(S) {
  const T = 1, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const warpN = fbm(S, 4, 2, 891, 0.5, 128), weftN = fbm(S, 128, 2, 892, 0.5, 4), big = fbm(S, 3, 4, 893), gr = grain(S, 894);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const wv = (x % 2) ^ (y % 2) ? 1 : -1;
    const v = 0.86 + warpN[i] * 0.03 + weftN[i] * 0.03 + big[i] * 0.05 + gr[i] * 0.03 + wv * 0.015;
    h[i] = wv * 0.0002 + warpN[i] * 0.0002 + weftN[i] * 0.0002;
    ro[i] = 0.92;
    r[i] = v; g[i] = v; b[i] = v * 0.98;
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.0004, aoRad: 1 });
}

/** roof gravel: 2 m a tile. Ballast stones on a dark membrane, packed tighter in places. */
function gravel(S) {
  const T = 2, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const nc = Math.round(S / 3.2);
  const st = cells(S, nc, 901), big = fbm(S, 4, 3, 902), gr = grain(S, 903);
  const tr = rng(904), tone = new Float32Array(nc * nc).map(() => tr()), size = new Float32Array(nc * nc).map(() => 0.5 + tr() * 0.3);
  for (let i = 0; i < N; i++) {
    const k = st.id[i], t = tone[k];
    const d = st.f1[i] / size[k];
    const stone = sstep(1.0, 0.6, d + big[i] * 0.08);
    const dome = Math.sqrt(Math.max(0, 1 - d * d));
    const sv = 0.5 + t * 0.32 + gr[i] * 0.05 + big[i] * 0.03;
    const v = sv * stone + (0.2 + gr[i] * 0.05) * (1 - stone);
    h[i] = stone * dome * 0.008 + gr[i] * 0.0002;
    ro[i] = 0.85 + (1 - stone) * 0.1;
    r[i] = v * (1 + (t - 0.5) * 0.08); g[i] = v; b[i] = v * (0.96 - (t - 0.5) * 0.06);
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.005, aoRad: 3 });
}

// ---------- the old town ----------
/**
 * Courses of blocks across an S px tile: `rows` equal courses, each cut into blocks wMin..wMax px
 * long (a fresh random bond per course, wrapping round the tile). Per pixel: id (block, unique
 * over the tile), dx / dy (px from the block's centre), hw / hh (its half size), row.
 */
function blocks(S, rows, wMin, wMax, seed) {
  const r = rng(seed), rh = S / rows;
  const id = new Int32Array(S * S), dx = F(S), dy = F(S), hw = F(S), hh = F(S), row = new Int32Array(S * S);
  let next = 0;
  for (let k = 0; k < rows; k++) {
    // (all cuts inside the tile; the last block runs on round the edge to the first cut)
    const x0 = r() * wMin, cuts = [x0];
    for (let x = x0; ;) { const w = wMin + r() * (wMax - wMin); if (x + w > x0 + S - wMin * 0.8) break; x += w; cuts.push(x); }
    const n = cuts.length, base = next; next += n;
    const y0 = Math.round(k * rh), y1 = Math.round((k + 1) * rh), cy = (k + 0.5) * rh;
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < S; x++) {
        const px = x + 0.5;
        let j = n - 1, xl = cuts[n - 1] - S;
        for (let q = 0; q < n && cuts[q] <= px; q++) { j = q; xl = cuts[q]; }
        const xr = j + 1 < n ? cuts[j + 1] : cuts[0] + S;
        const i = y * S + x;
        id[i] = base + j; row[i] = k;
        dx[i] = px - (xl + xr) / 2; hw[i] = (xr - xl) / 2;
        dy[i] = y + 0.5 - cy; hh[i] = rh / 2;
      }
    }
  }
  return { id, dx, dy, hw, hh, row, count: next };
}
/** Signed distance (px) to a rounded rectangle of half size (bx, by), corner radius rad: < 0 inside. */
function rrect(px, py, bx, by, rad) {
  const qx = Math.abs(px) - bx + rad, qy = Math.abs(py) - by + rad;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - rad;
}
const perBlock = (n, seed, f) => { const r = rng(seed), a = new Float32Array(n); for (let k = 0; k < n; k++) a[k] = f(r); return a; };

/** cobbles: 2 m a tile, 18 courses of rounded stones (9-14 cm), domed and polished on top, sandy joints. */
function cobble(S) {
  const T = 2, N = S * S, ppm = S / T;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const B = blocks(S, 18, 0.09 * ppm, 0.14 * ppm, 1001);
  const tone = perBlock(B.count, 1002, (q) => q()), warm = perBlock(B.count, 1003, (q) => q() - 0.5);
  const tilt = perBlock(B.count * 2, 1004, (q) => (q() - 0.5) * 0.0008);
  const fine = fbm(S, 64, 3, 1005), big = fbm(S, 4, 3, 1006), gr = grain(S, 1007), sq = fbm(S, 24, 2, 1008);
  for (let i = 0; i < N; i++) {
    const k = B.id[i], t = tone[k];
    // a lumpy rounded outline per stone
    const d = rrect(B.dx[i], B.dy[i], B.hw[i] - 1.6, B.hh[i] - 1.6, 6) + sq[i] * 2.2;
    const inS = sstep(0.8, -0.8, d);
    const dome = Math.sqrt(clamp01(-d / Math.min(B.hw[i], B.hh[i])));
    const polish = dome * dome;
    const sv = 0.33 + t * 0.26 + fine[i] * 0.03 + gr[i] * 0.04 + polish * 0.04;
    const jv = 0.27 + big[i] * 0.04 + gr[i] * 0.07;
    const v = sv * inS + jv * (1 - inS);
    h[i] = inS * (dome * 0.011 + B.dx[i] * tilt[k * 2] + B.dy[i] * tilt[k * 2 + 1] + fine[i] * 0.0005) - (1 - inS) * 0.006 + gr[i] * 0.0002;
    ro[i] = inS * (0.82 - polish * 0.32 + fine[i] * 0.05) + (1 - inS) * 1;
    const wm = warm[k] * 0.12;
    r[i] = v * (1 + wm) * inS + jv * 1.08 * (1 - inS); g[i] = v * inS + jv * (1 - inS); b[i] = v * (1 - wm) * inS + jv * 0.85 * (1 - inS);
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.006, aoRad: 4 });
}

/** granite setts: 2 m a tile, 14 courses of squared blocks 14-26 cm long, flat tops, speckled. */
function setts(S) {
  const T = 2, N = S * S, ppm = S / T;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const B = blocks(S, 14, 0.14 * ppm, 0.26 * ppm, 1011);
  const tone = perBlock(B.count, 1012, (q) => (q() - 0.5) * 0.14), warm = perBlock(B.count, 1013, (q) => (q() - 0.5) * 0.06);
  const nc = Math.round(S / 2.4), st = cells(S, nc, 1014), sp = perBlock(nc * nc, 1015, (q) => { const t = q(); return t < 0.2 ? -0.18 : t > 0.85 ? 0.12 : 0; });
  const big = fbm(S, 4, 3, 1016), gr = grain(S, 1017), chip = fbm(S, 48, 2, 1018);
  for (let i = 0; i < N; i++) {
    const k = B.id[i];
    const d = rrect(B.dx[i], B.dy[i], B.hw[i] - 1.8, B.hh[i] - 1.8, 3.5) + chip[i] * 1.4;
    const inS = sstep(0.8, -0.8, d), top = sstep(0, -6, d);
    const sv = 0.5 + tone[k] + sp[st.id[i]] + big[i] * 0.03 + gr[i] * 0.04;
    const jv = 0.25 + gr[i] * 0.06;
    const v = sv * inS + jv * (1 - inS);
    h[i] = inS * (top * 0.006 + gr[i] * 0.0003) - (1 - inS) * 0.008;
    ro[i] = inS * (0.6 + big[i] * 0.06 + (1 - top) * 0.15) + (1 - inS);
    r[i] = v * (1 + warm[k]); g[i] = v; b[i] = v * (1 - warm[k] * 0.8);
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.006, aoRad: 4 });
}

/** flagstones: 3 m a tile, six 50 cm courses of slabs 60-110 cm long, worn edges, tones, stains. */
function flagstone(S) {
  const T = 3, N = S * S, ppm = S / T;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const B = blocks(S, 6, 0.6 * ppm, 1.1 * ppm, 1021);
  const tone = perBlock(B.count, 1022, (q) => (q() - 0.5) * 0.12), warm = perBlock(B.count, 1023, (q) => (q() - 0.5) * 0.08);
  const tilt = perBlock(B.count * 2, 1024, (q) => (q() - 0.5) * 0.00006);
  const big = fbm(S, 6, 4, 1025), fine = fbm(S, 96, 2, 1026), gr = grain(S, 1027), chip = fbm(S, 40, 3, 1028), stain = fbm(S, 10, 3, 1029);
  const crack = F(S); cracks(crack, S, 2, 120, 0.8, 1030);
  for (let i = 0; i < N; i++) {
    const k = B.id[i];
    const d = rrect(B.dx[i], B.dy[i], B.hw[i] - 0.9, B.hh[i] - 0.9, 2) + Math.max(0, chip[i] - 0.3) * 1.2;
    const inS = sstep(0.7, -0.7, d), bevel = sstep(0, -4, d);
    const c = crack[i];
    let v = 0.62 + tone[k] + big[i] * 0.03 + fine[i] * 0.015 + gr[i] * 0.04 - Math.max(0, stain[i] - 0.35) * 0.08;
    v *= 1 - c * 0.4;
    const jv = 0.4 + gr[i] * 0.06;
    const vv = v * inS + jv * (1 - inS);
    h[i] = inS * (bevel * 0.003 + B.dx[i] * tilt[k * 2] + B.dy[i] * tilt[k * 2 + 1] + fine[i] * 0.0003 + gr[i] * 0.0002) - (1 - inS) * 0.006 - c * 0.002;
    ro[i] = inS * (0.78 + big[i] * 0.06 - Math.max(0, stain[i]) * 0.1) + (1 - inS) * 0.97;
    r[i] = vv * (1 + warm[k]); g[i] = vv; b[i] = vv * (1 - warm[k] * 1.2) * 0.97;
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.004, aoRad: 3 });
}

/** ashlar: 4 m a tile, eleven 36 cm courses of dressed blocks 50-110 cm long, fine joints, tooling. */
function ashlar(S) {
  const T = 4, N = S * S, ppm = S / T;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const B = blocks(S, 11, 0.5 * ppm, 1.1 * ppm, 1041);
  const tone = perBlock(B.count, 1042, (q) => (q() - 0.5) * 0.1), warm = perBlock(B.count, 1043, (q) => (q() - 0.5) * 0.05);
  const tool = fbm(S, 128, 2, 1044, 0.5, 8), big = fbm(S, 4, 4, 1045), pore = fbm(S, 96, 2, 1046), gr = grain(S, 1047), chip = fbm(S, 32, 2, 1048);
  for (let i = 0; i < N; i++) {
    const k = B.id[i];
    const d = rrect(B.dx[i], B.dy[i], B.hw[i] - 0.8, B.hh[i] - 0.8, 1.5) + Math.max(0, chip[i] - 0.3) * 2;
    const inS = sstep(0.6, -0.6, d), bevel = sstep(0, -3, d);
    const v = 0.8 + tone[k] + big[i] * 0.05 + tool[i] * 0.015 + gr[i] * 0.03 - Math.max(0, pore[i] - 0.6) * 0.08;
    const jv = 0.74 + gr[i] * 0.05;
    const vv = v * inS + jv * (1 - inS);
    h[i] = inS * (bevel * 0.002 + tool[i] * 0.0004 + pore[i] * 0.0002) - (1 - inS) * 0.003;
    ro[i] = 0.86 + big[i] * 0.05;
    r[i] = vv * (1 + warm[k]); g[i] = vv; b[i] = vv * (1 - warm[k]) * 0.96;
  }
  return bake(S, T, { h, ro, r, g, b, tint: 0.9, aoDepth: 0.0025, aoRad: 3 });
}

/** rusticated plinth: 2 m a tile, four 50 cm courses of rock-faced blocks with deep chamfered joints. */
function rustic(S) {
  const T = 2, N = S * S, ppm = S / T;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const B = blocks(S, 4, 0.9 * ppm, 1.4 * ppm, 1051);
  const tone = perBlock(B.count, 1052, (q) => (q() - 0.5) * 0.1);
  const face = fbm(S, 12, 4, 1053), gr = grain(S, 1054);
  const ch = 0.045 * ppm; // chamfer width, px
  for (let i = 0; i < N; i++) {
    const k = B.id[i];
    const d = rrect(B.dx[i], B.dy[i], B.hw[i] - 1, B.hh[i] - 1, 1);
    const e = clamp01(-d / ch); // 0 at the joint, 1 on the face
    const v = (0.7 + tone[k] + face[i] * 0.05 + gr[i] * 0.04) * (0.75 + 0.25 * e);
    h[i] = e * 0.03 + e * e * face[i] * 0.006 + gr[i] * 0.0003;
    ro[i] = 0.9;
    r[i] = v; g[i] = v * 0.98; b[i] = v * 0.94;
  }
  return bake(S, T, { h, ro, r, g, b, tint: 0.9, aoDepth: 0.02, aoRad: 4 });
}

/** render (old-town stucco): 4 m a tile. Trowelled lime render, faint patching, a few hairline cracks. */
function render(S) {
  const T = 4, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const big = fbm(S, 3, 4, 1061), mid = fbm(S, 14, 3, 1062), fine = fbm(S, 128, 2, 1063), gr = grain(S, 1064);
  const trowel = fbm(S, 6, 3, 1065, 0.5, 20);
  const crack = F(S); cracks(crack, S, 3, 110, 0.6, 1066);
  for (let i = 0; i < N; i++) {
    const c = crack[i] * 0.8;
    const patch = sstep(0.45, 0.6, mid[i] * 0.6 + big[i] * 0.4);
    const v = (0.9 + big[i] * 0.025 + patch * 0.02 + trowel[i] * 0.012 + fine[i] * 0.012 + gr[i] * 0.015) * (1 - c * 0.22);
    h[i] = fine[i] * 0.0003 + gr[i] * 0.00015 + trowel[i] * 0.0007 + patch * 0.0006 - c * 0.0008;
    ro[i] = 0.88 + mid[i] * 0.04 - patch * 0.03;
    r[i] = v; g[i] = v * 0.995; b[i] = v * 0.985;
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.0012, aoRad: 2 });
}

/** terracotta tiles: 2 m a tile, 14 courses of pan tiles (20 cm waves), each tile its own fire colour, lichen. */
function rooftile(S) {
  const T = 2, N = S * S, ppm = S / T, rows = 14, rh = S / rows, tw = 0.2 * ppm;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const nT = rows * Math.ceil(S / tw);
  const tr = rng(1071), fire = new Float32Array(nT).map(() => tr()), dk = new Float32Array(nT).map(() => tr());
  const big = fbm(S, 4, 3, 1072), lich = fbm(S, 24, 3, 1073), gr = grain(S, 1074);
  for (let y = 0; y < S; y++) {
    // v runs up the slope: each course's lower edge laps over the one below
    const row = Math.floor(y / rh), fy = (y - row * rh + 0.5) / rh, off = (row % 2) * tw * 0.5;
    for (let x = 0; x < S; x++) {
      const i = y * S + x, xx = (x + 0.5 + off) % S, col = Math.floor(xx / tw), fx = (xx - col * tw) / tw;
      const k = (row * Math.ceil(S / tw) + col) % nT;
      const wave = Math.sin(fx * Math.PI); // the pan's curve across
      const shadow = sstep(0.82, 1, fy) * (0.6 + 0.4 * (1 - wave));
      const f = fire[k], ln = sstep(0.8, 0.95, lich[i] + big[i] * 0.3) * (0.5 + 0.5 * wave) * 0.7;
      let R = 0.66 + f * 0.14 - dk[k] * 0.12, G = 0.33 + f * 0.1 - dk[k] * 0.08, Bc = 0.22 + f * 0.05 - dk[k] * 0.05;
      const n = big[i] * 0.03 + gr[i] * 0.04;
      R += n; G += n; Bc += n;
      R = R * (1 - ln) + 0.62 * ln; G = G * (1 - ln) + 0.6 * ln; Bc = Bc * (1 - ln) + 0.45 * ln;
      const s = (1 - shadow * 0.45) * (0.86 + 0.14 * wave);
      h[i] = wave * 0.018 + (1 - fy) * 0.012 + gr[i] * 0.0003 + ln * 0.0005;
      ro[i] = 0.78 + ln * 0.15 + gr[i] * 0.04;
      r[i] = R * s; g[i] = G * s; b[i] = Bc * s;
    }
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.008, aoRad: 3 });
}

/** slate: 2 m a tile, ten 20 cm courses of 25-32 cm slates, split surfaces with a cool sheen. */
function slate(S) {
  const T = 2, N = S * S, ppm = S / T;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const B = blocks(S, 10, 0.25 * ppm, 0.32 * ppm, 1081);
  const tone = perBlock(B.count, 1082, (q) => (q() - 0.5) * 0.1), sheen = perBlock(B.count, 1083, (q) => q());
  const split = fbm(S, 8, 3, 1084, 0.5, 40), gr = grain(S, 1085);
  for (let i = 0; i < N; i++) {
    const k = B.id[i], fy = B.dy[i] / B.hh[i] * 0.5 + 0.5; // 0 at the course's lower edge
    const gap = sstep(-0.6, 0.6, Math.abs(B.dx[i]) - B.hw[i] + 1);
    const shadow = sstep(0.85, 1, fy);
    const v = (0.25 + tone[k] * 0.8 + split[i] * 0.03 + gr[i] * 0.03) * (1 - shadow * 0.4) * (1 - gap * 0.5);
    h[i] = (1 - fy) * 0.006 + split[i] * 0.0006 - gap * 0.002;
    ro[i] = 0.5 + sheen[k] * 0.25 + split[i] * 0.06;
    r[i] = v * 0.93; g[i] = v * 0.98; b[i] = v * 1.08;
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.003, aoRad: 2 });
}

/** standing-seam sheet, shared by copper and zinc: seams every 50 cm down the slope (along v). */
function seams(S, T, x, ppm) {
  const sw = 0.5 * ppm, fx = ((x + 0.5) % sw) / sw;
  const dd = Math.min(fx, 1 - fx) * sw; // px from the nearest seam
  return { ridge: sstep(3, 0.5, dd), near: sstep(8, 2, dd) };
}
/** copper: 2 m a tile. Verdigris patina in run-down streaks over brown copper, standing seams. */
function copper(S) {
  const T = 2, N = S * S, ppm = S / T;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const streak = fbm(S, 48, 3, 1091, 0.5, 6), big = fbm(S, 4, 3, 1092), gr = grain(S, 1093);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, sm = seams(S, T, x, ppm);
    const pat = sstep(-0.1, 0.35, 0.6 + streak[i] * 0.3 + big[i] * 0.25 - sm.near * 0.35) * (0.9 + 0.1 * streak[i]);
    const R = 0.42 * (1 - pat) + 0.36 * pat, G = 0.27 * (1 - pat) + 0.62 * pat, B2 = 0.18 * (1 - pat) + 0.52 * pat;
    const n = gr[i] * 0.04 + big[i] * 0.03;
    h[i] = sm.ridge * 0.02 + gr[i] * 0.0002 + pat * 0.0002;
    ro[i] = 0.4 + pat * 0.35 + gr[i] * 0.04;
    r[i] = R + n; g[i] = G + n; b[i] = B2 + n;
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.004, aoRad: 2 });
}
/** zinc: 2 m a tile. Grey sheet, pale oxide in streaks, standing seams. */
function zinc(S) {
  const T = 2, N = S * S, ppm = S / T;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const streak = fbm(S, 48, 3, 1101, 0.5, 6), big = fbm(S, 4, 3, 1102), gr = grain(S, 1103);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, sm = seams(S, T, x, ppm);
    const ox = sstep(0.45, 0.85, 0.5 + streak[i] * 0.35 + big[i] * 0.2);
    const v = 0.6 + ox * 0.15 + big[i] * 0.04 + gr[i] * 0.02 - sm.near * 0.04;
    h[i] = sm.ridge * 0.02 + gr[i] * 0.0001;
    ro[i] = 0.38 + ox * 0.3 + big[i] * 0.05;
    r[i] = v * 0.98; g[i] = v; b[i] = v * 1.03;
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 0.004, aoRad: 2 });
}

/** painted joinery: 1 m a tile, grain along u under satin paint that has flaked off in a few spots. */
function paintwood(S) {
  const T = 1, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S), tint = F(S);
  const warp = fbm(S, 2, 3, 1111, 0.5, 6), gr = grain(S, 1112), flake = fbm(S, 16, 4, 1113), big = fbm(S, 3, 3, 1114);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const ring = Math.sin(((y / S) * 36 + warp[i] * 1) * Math.PI * 2) * 0.5 + 0.5;
    const fl = sstep(1.25, 1.3, flake[i] + gr[i] * 0.03); // (rare)
    const v = 0.9 + big[i] * 0.03 + gr[i] * 0.02 - Math.pow(ring, 8) * 0.03;
    h[i] = -Math.pow(ring, 8) * 0.0002 - fl * 0.0003 + gr[i] * 0.00005;
    ro[i] = 0.45 + big[i] * 0.06 + fl * 0.35;
    const wv = 0.42 - Math.pow(ring, 6) * 0.15;
    r[i] = v * (1 - fl) + wv * fl; g[i] = v * (1 - fl) + wv * 0.75 * fl; b[i] = v * (1 - fl) + wv * 0.55 * fl;
    tint[i] = 1 - fl * 0.85;
  }
  return bake(S, T, { h, ro, r, g, b, tint, aoDepth: 0.0004, aoRad: 1 });
}

/** stained glass: 1 m a tile. Pieces of deep blue, ruby, gold, green and violet in black lead cames. */
function stained(S) {
  const T = 1, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const nc = 9, st = cells(S, nc, 1121), gr = grain(S, 1122), fine = fbm(S, 32, 2, 1123);
  const PAL = [[0.1, 0.18, 0.55], [0.1, 0.18, 0.55], [0.55, 0.06, 0.08], [0.8, 0.55, 0.12], [0.12, 0.38, 0.18], [0.35, 0.12, 0.45], [0.75, 0.72, 0.6]];
  const pr = rng(1124), pick = new Int32Array(nc * nc).map(() => Math.floor(pr() * PAL.length));
  for (let i = 0; i < N; i++) {
    const lead = sstep(0.06, 0.03, st.f2[i] - st.f1[i]);
    const c = PAL[pick[st.id[i]]], k = (1 + fine[i] * 0.2 + gr[i] * 0.1) * (1 - lead);
    h[i] = lead * 0.002 + fine[i] * 0.0002;
    ro[i] = 0.15 + lead * 0.6;
    r[i] = c[0] * k + 0.04 * lead; g[i] = c[1] * k + 0.04 * lead; b[i] = c[2] * k + 0.045 * lead;
  }
  return bake(S, T, { h, ro, r, g, b, tint: 0, aoDepth: 0.001, aoRad: 1 });
}

/** river ripples: 4 m a tile of crossing swells (seamless) as slopes; the colour is the river's. */
function ripple(S) {
  const T = 4, N = S * S;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S);
  const waves = [[3, 1, 1.0], [-2, 3, 0.8], [5, -2, 0.5], [1, 6, 0.4], [-7, -4, 0.25], [9, 5, 0.18], [-4, 11, 0.12]];
  const cs = fbm(S, 8, 2, 1131);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    let v = 0;
    for (const [a, c, amp] of waves) v += Math.sin(((a * x + c * y) / S) * Math.PI * 2 + amp * 7) * amp;
    h[i] = v * 0.012 + cs[i] * 0.004;
    ro[i] = 1; r[i] = 0.5 + cs[i] * 0.04; g[i] = r[i]; b[i] = r[i];
  }
  return bake(S, T, { h, ro, r, g, b, aoDepth: 1, aoRad: 1 });
}

/**
 * The world-scale map every worldMat shares (linear, seamless): r = grime, g = streaks and
 * stains, b = where water pools, a = which of the two tile samples shows (anti-tiling).
 */
// ---------- the freight yard ----------
/**
 * corrugated steel: 2 m a tile, seven trapezoid ribs across u (crests, flanks, troughs), painted
 * (the paint takes the instance colour) over rust that runs down in streaks from the flanks and
 * shows through where the paint has chipped; a few soft dents.
 */
function corrugated(S) {
  const T = 2, n = 7;
  const h = F(S), ro = F(S), r = F(S), g = F(S), b = F(S), tint = F(S);
  const streak = fbm(S, 48, 3, 1131, 0.5, 5), big = fbm(S, 3, 4, 1132), chipN = fbm(S, 16, 4, 1133), gr = grain(S, 1134), dent = fbm(S, 4, 3, 1135);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const f = ((x + 0.5) / S) * n % 1;
    const crest = sstep(0.1, 0.3, f) * (1 - sstep(0.6, 0.8, f));
    const flank = sstep(0.05, 0.2, f) * (1 - sstep(0.3, 0.45, f)) + sstep(0.55, 0.7, f) * (1 - sstep(0.8, 0.95, f));
    const chip = sstep(1.0, 1.05, chipN[i] + big[i] * 0.2 + gr[i] * 0.04);
    const run = sstep(0.55, 0.95, streak[i] * 0.55 + big[i] * 0.35 + flank * 0.2);
    const rust = Math.max(run * 0.75, chip);
    const v = 0.84 + big[i] * 0.04 + gr[i] * 0.025 + crest * 0.05 - flank * 0.04;
    const rr = 0.36 + gr[i] * 0.05 + big[i] * 0.04;
    h[i] = crest * 0.022 + dent[i] * 0.0025 - chip * 0.0003;
    ro[i] = 0.5 + rust * 0.4 + big[i] * 0.05 + gr[i] * 0.03;
    r[i] = v * (1 - rust) + rr * rust; g[i] = v * (1 - rust) + rr * 0.55 * rust; b[i] = v * (1 - rust) + rr * 0.32 * rust;
    tint[i] = 1 - rust * 0.92;
  }
  return bake(S, T, { h, ro, r, g, b, tint, aoDepth: 0.008, aoRad: 3 });
}

function macro(S) {
  const a = fbm(S, 4, 5, 761), c = fbm(S, 8, 4, 762), d = fbm(S, 5, 4, 763), e = fbm(S, 6, 4, 764);
  const out = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    out[i * 4] = Math.round(clamp01(0.5 + a[i] * 0.5) * 255);
    out[i * 4 + 1] = Math.round(clamp01(0.5 + c[i] * 0.5) * 255);
    out[i * 4 + 2] = Math.round(clamp01(0.5 + d[i] * 0.5) * 255);
    out[i * 4 + 3] = Math.round(clamp01(0.5 + e[i] * 0.5) * 255);
  }
  return out;
}

export const GEN = { asphalt, sidewalk, brick, stucco, concrete, granite, grass, sand, siding, shingle, stone, rock, roadpaint, wood, metal, canvas, gravel,
  cobble, setts, flagstone, ashlar, rustic, render, rooftile, slate, copper, zinc, paintwood, stained, ripple,
  corrugated,
};
/** Each set's average colour (sRGB bytes, alpha = tint): what it shows until its pixels land. */
export const AVG = {
  asphalt: [70, 70, 73, 255], sidewalk: [172, 172, 167, 255], brick: [196, 186, 178, 210],
  stucco: [222, 220, 215, 255], concrete: [205, 205, 202, 255], granite: [150, 148, 146, 255],
  grass: [92, 128, 58, 255], sand: [200, 170, 124, 255], siding: [226, 226, 224, 242], shingle: [150, 150, 148, 255],
  stone: [190, 186, 178, 220], rock: [184, 122, 86, 255], roadpaint: [222, 222, 220, 235],
  wood: [196, 196, 196, 255], metal: [228, 228, 228, 250], canvas: [220, 220, 216, 255], gravel: [118, 117, 114, 255],
  cobble: [100, 96, 92, 255], setts: [122, 120, 117, 255], flagstone: [150, 147, 140, 255], ashlar: [200, 196, 188, 230],
  rustic: [168, 164, 156, 230], render: [228, 226, 222, 255], rooftile: [160, 82, 58, 255], slate: [74, 79, 88, 255],
  copper: [100, 150, 130, 255], zinc: [150, 152, 156, 255], paintwood: [228, 228, 228, 250], stained: [70, 50, 110, 0],
  ripple: [128, 128, 128, 255], corrugated: [200, 196, 192, 230],
};
export const SIZE = {
  asphalt: 512, sidewalk: 512, brick: 512, stucco: 512, concrete: 512, granite: 256,
  grass: 512, sand: 512, siding: 256, shingle: 256, stone: 256, rock: 256, roadpaint: 256,
  wood: 256, metal: 256, canvas: 256, gravel: 256,
  cobble: 512, setts: 512, flagstone: 512, ashlar: 512, rustic: 256, render: 512, rooftile: 512, slate: 256,
  copper: 256, zinc: 256, paintwood: 256, stained: 256, ripple: 256, corrugated: 256,
};

/** One surface's colour and detail bytes. */
export function generate(name) {
  if (name === 'macro') return { S: 256, col: null, det: macro(256) };
  const S = SIZE[name];
  return GEN[name](S);
}
