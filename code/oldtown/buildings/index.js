import { addPhysBox } from '../../engine/collision.js';
import { kit, signBatch } from './kit.js';
import { signAtlas } from './details.js';
import { planLot, buildHouses } from './house.js';
import { buildCathedral, buildMarketHall, buildTownHall, buildTower } from './landmarks.js';

/*
  The old town's buildings:
  buildLots(C, lots) puts a house on every lot, buildLandmark(C, site) the cathedral, the
  market hall, the town hall or a lone tower. Everything goes into C's batches: the bodies
  merged per cell and material (merge.js), the small details as near-only instances; each
  house adds its own solid(s) to C.colliders.
*/

function ctx(C) {
  const K = kit(C);
  if (!K.colliders) {
    K.colliders = C.colliders;
    K.addPhys = (x0, x1, z0, z1, y0, y1) => addPhysBox(C.colliders, x0, x1, z0, z1, y0, y1, { cam: true });
  }
  return K;
}

/** Every lot's house (and its collision). Call once with all the lots: neighbours and the sign atlas need them together. */
export function buildLots(C, lots) {
  const B = ctx(C);
  const plans = lots.map(planLot);
  // one atlas for every shop name in town
  const signs = plans.filter((P) => P.sign).map((P) => P.sign);
  if (signs.length) {
    const atlas = signAtlas(signs, Math.min(8, C.aniso || 4));
    B.signB = signBatch(C, atlas.mat);
    B.sign = (s) => atlas.cell(s.text, s.bg, s.style);
  }
  buildHouses(B, plans);
  return plans;
}

/** A landmark on its site: { kind: 'cathedral' | 'marketHall' | 'townHall' | 'tower', x0, x1, z0, z1, base, front }. */
export function buildLandmark(C, site) {
  const B = ctx(C);
  const f = { cathedral: buildCathedral, marketHall: buildMarketHall, townHall: buildTownHall, tower: buildTower }[site.kind];
  if (f) f(B, site);
}
