/*
  Seeded random numbers for the Old Town generator.

  The generator is a fresh implementation of mulberry32, a public-domain 32-bit PRNG. The same
  seed always gives the same sequence, so the same seed always gives the same town.

    const R = rng(1234);
    R()            a float in [0, 1)
    R.range(a, b)  a float in [a, b)
    R.int(a, b)    an integer in [a, b] (both ends included)
    R.pick(list)   one element of list
*/
export function rng(seed) {
  let state = seed >>> 0;
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    z = (z ^ (z >>> 14)) >>> 0;
    return z / 4294967296;
  }
  next.range = (a, b) => a + (b - a) * next();
  next.int = (a, b) => Math.floor(a + (b - a + 1) * next());
  next.pick = (list) => list[Math.floor(next() * list.length)];
  return next;
}
