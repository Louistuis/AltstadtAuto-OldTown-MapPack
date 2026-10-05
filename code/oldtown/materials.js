import * as THREE from 'three';
import { worldMat, windowGlass, waterMat } from '../engine/parts.js';
import { surface, plainSet } from '../world/surfaces.js';

/*
  The old town's shared materials, by name. Everything in the level draws with these (no
  per-building materials): Batch instances tint them with their own colour, so a material
  meant to be tinted (stucco, shutters, awnings, paint) is white or near-white here.

  All of them are worldMats (cityparts.js): procedural PBR surface sets (world/surfacegen.js,
  painted in a worker at load) sampled in world space - or, with `local`, along each piece's own
  axes, so grain and scuffs follow a beam, a rail or a shutter whichever way it is turned - with
  relief, roughness and cavity, world-scale grime, rain streaks and splash dirt, puddles on the
  ground, and a second turned sample where a surface would otherwise tile visibly. One shader
  program for the lot (plus its double-sided and flat-shaded variants): every difference is a
  uniform. Glass looks into interior-mapped rooms; the river's ripples drift.

  How they take an instance colour (alpha of each set): stucco, frames, shutters, awnings, iron
  and trim take it fully; ashlar, plinth and brick mostly (their joints keep their own colour);
  the ground, roofs and metals ignore white and are tinted only if given a colour.
  Scale, in texture tiles per metre, follows each set's real size (a cobble is ~11 cm, a sett
  ~14 x 20 cm, a flagstone ~50 x 80 cm, an ashlar course 36 cm, a roof tile course 14 cm).
*/
export function oldTownMaterials(C) {
  const env = C.env;
  const aniso = C.aniso || 4;
  // anisotropy where surfaces are seen at grazing angles (the ground), less on walls and roofs
  const ground = Math.min(8, aniso), wall = Math.min(4, aniso);
  const S = (name, a = wall) => surface(name, a);
  // (o: the worldMat options; the grime colour and amounts read best a little stronger on stone)
  const W = (opts, scale, set, o) => worldMat({ roughness: 1, metalness: 0, ...opts }, scale, set, o);
  const local = { local: 1, grime: 0.15 };
  return {
    // ---------- ground ----------
    // cobbled lanes and side streets: domed stones, polished tops, sandy joints, puddles in the dips
    cobble: W({}, 1 / 2, S('cobble', ground), { dirt: 0.4, wet: 1, grime: 0, tile2: [1, 1, 0, 0.5] }),
    // larger granite setts: squares, the market
    setts: W({}, 1 / 2, S('setts', ground), { dirt: 0.35, wet: 0.8, grime: 0, tile2: [1, 1, 0, 0.5] }),
    // pavement slabs along the streets
    flagstone: W({}, 1 / 3, S('flagstone', ground), { dirt: 0.4, wet: 0.6, grime: 0 }),
    // the few main roads the traffic uses
    asphalt: W({}, 1 / 4, S('asphalt', ground), { dirt: 0.45, wet: 1, grime: 0, tile2: [1, 0.71, 0.13, 0.41] }),
    // kerb stones: honed granite
    curb: W({}, 1 / 2, S('granite'), { dirt: 0.3, grime: 0.15 }),
    // tram rails: polished running top, rusty sides (mapped along the rail)
    rail: W({ color: 0x9a9da0, metalness: 0.85, roughness: 0.9, envMap: env }, 2, S('metal'), { ...local, dirt: 0.5, bump: 0.5 }),
    // river embankment walls and quayside paving: big weathered ashlar, darker low down
    quay: W({ color: 0xb8b0a2 }, 1 / 6, S('ashlar'), { dirt: 0.55, grime: 0.6, wet: 0.5 }),
    // the river: green-brown, mirror-ish, ripples drifting two ways
    water: waterMat({ color: 0x23383a, roughness: 0.06, envMap: env, envMapIntensity: 1.2 }, 1 / 4, S('ripple', 1), { bump: 0.6 }),
    grass: W({}, 1 / 4, S('grass', ground), { dirt: 0.2, grime: 0, tile2: [1, 0.73, 0.21, 0.6] }),
    gravel: W({ color: 0xd8d0c4 }, 1 / 2, S('gravel', ground), { dirt: 0.3, grime: 0, tile2: [1, 0.83, 0.37, 0.71] }),

    // ---------- walls (tinted per building) ----------
    // rendered / painted facades: trowelled lime render with patching and hairline cracks, white
    // until tinted with the building's colour; rain streaks and splash dirt from the macro map
    stucco: W({}, 1 / 4, S('render'), { dirt: 0.35, grime: 0.35 }),
    // limestone ashlar
    stone: W({ color: 0xe6dfd0 }, 1 / 4, S('ashlar'), { dirt: 0.4, grime: 0.5 }),
    // sandstone: the same dressed courses, warmer and rougher
    sandstone: W({ color: 0xd9b48a }, 1 / 4, S('ashlar'), { dirt: 0.45, grime: 0.55, bump: 1.4 }),
    brick: W({ color: 0xc27a5e }, 1 / 2, S('brick'), { dirt: 0.35, grime: 0.45 }),
    // rusticated stone ground floors: deep chamfered joints, rock faces
    plinth: W({ color: 0xc2baae }, 1 / 2, S('rustic'), { dirt: 0.4, grime: 0.6 }),
    // cornices, window surrounds, string courses (stone or painted): fine render, crisp
    trim: W({ color: 0xf2ece0 }, 1 / 2, S('render'), { dirt: 0.25, grime: 0.25, bump: 0.6 }),
    // half-timbering, wooden shopfronts: dark oiled timber, grain along each beam
    timber: W({ color: 0x5a4030, roughness: 1.1 }, 1, S('wood'), { ...local, dirt: 0.3 }),

    // ---------- roofs ----------
    // terracotta pan tiles, each fired a little differently, lichen here and there
    roofTile: W({}, 1 / 2, S('rooftile'), { dirt: 0.35, grime: 0 }),
    slate: W({}, 1 / 2, S('slate'), { dirt: 0.25, grime: 0 }),
    // green patina over brown copper, standing seams: domes, spires
    copper: W({ metalness: 0.15 }, 1 / 2, S('copper'), { dirt: 0.2, grime: 0 }),
    // mansards, flashing: grey sheet with pale oxide
    zinc: W({ metalness: 0.55, envMap: env }, 1 / 2, S('zinc'), { dirt: 0.25, grime: 0 }),

    // ---------- openings and details ----------
    // window panes: rooms behind them (interior mapping), sky in them at a glance; a warm instance
    // colour means the lights are on
    glass: windowGlass({ envMap: env, envMapIntensity: 1.0 }),
    // shop windows: lit displays further back
    shopGlass: windowGlass({ envMap: env, envMapIntensity: 1.0 }, true),
    // painted window frames (tint): satin paint over grain, the odd flake
    frame: W({ roughness: 1.1 }, 2, S('paintwood'), { ...local, dirt: 0.2 }),
    // wooden shutters (tint)
    shutter: W({ roughness: 1.2 }, 1, S('paintwood'), { ...local, dirt: 0.25 }),
    // doors: stained timber
    door: W({ color: 0x6b4a32, roughness: 0.9 }, 1, S('wood'), { ...local, dirt: 0.2 }),
    // railings, balconies, lamps, signs' brackets: black-painted wrought iron
    iron: W({ color: 0x2a2b2d, metalness: 0.4, roughness: 1.1, envMap: env }, 1, S('metal'), { ...local, dirt: 0.3 }),
    // awning fabric (tint)
    awning: W({ side: THREE.DoubleSide }, 1, S('canvas'), { ...local, dirt: 0.4, grime: 0 }),
    // leaded coloured glass, glowing its own colours
    stainedGlass: W({ roughness: 1 }, 1 / 0.9, S('stained'), { dirt: 0.15, grime: 0, glass: 3, glow: 0.55 }),
    // clock faces, finials: gilding
    gold: W({ color: 0xd4a94e, metalness: 1, roughness: 0.32, envMap: env }, 1, plainSet(), { dirt: 0.1, grime: 0 }),
  };
}
