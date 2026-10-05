import { rng } from '../engine/rng.js';

/*
  The old town's plan, deterministic from a seed: the traffic grid, the river and its quays,
  the squares, the lanes and alleys cut through the blocks, the blocks' lots and the landmark
  sites. Everything axis-aligned (the engine's collision is boxes and upright cylinders); the
  old-town feel comes from irregular block sizes, lane widths that vary, squares of different
  character and the buildings themselves.

  Heights: the world's floor (y = 0) is the river bed, so the town stands on a plateau at T and
  the lower quays sit between the two. Everything else in the old town is measured from these.
*/

export const T = 4;            // street level: lanes, squares, carriageways
export const CH = 0.14;        // kerb: pavements stand this much above the carriageway
export const QY = 1.2;         // the lower quays along the river
export const WY = 0.62;        // the water's surface
export const B = 197;          // inner face of the town wall
export const WALL = 200;       // its outer face
export const END = 191;        // where the traffic turns round (traffic U-turns at END - 5 +- 3.8)
/** Traffic lanes 1.75 m right of the centre line; stop lines and junction exits from the junction centre. */
export const ROAD = { lane: 1.75, stop: 7.8, exit: 6.6 };
/** The river channel between its embankment walls (runs along x), and the quays inside it. */
export const RIVER = { z0: 22, z1: 56, q0: 27, q1: 51 };
/** The riverside promenade along the north bank. */
export const PROM = { z0: 56, z1: 68 };
export const GROUND_FLOOR = 4.2, UPPER_FLOOR = 3.2;

// traffic streets: c = centre line, carr = half the carriageway, n / p = the low / high side's
// parking lane and pavement widths
const side = (park, pave) => ({ park, pave });
export const XSTREETS = [ // running along z, at x = c (they cross the river on bridges)
  { id: 'xw', c: -112, carr: 3.5, n: side(2.2, 3), p: side(2.2, 3), name: 'Weidengasse', kind: 'street' },
  { id: 'xa', c: -8, carr: 3.75, n: side(0, 4.5), p: side(0, 4.5), name: 'Lindenallee', kind: 'avenue', tram: true },
  { id: 'xe', c: 94, carr: 3.5, n: side(2.2, 3), p: side(2.2, 3), name: 'Gerbergasse', kind: 'street' },
];
export const ZSTREETS = [ // running along x, at z = c
  { id: 'zs', c: -100, carr: 3.5, n: side(2.2, 3), p: side(2.2, 3), name: 'Am Graben', kind: 'street' },
  { id: 'zq', c: 15, carr: 3.5, n: side(2.2, 3), p: side(0, 3.5), name: 'Uferstrasse', kind: 'embankment' },
  { id: 'zn', c: 148, carr: 3.5, n: side(2.2, 3), p: side(2.2, 3), name: 'Nordring', kind: 'street' },
];
for (const s of [...XSTREETS, ...ZSTREETS]) {
  s.axis = XSTREETS.includes(s) ? 'z' : 'x'; // the axis it runs along
  s.lo = s.c - s.carr - s.n.park - s.n.pave;  // building lines
  s.hi = s.c + s.carr + s.p.park + s.p.pave;
  s.kerbLo = s.c - s.carr - s.n.park;          // kerb lines (outside the parking lanes)
  s.kerbHi = s.c + s.carr + s.p.park;
}
const STREETS = [...XSTREETS, ...ZSTREETS];

// ---------- rects ----------
const R4 = (x0, x1, z0, z1, extra) => ({ x0, x1, z0, z1, ...extra });
const inside = (r, x, z, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
const overlap = (a, b, m = 0) => a.x0 < b.x1 - m && a.x1 > b.x0 + m && a.z0 < b.z1 - m && a.z1 > b.z0 + m;
const clip = (a, b) => R4(Math.max(a.x0, b.x0), Math.min(a.x1, b.x1), Math.max(a.z0, b.z0), Math.min(a.z1, b.z1));
export { inside, overlap };

/**
 * The special rects every superblock is carved round: squares, landmark sites, the gate squares
 * at the street ends. `lanes` = the width of the lane hugging each side (0: buildings front it
 * directly). Squares are open ground; sites get the landmarks (buildings/landmarks.js).
 */
function specials() {
  const S = [];
  // the cathedral square (Domplatz): opens onto the promenade, single rows of houses either side
  S.push(R4(-91, -29, PROM.z1, 139.3, { type: 'square', kind: 'cathedral', name: 'Domplatz', lanes: { xn: 0, xp: 0, zn: 0, zp: 0 } }));
  // the market square, lanes round three sides; the town hall closes its north side
  S.push(R4(14, 70, -70, -20, { type: 'square', kind: 'market', name: 'Marktplatz', lanes: { xn: 4.5, xp: 4.5, zn: 4.5, zp: 0 } }));
  S.push(R4(30, 54, -20, 6.3, { type: 'site', kind: 'townHall', front: 'zn', lanes: { xn: 4.5, xp: 4.5, zn: 0, zp: 0 } }));
  // the little café square in the north quarter, lanes leading in
  S.push(R4(34, 56, 92, 112, { type: 'square', kind: 'cafe', name: 'Amselplatz', lanes: { xn: 3.5, xp: 4, zn: 3, zp: 3.5 } }));
  // a small square with a well where three lanes meet, west of the avenue
  // the gun shop and the clothes shop face the market across its south lane (doors on +z: engine/shops.js)
  S.push(R4(23, 34, -91.3, -74.5, { type: 'store', kind: 'gun', lanes: {} }));
  S.push(R4(47, 59, -91.3, -74.5, { type: 'store', kind: 'clothes', lanes: {} }));
  // the police station on the embankment street, its car at the kerb out front
  S.push(R4(-46, -33, -6.5, 6.3, { type: 'store', kind: 'police', lanes: {} }));
  S.push(R4(-74, -56, -60, -44, { type: 'square', kind: 'well', name: 'Brunnenplatz', lanes: { xn: 3.5, xp: 3, zn: 3.5, zp: 3 } }));
  return S;
}

// ---------- names ----------
const SURN = ['Lindqvist', 'Amsel', 'Falkner', 'Holm', 'Brandt', 'Wendel', 'Kessler', 'Marten', 'Oswin', 'Thalberg', 'Rauch', 'Seidl',
  'Vogt', 'Hagen', 'Ebner', 'Korff', 'Lenz', 'Moser', 'Pfeil', 'Reiter', 'Sander', 'Stroh', 'Ulmer', 'Wirth', 'Zell', 'Albrecht',
  'Bergmann', 'Corvin', 'Dorn', 'Eckart', 'Fenn', 'Gall', 'Haas', 'Ivo', 'Jansen', 'Kranich', 'Lorenz', 'Mahler', 'Nolde', 'Orff'];
const NAMES = {
  cafe: ['Café %', 'Kaffeehaus %', 'Café zur Linde', 'Café Amsel', 'Café Mondschein', 'Café am Markt', 'Rösterei %', 'Café Sperling', 'Café Bellini'],
  restaurant: ['Gasthaus %', 'Trattoria Vela', 'Weinstube %', 'Zum goldenen Hirsch', 'Bistro Marelle', 'Brasserie Lune', 'Gaststube %', 'Osteria Fiume', 'Zur alten Mühle'],
  bakery: ['Bäckerei %', 'Backstube %', 'Konditorei %', 'Brotzeit %', 'Patisserie Clair'],
  pharmacy: ['Apotheke am Dom', 'Stadt-Apotheke', 'Löwen-Apotheke', 'Brücken-Apotheke', 'Apotheke %'],
  bank: ['Bankhaus %', 'Sparkasse Altmerin', 'Kontor %'],
  gallery: ['Galerie Nordlicht', 'Galerie %', 'Kunsthandlung %', 'Atelier %'],
  shop: ['Buchhandlung %', 'Uhrmacher %', 'Hutmacher %', 'Blumen %', 'Feinkost %', 'Papeterie %', 'Antiquariat %', 'Weinhandel %',
    'Tabak %', 'Schuhhaus %', 'Optik %', 'Spielwaren %', 'Kolonialwaren %', 'Leder %', 'Musikalien %', 'Käserei %', 'Eisenwaren %',
    'Teehaus %', 'Juwelier %', 'Mode %', 'Kerzen %', 'Seifen %'],
};
function shopName(R, use) {
  const L = NAMES[use] || NAMES.shop;
  return R.pick(L).replace('%', R.pick(SURN));
}

// facade tints for stucco: pastel ochre, cream, salmon, pale green, grey-blue, rose, sand
const COLOURS = [0xe8c9a0, 0xefe2c4, 0xe9b89a, 0xcfd8b8, 0xb8c7cf, 0xe6c3c0, 0xdccba4, 0xf0d9a8, 0xc9b28a, 0xe3d3b8,
  0xd8a77c, 0xbfcdbf, 0xe8d0b0, 0xd9c2d0, 0xcdb79a, 0xf2e6d0, 0xc4a57e, 0xe2b98a];

// ---------- the plan ----------
export function makePlan(seed = 20261004) {
  const R = rng(seed);
  const P = {
    seed, T, CH, QY, WY, B, WALL, END, ROAD, RIVER, PROM,
    xstreets: XSTREETS, zstreets: ZSTREETS, streets: STREETS,
    squares: [], sites: [], lanes: [], blocks: [], lots: [], courtyards: [], yards: [],
  };
  const SP = specials();
  // gate squares: each street runs out flush (no kerbs) before its gate in the town wall, room
  // for the traffic to turn round
  for (const s of STREETS) for (const sg of [-1, 1]) {
    const a0 = sg > 0 ? END - 20 : -B, a1 = sg > 0 ? B : -END + 20;
    const r = s.axis === 'z' ? R4(s.lo, s.hi, a0, a1) : R4(a0, a1, s.lo, s.hi);
    P.squares.push({ ...r, kind: 'gate', name: 'Tor', street: s.id, end: sg });
  }
  for (const s of SP) if (s.type === 'site') P.sites.push({ kind: s.kind, x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, base: T, front: s.front });
  // landmark sites inside squares
  P.sites.push({ kind: 'cathedral', x0: -76, x1: -44, z0: 88, z1: 134, base: T, front: 'zn' });
  P.sites.push({ kind: 'marketHall', x0: 46, x1: 66, z0: -64, z1: -38, base: T, front: 'xn' });
  P.sites.push({ kind: 'tower', x0: 51, x1: 57, z0: 112, z1: 118, base: T, front: 'zn' }); // the café square's bell tower

  // the junctions of the traffic grid
  P.junctions = [];
  for (const xs of XSTREETS) for (const zs of ZSTREETS) P.junctions.push({ x: xs.c, z: zs.c, xs, zs });

  // ---------- superblocks: between the street bands, the river and the wall ----------
  const colEdges = [-B, ...XSTREETS.flatMap((s) => [s.lo, s.hi]), B];
  const rowEdges = [[-B, ZSTREETS[0].lo], [ZSTREETS[0].hi, ZSTREETS[1].lo], [PROM.z1, ZSTREETS[2].lo], [ZSTREETS[2].hi, B]];
  const supers = [];
  for (let i = 0; i < colEdges.length; i += 2) for (const [z0, z1] of rowEdges) supers.push(R4(colEdges[i], colEdges[i + 1], z0, z1));
  // the promenade: open ground between the street bands
  for (let i = 0; i < colEdges.length; i += 2) {
    P.squares.push(R4(colEdges[i], colEdges[i + 1], PROM.z0, PROM.z1, { kind: 'promenade', name: 'Uferpromenade' }));
  }

  // ---------- carving: specials first (guillotine cuts along their edges), then lanes at random ----------
  const storeRects = {};
  const sideOf = (s, k) => ({ xn: s.x0, xp: s.x1, zn: s.z0, zp: s.z1 })[k];
  function carve(r, depth = 0) {
    if (r.x1 - r.x0 < 0.5 || r.z1 - r.z0 < 0.5) return;
    const inner = SP.filter((s) => overlap(s, r, 0.3));
    // the rect is (what's left of) one special: emit it
    const whole = inner.find((s) => s.x0 <= r.x0 + 0.3 && s.x1 >= r.x1 - 0.3 && s.z0 <= r.z0 + 0.3 && s.z1 >= r.z1 - 0.3);
    if (whole) { emitSpecial(whole, r); return; }
    if (!inner.length || depth > 40) { bsp(r); return; }
    // cut along a special's edge (its lane outside the special), crossing no other special; of
    // the possible cuts, the one whose pieces are least thin
    let best = null, bestScore = -Infinity;
    for (const s of inner) for (const k of ['xn', 'xp', 'zn', 'zp']) {
      const pos = sideOf(s, k), w = s.lanes?.[k] ?? 0;
      const alongX = k[0] === 'x'; // cut is a line x = pos
      const lo = alongX ? r.x0 : r.z0, hi = alongX ? r.x1 : r.z1;
      if (pos <= lo + 0.3 || pos >= hi - 0.3) continue;
      const a = k[1] === 'n' ? Math.max(lo, pos - w) : pos, b = k[1] === 'n' ? pos : Math.min(hi, pos + w);
      const band = alongX ? R4(a, b, r.z0, r.z1) : R4(r.x0, r.x1, a, b);
      const line = alongX ? R4(pos - 0.01, pos + 0.01, r.z0, r.z1) : R4(r.x0, r.x1, pos - 0.01, pos + 0.01);
      if (SP.some((o) => overlap(o, line, 0.05) || (b > a + 0.01 && overlap(o, band, 0.05)))) continue;
      const pieces = alongX ? [R4(r.x0, a, r.z0, r.z1), R4(b, r.x1, r.z0, r.z1)] : [R4(r.x0, r.x1, r.z0, a), R4(r.x0, r.x1, b, r.z1)];
      let score = Infinity;
      for (const q of pieces) {
        if (q.x1 - q.x0 < 0.05 || q.z1 - q.z0 < 0.05) continue;
        const isSpecial = SP.some((o) => o.x0 <= q.x0 + 0.3 && o.x1 >= q.x1 - 0.3 && o.z0 <= q.z0 + 0.3 && o.z1 >= q.z1 - 0.3);
        if (!isSpecial) score = Math.min(score, Math.min(q.x1 - q.x0, q.z1 - q.z0));
      }
      if (score > bestScore) { bestScore = score; best = { pieces, band, w: b - a, alongX, s }; }
    }
    if (best) {
      const { pieces, band, w, alongX, s } = best;
      if (w > 0.01) addLane(band, alongX ? 'z' : 'x', w, s.type === 'square' ? s.kind : null);
      for (const q of pieces) carve(q, depth + 1);
      return;
    }
    bsp(r);
  }
  function emitSpecial(s, r) {
    if (s.type === 'square') P.squares.push({ ...clip(r, s), kind: s.kind, name: s.name });
    if (s.type === 'store') storeRects[s.kind] = { ...clip(r, s) };
  }
  function addLane(r, axis, w, square = null) {
    const kind = w < 3.6 ? 'alley' : 'lane';
    P.lanes.push({ ...r, axis, w, kind, square });
  }
  // lanes cut at random: the longer side is split until blocks are a comfortable size
  function bsp(r) {
    const W = r.x1 - r.x0, D = r.z1 - r.z0, L = Math.max(W, D);
    const lim = 40 + R() * 22;
    if (L < lim || (W < 12 && D < 12)) { addBlock(r); return; }
    const t = R(), w = t < 0.3 ? R.range(2.6, 3.4) : t < 0.8 ? R.range(4, 5.2) : R.range(5.5, 7);
    const alongX = W >= D; // cut across the longer side: a line x = const
    const lo = alongX ? r.x0 : r.z0, len = L;
    const MIN = 19;
    if (len < 2 * MIN + w) { addBlock(r); return; }
    const a = lo + Math.max(MIN, Math.min(len - MIN - w, len * R.range(0.36, 0.64) - w / 2));
    const b = a + w;
    addLane(alongX ? R4(a, b, r.z0, r.z1) : R4(r.x0, r.x1, a, b), alongX ? 'z' : 'x', w);
    if (alongX) { bsp(R4(r.x0, a, r.z0, r.z1)); bsp(R4(b, r.x1, r.z0, r.z1)); }
    else { bsp(R4(r.x0, r.x1, r.z0, a)); bsp(R4(r.x0, r.x1, b, r.z1)); }
  }
  let pockets = 0;
  function addBlock(r) {
    if (r.x1 - r.x0 < 7.5 || r.z1 - r.z0 < 7.5) { P.yards.push(r); return; } // too thin to build on: paved over
    // now and then a small block is left open: a little square with a tree where the lanes meet
    const W = r.x1 - r.x0, D = r.z1 - r.z0;
    if (pockets < 6 && W * D < 900 && Math.min(W, D) > 13 && Math.abs((r.z0 + r.z1) / 2 - 40) > 40 && R() < 0.45) {
      pockets++;
      P.squares.push({ ...r, kind: 'pocket', name: 'Plätzchen' });
      return;
    }
    P.blocks.push({ ...r, id: P.blocks.length });
  }
  for (const s of supers) carve(s);

  // ---------- what lies beyond a point: for fronts, ground use, paving ----------
  const region = P.region = (x, z) => {
    if (Math.abs(x) > B || Math.abs(z) > B) return { kind: 'wall' };
    if (z > RIVER.z0 && z < RIVER.z1) return { kind: 'river' };
    for (const s of STREETS) {
      const a = s.axis === 'z' ? x : z;
      if (a > s.lo && a < s.hi) {
        const sq = P.squares.find((q) => q.kind === 'gate' && inside(q, x, z));
        return sq ? { kind: 'square', sq, street: s } : { kind: 'street', street: s };
      }
    }
    for (const q of P.squares) if (inside(q, x, z)) return { kind: 'square', sq: q };
    for (const l of P.lanes) {
      if (!inside(l, x, z)) continue;
      // a lane along a square's edge is part of the square
      if (l.square) return { kind: 'square', sq: P.squares.find((q) => q.kind === l.square), lane: l };
      return { kind: l.kind, lane: l };
    }
    for (const y of P.yards) if (inside(y, x, z)) return { kind: 'yard', yard: y };
    for (const st of P.sites) if (inside(st, x, z)) return { kind: 'site', site: st };
    return { kind: 'block' };
  };

  // ---------- lots round every block ----------
  const SIDES = ['zn', 'zp', 'xn', 'xp'];
  const outPt = (r, k, u, d = 1) => {
    // the point d m outside side k at fraction u along it
    if (k === 'zn') return [r.x0 + (r.x1 - r.x0) * u, r.z0 - d];
    if (k === 'zp') return [r.x0 + (r.x1 - r.x0) * u, r.z1 + d];
    if (k === 'xn') return [r.x0 - d, r.z0 + (r.z1 - r.z0) * u];
    return [r.x1 + d, r.z0 + (r.z1 - r.z0) * u];
  };
  const frontage = (r, k) => {
    // what most of side k faces (a few probes along it)
    const kinds = [0.2, 0.5, 0.8].map((u) => region(...outPt(r, k, u)));
    const good = kinds.filter((g) => g.kind !== 'wall' && g.kind !== 'block' && g.kind !== 'site');
    return good.length >= 2 ? good[1] || good[0] : null;
  };
  let lotId = 0;
  const groundUses = (g) => {
    // what a ground floor facing g is likely to be
    if (!g) return ['door'];
    if (g.kind === 'square') {
      if (g.sq.kind === 'market') return ['cafe', 'restaurant', 'bakery', 'shop', 'shop', 'arcade', 'pharmacy', 'cafe'];
      if (g.sq.kind === 'cathedral') return ['cafe', 'gallery', 'shop', 'restaurant', 'shop', 'door', 'bank'];
      if (g.sq.kind === 'cafe') return ['cafe', 'cafe', 'restaurant', 'bakery', 'shop'];
      if (g.sq.kind === 'promenade') return ['cafe', 'restaurant', 'cafe', 'shop', 'gallery', 'door'];
      return ['shop', 'door', 'cafe', 'restaurant'];
    }
    if (g.kind === 'street') {
      if (g.street.kind === 'avenue') return ['shop', 'shop', 'bank', 'cafe', 'pharmacy', 'shop', 'restaurant', 'gallery'];
      return ['shop', 'door', 'shop', 'bakery', 'restaurant', 'cafe', 'pharmacy', 'door'];
    }
    if (g.kind === 'lane') return ['shop', 'door', 'door', 'restaurant', 'gallery', 'cafe', 'bakery'];
    return ['door', 'door', 'door', 'shop'];
  };
  function addLot(x0, x1, z0, z1, fronts, block, corner) {
    const main = fronts[0];
    const cxz = [(x0 + x1) / 2, (z0 + z1) / 2];
    const g = main ? frontage(R4(x0, x1, z0, z1), main) : null;
    const onSquare = g?.kind === 'square', onStreet = g?.kind === 'street';
    const avenue = onStreet && g.street.kind === 'avenue';
    // storeys: taller on the avenue and the big squares, lower in the alleys
    let floors = onSquare || avenue ? R.int(4, 5) : onStreet ? R.int(3, 5) : g?.kind === 'alley' ? R.int(3, 4) : R.int(3, 5);
    if (R() < 0.08) floors += 1;
    floors = Math.min(6, floors);
    const old = Math.hypot(cxz[0] - 30, cxz[1] + 40) < 70 || Math.hypot(cxz[0] + 60, cxz[1] - 110) < 50;
    const t = R();
    const style = old && t < 0.16 ? 'timber' : t < 0.6 ? 'stucco' : t < 0.82 ? 'stone' : t < 0.94 ? 'brick' : 'stucco';
    const rt = R();
    const roof = avenue ? (rt < 0.55 ? 'mansard' : rt < 0.8 ? 'hip' : 'flat-parapet')
      : style === 'timber' ? 'gable' : rt < 0.48 ? 'gable' : rt < 0.66 ? 'hip' : rt < 0.88 ? 'mansard' : 'flat-parapet';
    const groundUse = R.pick(groundUses(g));
    const base = onStreet ? T + CH : T;
    const lot = {
      id: lotId++, seed: (R() * 2 ** 31) | 0, x0, x1, z0, z1, base, fronts, corner: !!corner,
      floors, groundUse, style, colour: R.pick(COLOURS), roof, age: Math.round(R.range(0.15, 0.95) * 100) / 100,
      name: ['door', 'arcade'].includes(groundUse) ? null : shopName(R, groundUse === 'arcade' ? 'shop' : groundUse),
      block: block.id, faces: g?.kind || 'none',
    };
    if (style === 'timber') lot.floors = Math.min(lot.floors, 4);
    // old facades don't keep a line: on lanes and squares each house stands a little forward or back
    if (!corner && main && (g?.kind === 'lane' || g?.kind === 'alley' || (g?.kind === 'square' && g.sq?.kind !== 'gate'))) {
      const d = Math.round(R.range(-0.45, 0.3) * 100) / 100;
      if (main === 'zn') lot.z0 -= d; else if (main === 'zp') lot.z1 += d; else if (main === 'xn') lot.x0 -= d; else lot.x1 += d;
      lot.jog = d;
    }
    P.lots.push(lot);
    return lot;
  }
  /** Split a run [a0, a1] into lot widths 6.5..14 m (corner lots at the ends keep their own width). */
  function widths(a0, a1) {
    const out = [];
    let a = a0;
    while (a < a1 - 0.01) {
      let w = R() < 0.25 ? R.range(6.5, 8.5) : R() < 0.8 ? R.range(8.5, 12.5) : R.range(12.5, 15);
      if (a1 - a - w < 6.5) w = a1 - a;
      if (w > 16.5) w = (a1 - a) / 2;
      out.push([a, a + w]);
      a += w;
    }
    return out;
  }
  for (const b of P.blocks) {
    const W = b.x1 - b.x0, D = b.z1 - b.z0;
    const fr = Object.fromEntries(SIDES.map((k) => [k, frontage(b, k)]));
    const has = (k) => !!fr[k];
    b.fronts = SIDES.filter(has);
    if (!b.fronts.length) continue;
    // a narrow block: one row of houses running right through, front and back both on the street
    if (Math.min(W, D) < 21) {
      const alongX = W >= D; // the row runs along x: lots span the block's depth in z
      const ends = alongX ? ['xn', 'xp'] : ['zn', 'zp'];
      const faces = (alongX ? ['zn', 'zp'] : ['xn', 'xp']).filter(has);
      const a0 = alongX ? b.x0 : b.z0, a1 = alongX ? b.x1 : b.z1;
      const runs = widths(a0, a1);
      runs.forEach(([s, e], i) => {
        const r = alongX ? [s, e, b.z0, b.z1] : [b.x0, b.x1, s, e];
        const f = [...faces];
        if (i === 0 && has(ends[0])) f.push(ends[0]);
        if (i === runs.length - 1 && has(ends[1])) f.push(ends[1]);
        if (!f.length) f.push(faces[0] || ends[0]);
        // the main front: the busier side
        f.sort((p, q) => rank(fr[q]) - rank(fr[p]));
        addLot(...r, f, b, f.length > 1 && f.some((k) => k[0] !== f[0][0]));
      });
      continue;
    }
    // a perimeter block: a ring of houses round a closed courtyard. dz / dx = the depth of the
    // rows along the z / x sides; a leftover too short for a house is taken into the corners
    const d = Math.min(R.range(10.5, 14), Math.min(W, D) / 2);
    const nz = has('zn') + has('zp'), nx = has('xn') + has('xp');
    let dz = d, dx = d;
    if (nz && D - nz * dz < 6.5) dz = D / nz;
    if (nx && W - nx * dx < 6.5) dx = W / nx;
    // corner lots sit in the z rows; with no z rows the x rows run the block's full depth
    const dzn = has('zn') ? dz : 0, dzp = has('zp') ? dz : 0;
    for (const k of ['zn', 'zp']) {
      if (!has(k)) continue;
      const z0 = k === 'zn' ? b.z0 : b.z1 - dz, z1 = k === 'zn' ? b.z0 + dz : b.z1;
      const cn = has('xn'), cp = has('xp');
      const a0 = b.x0 + (cn ? dx : 0), a1 = b.x1 - (cp ? dx : 0);
      if (cn) addLot(b.x0, b.x0 + dx, z0, z1, rankSort([k, 'xn'], fr), b, true);
      if (a1 - a0 > 0.5) for (const [s, e] of widths(a0, a1)) addLot(s, e, z0, z1, [k], b, false);
      if (cp) addLot(b.x1 - dx, b.x1, z0, z1, rankSort([k, 'xp'], fr), b, true);
    }
    for (const k of ['xn', 'xp']) {
      if (!has(k)) continue;
      const x0 = k === 'xn' ? b.x0 : b.x1 - dx, x1 = k === 'xn' ? b.x0 + dx : b.x1;
      if (b.z1 - dzp - (b.z0 + dzn) > 0.5) for (const [s, e] of widths(b.z0 + dzn, b.z1 - dzp)) addLot(x0, x1, s, e, [k], b, false);
    }
    const cy = R4(b.x0 + (has('xn') ? dx : 0), b.x1 - (has('xp') ? dx : 0), b.z0 + dzn, b.z1 - dzp);
    if (cy.x1 - cy.x0 > 1 && cy.z1 - cy.z0 > 1) P.courtyards.push({ ...cy, block: b.id });
  }
  function rank(g) {
    if (!g) return 0;
    if (g.kind === 'square') return g.sq.kind === 'gate' ? 3 : 5;
    if (g.kind === 'street') return g.street.kind === 'avenue' ? 6 : 4;
    if (g.kind === 'lane') return 2;
    return 1;
  }
  function rankSort(list, fr) { return [...list].sort((p, q) => rank(fr[q]) - rank(fr[p])); }

  // neighbours share party walls: keep adjacent heights within two storeys, and colours apart
  for (let i = 1; i < P.lots.length; i++) {
    const a = P.lots[i - 1], c = P.lots[i];
    if (a.block === c.block && Math.abs(a.floors - c.floors) > 2) c.floors = a.floors + Math.sign(c.floors - a.floors) * 2;
    if (a.block === c.block && a.colour === c.colour) c.colour = COLOURS[(COLOURS.indexOf(c.colour) + 5) % COLOURS.length];
  }

  // ---------- the gameplay buildings: carved out as specials, built by the layout (sites.js) ----------
  P.stores = {};
  for (const k of ['gun', 'clothes', 'police']) {
    const r = storeRects[k];
    P.stores[k] = r && { kind: k, ...r, base: k === 'police' ? T + CH : T, floors: 3, colour: { gun: 0xc9b28a, clothes: 0xe6c3c0, police: 0xd6d2c4 }[k], roof: k === 'police' ? 'mansard' : 'gable' };
  }

  // ---------- the river: bridges, quays, stairs ----------
  P.bridges = XSTREETS.map((s) => ({ x: s.c, street: s, kind: 'road', w: s.carr * 2 + (s.kind === 'avenue' ? 6 : 5), carr: s.carr }));
  P.bridges.push({ x: 46, kind: 'foot', w: 4.4, carr: 0 }); // the footbridge from the promenade to the town hall's quarter
  // quay stretches between the bridges (and the water gates in the town wall)
  const spans = P.bridges.map((b) => [b.x - b.w / 2 - 0.8, b.x + b.w / 2 + 0.8]).sort((a, b) => a[0] - b[0]);
  P.quays = [];
  for (const [z0, z1, side] of [[RIVER.z0, RIVER.q0, -1], [RIVER.q1, RIVER.z1, 1]]) {
    let a = -B + 6;
    for (const [s, e] of [...spans, [B - 6, B]]) {
      if (s - a > 12) P.quays.push({ x0: a, x1: s, z0, z1, side });
      a = e;
    }
  }
  // stairs down from the street to each quay stretch, near both ends (against the embankment wall)
  P.stairs = [];
  for (const q of P.quays) {
    const L = q.x1 - q.x0;
    const ends = L > 60 ? [[q.x0 + 2.5, 1], [q.x1 - 2.5, -1]] : [[q.x0 + 2.5, 1]];
    for (const [x, dir] of ends) {
      // a landing at street level through a gap in the parapet, then the flight down along the wall
      const top = q.side < 0 ? T + CH : T, n = Math.ceil((top - QY) / 0.18);
      P.stairs.push({ x, dir, quay: q, z: q.side < 0 ? RIVER.z0 : RIVER.z1, side: q.side, top, n, rise: (top - QY) / n, run: 0.3, landing: 1.6, w: 1.8, len: 1.6 + n * 0.3 });
    }
  }

  // ---------- things standing in the squares (people walk round them) ----------
  P.fountain = { x: 30, z: -46, r: 3.6 };     // the market fountain
  P.well = { x: -65, z: -52, r: 1.6 };        // the well in the Brunnenplatz
  P.cafeTree = { x: 45, z: 102, r: 1.6 };     // the café square's big tree
  P.obstacles = [P.fountain, P.well, P.cafeTree].map((o) => R4(o.x - o.r, o.x + o.r, o.z - o.r, o.z + o.r));

  // ---------- planting: street trees, square trees (empty in this version: furniture.js plants the trees) ----------
  P.treeSpots = [];
  P.planterSpots = [];
  return P;
}
