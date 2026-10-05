import * as THREE from 'three';
import { addPhysBox } from '../engine/collision.js';
import { Batch } from '../engine/parts.js';
import { buildStore, buildClothes, buildStation } from '../engine/shops.js';
import { house } from './placeholder.js';
import { CH, GROUND_FLOOR, UPPER_FLOOR } from './plan.js';

/*
  The three reserved buildings (plan.stores: 'gun' and 'clothes' are the two shops on the
  market's south lane, 'police' the town watch house on the embankment street). Their ground
  floors come from engine/shops.js (front door on +z, everything measured from y = 0), built
  here inside a group raised to the old town's ground; above them, ordinary houses (the
  placeholder's upper floors, in the old town's style). Signs use the old town's lettering.
*/

/** A sign: text on bg in fg, a thin rule round it (the old town's shop lettering). */
export function signTex(text, bg, fg) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 512, height: 96 });
  const g = canvas.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 512, 96);
  g.strokeStyle = fg; g.globalAlpha = 0.5; g.lineWidth = 3; g.strokeRect(10, 10, 492, 76); g.globalAlpha = 1;
  g.fillStyle = fg;
  g.font = `600 ${text.length > 10 ? 46 : 54}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 52);
  return Object.assign(new THREE.CanvasTexture(canvas), { colorSpace: THREE.SRGBColorSpace, anisotropy: 4 });
}

/** A batch that adds everything dy higher (for the interiors measured from y = 0). */
class Raised {
  constructor(b, dy) { this.b = b; this.dy = dy; this.geo = b.geo; this.mat = b.mat; this.cast = b.cast; this.site = b.site; }
  add(x, y, z, ...r) { this.b.add(x, y + this.dy, z, ...r); return this; }
}

export function buildSites(C, P) {
  const { M, X, colliders } = C;
  const out = { store: null, clothes: null, station: null };
  for (const k of ['gun', 'clothes', 'police']) {
    const s = P.stores[k];
    if (!s) continue;
    const dy = s.base;
    const h = 3.8 + s.floors * UPPER_FLOOR;
    const b = { x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, h, color: s.colour };
    // the interior's own world: a group at the old town's ground (the lit batches build into it)
    const g = new THREE.Group();
    g.position.y = dy;
    C.scene.add(g);
    g.updateMatrixWorld(true);
    const raise = (bt) => new Raised(bt, dy);
    const caseGlass = C.batch('caseGlass', C.BOX, X.caseGlass, { cast: false });
    const K = {
      body: raise(C.batch('b.stucco', C.BOX, M.stucco)), trim: raise(C.batch('b.trim', C.BOX, M.trim)),
      glass: raise(C.batch('b.shopGlass', C.BOX, M.shopGlass, { cast: false })), caseGlass: raise(caseGlass),
      frame: raise(C.batch('b.frameS', C.BOX, M.iron, { cast: false })), lamp: raise(C.B.glow),
      // the room's own (lamp-lit) batches are made from these and built into the group
      plain: new Batch(C.BOX, X.plain, { cast: false }, C.site), wood: new Batch(C.BOX, M.timber, { cast: false }, C.site),
      metal: new Batch(C.BOX, M.iron, { cast: false }, C.site),
      solid: (x0, x1, z0, z1, y0, y1, extra) => C.solidBox(x0, x1, z0, z1, y0 + dy, y1 + dy, extra),
      phys: (x0, x1, z0, z1, y0, y1, extra = {}) => addPhysBox(colliders, x0, x1, z0, z1, y0 + dy, y1 + dy, { cam: !!extra.cam }),
      scene: g, CH, signTex,
    };
    C.site.anchorAt((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2);
    let info;
    if (k === 'gun') info = out.store = buildStore(b, K);
    else if (k === 'clothes') info = out.clothes = buildClothes(b, K);
    else info = out.station = buildStation(b, K);
    C.site.anchorOff();
    // everything it hands back in world space
    const up = (v) => { if (v?.isVector3) v.y += dy; };
    up(info.lamp?.pos);
    for (const sp of info.spots || []) { up(sp.lie); up(sp.stand); up(sp.tag); }
    for (const v of info.wallRack || []) up(v);
    up(info.mirror); up(info.door);
    for (const p of info.posts || []) up(p.pos);
    // the house above: upper floors in the old town's style, its roof
    const lot = { ...s, seed: (s.x0 * 131 + s.z0 * 7) | 0, fronts: ['zp'], corner: false, groundUse: 'shop', style: 'stucco', age: 0.4, base: dy - (GROUND_FLOOR - 3.8) };
    lot.floors = s.floors;
    C.site.anchorAt((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2);
    house(C, lot, { upperOnly: true });
    C.site.anchorOff();
  }
  return out;
}
