/*
  AltstadtAuto Old Town: the public entry point.

    import { buildOldTown } from './code/index.js';
    const map = buildOldTown(scene, renderer, { seed: 20261004 });
    // map.group (THREE.Group, already in scene), map.colliders, map.spawn, map.plan
    // every frame: map.update(dt, camera)

  See README.md and PROMPTS/06-integrate-into-existing-game.md.
*/
export { buildOldTown } from './oldtown/index.js';
export { makePlan } from './oldtown/plan.js';
export { planToJSON } from './export/plan-json.js';
export { bakeForExport } from './export/bake.js';
export { makePost, QUALITY, LOOK } from './engine/post.js';
export { makeRenderer, installLook } from './engine/tonecurve.js';
export { TIMES, setTimeOfDay } from './engine/levelkit.js';
export { GLOW } from './world/glow.js';
