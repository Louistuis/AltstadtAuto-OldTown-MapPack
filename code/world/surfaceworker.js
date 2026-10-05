import { generate } from './surfacegen.js';

// Paints surface sets off the page's thread (see world/surfaces.js): one message per set name.
self.onmessage = (e) => {
  const name = e.data, t0 = performance.now();
  const { col, det } = generate(name);
  const ms = performance.now() - t0;
  self.postMessage({ name, col, det, ms }, col ? [col.buffer, det.buffer] : [det.buffer]);
};
