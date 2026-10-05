import * as THREE from 'three';

/*
  Ground floors for the three special buildings the plan reserves (plan.stores: two shops on the
  market's south lane and the town watch house on the embankment street). In AltstadtAuto they
  are walk-in game interiors; in this pack they are closed shopfront shells in the Old Town's style
  (the upper floors and the roof come from the normal house builder, see oldtown/sites.js).

  b = { x0, x1, z0, z1, h, color }: the footprint, measured from y = 0 (sites.js raises it to the
  street). The front, with the door, faces +z. K = the build kit sites.js hands over.
  Returns { door } (the doorstep, world xz, y from 0).
*/
const STOREY = 3.8, WALL = 0.35;

function shell(b, K, { sign, signBg, signFg, windowTint = 0xffffff }) {
  const { x0, x1, z0, z1 } = b, w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2;
  const col = b.color ?? 0xe6dccb;
  // back and side walls, the floor slab and the ceiling
  K.body.add(cx, STOREY / 2, z0 + WALL / 2, w, STOREY, WALL, col);
  for (const x of [x0 + WALL / 2, x1 - WALL / 2]) K.body.add(x, STOREY / 2, (z0 + z1) / 2, WALL, STOREY, d, col);
  K.plain.add(cx, 0.05, (z0 + z1) / 2, w - 2 * WALL, 0.1, d - 2 * WALL, 0x8a7a68);
  K.plain.add(cx, STOREY - 0.05, (z0 + z1) / 2, w - 2 * WALL, 0.1, d - 2 * WALL, 0xf0ebe0);
  K.solid(x0, x1, z0, z0 + WALL, 0, STOREY);
  K.solid(x0, x0 + WALL, z0, z1, 0, STOREY);
  K.solid(x1 - WALL, x1, z0, z1, 0, STOREY);
  // the front: a central door, shop windows either side on a stone sill, a fascia over them
  const doorW = 1.4, zf = z1 - WALL / 2;
  const leftW = cx - doorW / 2 - x0, rightW = x1 - (cx + doorW / 2);
  K.trim.add(cx, 0.3, zf, w, 0.6, WALL + 0.06, 0xd8d0c0);              // sill / plinth band
  K.trim.add(cx, STOREY - 0.45, zf, w, 0.9, WALL + 0.1, 0xefe8da);     // fascia
  K.body.add(x0 + 0.25, STOREY / 2, zf, 0.5, STOREY, WALL, col);         // end piers
  K.body.add(x1 - 0.25, STOREY / 2, zf, 0.5, STOREY, WALL, col);
  for (const [a, len] of [[x0 + 0.5, leftW - 0.6], [cx + doorW / 2 + 0.1, rightW - 0.6]]) {
    if (len < 0.6) continue;
    K.glass.add(a + len / 2, 1.85, zf, len, 2.3, 0.04, windowTint);
    K.frame.add(a + len / 2, 3.03, zf + 0.05, len, 0.06, 0.06, 0x1f2a24);
    K.frame.add(a + len / 2, 0.68, zf + 0.05, len, 0.06, 0.06, 0x1f2a24);
    for (const e of [a, a + len]) K.frame.add(e, 1.85, zf + 0.05, 0.06, 2.4, 0.06, 0x1f2a24);
    K.solid(a, a + len, z1 - WALL, z1, 0, STOREY);
  }
  K.frame.add(cx, 1.3, zf - 0.05, doorW - 0.1, 2.5, 0.06, 0x3e2a1c);    // the door leaf
  K.body.add(cx, 3.0, zf, doorW, 0.5, WALL, col);                        // over the door
  K.lamp.add(cx, 2.75, zf + 0.25, 0.25, 0.08, 0.12, 0xffffff);           // door light
  // the sign on the fascia
  if (sign) {
    const tex = K.signTex(sign, signBg, signFg);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w - 1, 6), Math.min(w - 1, 6) * 96 / 512), mat);
    m.position.set(cx, STOREY - 0.45, z1 + 0.06);
    K.scene.add(m);
  }
  for (const k of ['plain', 'wood', 'metal']) K[k].build(K.scene);
  return { door: new THREE.Vector3(cx, 0, z1 + 0.6) };
}

/** The shop on the market's south lane, west plot. */
export const buildStore = (b, K) => shell(b, K, { sign: 'Eisenwaren Holm', signBg: '#1f3a2e', signFg: '#e9d9a8' });
/** The shop on the market's south lane, east plot. */
export const buildClothes = (b, K) => shell(b, K, { sign: 'Mode Amsel', signBg: '#5a2a3a', signFg: '#f1e6d0' });
/** The town watch house on the embankment street. */
export const buildStation = (b, K) => shell(b, K, { sign: 'Stadtwache', signBg: '#1d2f55', signFg: '#f1e6d0', windowTint: 0xf0f2f4 });
