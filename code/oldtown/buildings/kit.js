import { Batch, BOX, CYL_LO, NEAR, FAR } from '../../engine/parts.js';
import { MergeLayer, Frame } from './merge.js';
import { detailGeos } from './details.js';
import { lampMaterial } from '../../world/glow.js';

/*
  The buildings' share of the level's batches, made once per build context C:
  - L: the merged bodies, one MergeLayer per material (walls, roofs, cornices, panes...), each
    riding on a Batch from C.batch so the layout's "build every batch, collect casters" step
    builds them too (the Batch's build is wrapped to add the merged cell meshes);
  - N: near-only details (lod NEAR, no shadows): joinery, rails, brackets, louvres, signs...;
  - F: far-only stand-ins (lod FAR) for what the near details drop (balcony rails as bars).
*/

export const GH = 4.2; // ground floor storey

// palettes (sRGB hex; tints for white materials, multipliers for coloured ones)
export const TRIMS = [0xf4efe4, 0xeee6d6, 0xe8dfcc, 0xf6f3ec, 0xe2dccf];
export const STONE_TINTS = [0xffffff, 0xf6f1e8, 0xece6da, 0xfaf4ea, 0xe4ded2];
export const BRICK_TINTS = [0xffffff, 0xf0e4dc, 0xe2d2c8, 0xd6c4b8, 0xfff2e6];
export const SHUTTERS = [0x3f5b45, 0x5d7560, 0x6f8796, 0x4e6474, 0x6e2b25, 0x5a4030, 0xb9bcb0, 0xe0d8c0, 0x2f4a5a, 0x7a8a6a];
export const WINFRAMES = [0xf4f1ea, 0xf4f1ea, 0xece4d2, 0xf4f1ea, 0xd8d2c4];
export const OLDFRAMES = [0x3a2a1e, 0x2f3d33, 0x4a3426, 0x5a2a24];
export const SHOPCOLS = [0x1f3a2e, 0x5a1d1d, 0x1d2a44, 0x232323, 0x3e2a1c, 0x2d4a4a, 0x6a4a1a, 0x3b2a40, 0x284d34];
export const AWNINGS = [[0x8a1f1f, 0xf1e6d0], [0x1f4a34, 0xf1e6d0], [0x1d2f55, 0xf1e6d0], [0xb07020, 0xf4ead6], [0x5a2a3a, 0xeee2cc], [0x2a2a2a, 0xe8dcc4], [0x7a2420, 0x7a2420], [0x23412f, 0x23412f]];
export const DOORS = [0x4a2e1c, 0x2f3d33, 0x1d2a44, 0x5a1d1d, 0x3a3a38, 0x6a4a2a];
export const GLASS = [0xffffff, 0xf0f2f4, 0xe6eaee, 0xf4f6fa];
/** A lit window's pane colour (warmer than blue: the glass shows its room with the lights on). */
export const LIT = 0xffd6a0;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** The kit for build context C (made once). */
export function kit(C0) {
  if (C0._bld) return C0._bld;
  let C = C0;
  const { M, site } = C;
  for (const k in M) if (M[k] && !M[k].name) M[k].name = k; // (for draw-call breakdowns)
  const L = {}, N = {}, F = {};
  // every batch made here labels its meshes (userData.batch) for the draw-call breakdowns
  const tag = (b, key) => {
    if (b._bldTag) return b;
    const build = b.build.bind(b);
    b.build = (scene) => { const out = build(scene); for (const m of out) m.userData.batch ||= key; return out; };
    b._bldTag = true;
    return b;
  };
  const cbatch = C.batch;
  C = { ...C, batch: (key, geo, mat, o) => tag(cbatch(key, geo, mat, o), key) };
  const layer = (name, mat, o = {}) => {
    const ml = new MergeLayer(mat, o);
    const b = C.batch('bld.body.' + name, BOX, mat, { cast: o.cast !== false });
    const build = b.build.bind(b);
    b.build = (scene) => { const out = ml.build(scene); for (const m of out) m.userData.batch = 'bld.merged.' + name; return [...build(scene), ...out]; };
    L[name] = ml;
  };
  for (const n of ['stucco', 'stone', 'brick', 'plinth', 'trim', 'timber']) layer(n, M[n], { weather: true });
  for (const n of ['roofTile', 'slate', 'copper', 'zinc', 'iron', 'awning']) layer(n, M[n]);
  // flush or small: no shadow pass of their own
  for (const n of ['frame', 'door', 'gold', 'glass', 'shopGlass', 'stainedGlass']) layer(n, M[n], { cast: false });
  // (glass stays one-sided even in a hall you walk into: from inside it is clear)
  for (const n of ['glass', 'shopGlass', 'stainedGlass']) L[n].oneSided = true;
  // look-alikes share a layer (a draw call less per cell): sandstone is the stone's ashlar,
  // warmer (base colour ratio); shutters are painted wood like the frames
  const ratio = (a, b) => { const A = M[a]?.color, B = M[b]?.color; return A && B ? [Math.min(1, A.r / B.r), Math.min(1, A.g / B.g), Math.min(1, A.b / B.b)] : [1, 1, 1]; };
  L.sandstone = L.stone.alias(ratio('sandstone', 'stone'));
  L.shutter = L.frame.alias(ratio('shutter', 'frame'));
  const G = detailGeos();
  const NC = { cast: false, lod: NEAR };
  const near = (name, geo, mat) => { N[name] = C.batch('bld.near.' + name, geo, mat, NC); };
  near('frame', BOX, M.frame); near('trim', BOX, M.trim); near('plinth', BOX, M.plinth); near('stucco', BOX, M.stucco);
  near('stone', BOX, M.stone); near('iron', BOX, M.iron); near('door', BOX, M.door); near('gold', BOX, M.gold);
  near('timber', BOX, M.timber);
  near('win', G.win, M.frame); near('win6', G.win6, M.frame); near('louvre', G.louvre, M.shutter);
  near('rail', G.rail, M.iron); near('railFancy', G.railFancy, M.iron);
  near('console', G.console, M.trim); near('baluster', G.baluster, M.trim);
  near('zinc', CYL_LO, M.zinc); near('pot', G.pot, M.roofTile);
  // panes are instanced boxes at every distance: the glass looks into a room behind each box
  // (interior mapping reads the instance's own size and centre)
  F.glass = C.batch('bld.pane.glass', BOX, M.glass, { cast: false });
  F.shop = C.batch('bld.pane.shop', BOX, M.shopGlass, { cast: false });
  // lantern glass: dark by day, glowing in the evening (world/glow.js), seen from afar
  F.lamp = C.batch('bld.lamp', BOX, lampMaterial(0xffcf96), { cast: false });
  const FC = { cast: false, lod: FAR };
  F.iron = C.batch('bld.far.iron', BOX, M.iron, FC);
  F.trim = C.batch('bld.far.trim', BOX, M.trim, FC);
  return (C0._bld = { L, N, F, G, M, site, batch: C.batch });
}

/** A window pane u0..u1 x y0..y1 whose face sits at depth w in F (a 2 cm box behind it). */
export function pane(B, F, u0, u1, y0, y1, w, col) {
  if (u1 - u0 < 0.05 || y1 - y0 < 0.05) return;
  F.inst(B.F.glass, (u0 + u1) / 2, (y0 + y1) / 2, w - 0.02, u1 - u0, y1 - y0, 0.02, col);
}
/** The same for a shop window (its room is a lit display). */
export function shopPane(B, F, u0, u1, y0, y1, w, col) {
  if (u1 - u0 < 0.05 || y1 - y0 < 0.05) return;
  F.inst(B.F.shop, (u0 + u1) / 2, (y0 + y1) / 2, w - 0.02, u1 - u0, y1 - y0, 0.02, col);
}

/** Sign batch: made when the atlas exists (buildLots), near-only, no shadow. */
export function signBatch(C, mat) {
  return kit(C).batch('bld.near.sign', detailGeos().plane, mat, { cast: false, lod: NEAR });
}

/**
 * A beam in the wall plane from (ua, ya) to (ub, yb), bw wide, from w0 back to w1 front:
 * front face and its two long sides (half-timbering, braces).
 */
export function beam(F, L, ua, ya, ub, yb, bw, w0, w1, col) {
  const du = ub - ua, dy = yb - ya, l = Math.hypot(du, dy) || 1;
  const pu = (-dy / l) * bw / 2, py = (du / l) * bw / 2;
  const q = [[ua + pu, ya + py], [ub + pu, yb + py], [ub - pu, yb - py], [ua - pu, ya - py]];
  L.poly(q.map(([u, y]) => F.P(u, y, w1)), col, F.dir(0, 0, 1));
  for (const s of [1, -1]) {
    const a = [ua + s * pu, ya + s * py], b = [ub + s * pu, yb + s * py];
    L.quad(F.P(a[0], a[1], w0), F.P(b[0], b[1], w0), F.P(b[0], b[1], w1), F.P(a[0], a[1], w1), col, F.dir(s * pu, s * py, 0));
  }
}

/** A frame on the side of something sticking out of F at u, from w = 0 out to depth: facing -u (dir -1) or +u. */
export function sideFrame(F, u, dir, depth) {
  if (dir < 0) { const [x, , z] = F.P(u, 0, 0); return new Frame(x, z, -F.ux, -F.uz, depth); }
  const [x, , z] = F.P(u, 0, depth);
  return new Frame(x, z, F.ux, F.uz, depth);
}

/** The same wall seen from behind: a frame at depth w facing -n, its u running back the other way. */
export function backFrame(F, len, w) {
  const [x, , z] = F.P(len, 0, w);
  return new Frame(x, z, -F.nx, -F.nz, len);
}
