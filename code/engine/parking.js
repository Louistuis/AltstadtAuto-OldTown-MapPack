/*
  What the Old Town parks at its kerbs. The generator only needs each vehicle kind's length (to
  space the parking bays) and a paint colour; it records every parked vehicle in map.parking as
  { x, z, y, yaw, kind, color, length } for a game to spawn its own vehicles there. The viewer
  draws them as simple painted blocks.
*/

// lengths and widths in metres of AltstadtAuto's vehicle line-up
export const SPECS = {
  city: { L: 3.96, W: 1.74, H: 1.48 },
  classic: { L: 3.46, W: 1.56, H: 1.38 },
  saloon: { L: 4.52, W: 1.8, H: 1.44 },
  estate: { L: 4.62, W: 1.82, H: 1.5 },
  coupe: { L: 4.32, W: 1.86, H: 1.28 },
  van: { L: 4.46, W: 1.84, H: 2.0 },
  scooter: { L: 1.5, W: 0.6, H: 1.1 },
};
SPECS.taxi = { ...SPECS.saloon };
SPECS.police = { ...SPECS.estate };

/** What is parked at a kerb, from a draw t in 0..1 (the town's mix). */
export const parkedKind = (t) => (t < 0.3 ? 'city' : t < 0.45 ? 'classic' : t < 0.62 ? 'saloon' : t < 0.78 ? 'estate' : t < 0.88 ? 'van' : t < 0.95 ? 'coupe' : 'taxi');

const PALETTE = [0x8c1c1c, 0x1f4e6b, 0xb9bcbf, 0x3b3e42, 0xe9e9e6, 0x161718, 0x24452f, 0xe2d7bd, 0xc89b2c, 0x8fb3c9, 0x5c1e2c, 0x8c9a7e, 0xb3542a, 0x6e7c86];
const PASTEL = [0x9cc9b8, 0xe8d48a, 0xc94a3a, 0x8fb3c9, 0xe2d7bd, 0x24452f, 0xb3542a];
const VAN = [0xe9e9e6, 0xe9e9e6, 0x1f4e6b, 0xc89b2c, 0x24452f, 0xb9bcbf];

/** A paint colour for a kind; pick() returns 0..1 (the generator passes its own). */
export function paintFor(kind, pick = Math.random) {
  if (kind === 'taxi') return 0xe6dbc0;
  if (kind === 'police') return 0xeeefec;
  const list = kind === 'classic' || kind === 'scooter' ? PASTEL : kind === 'van' ? VAN : PALETTE;
  return list[Math.floor(pick() * list.length) % list.length];
}
