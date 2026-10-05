# Provenance of the code in this pack

Every file here was written for AltstadtAuto by Louis Nordbø (with AI coding assistants working
for him), or was written fresh for this pack. Each AltstadtAuto file was checked against the game
repository's history (`git log --follow` and a line-by-line `git blame -C -C -C`, which also catches
code copied between files) before it was included.

Snapshot: AltstadtAuto's (closed-source) game repository at commit `f6105c4` (2026-10-05, main
after Alpha 2.1), also recorded in `code/GAME_COMMIT`. Louis re-exports from newer commits with
`python3 tools/export-from-game.py <game checkout> [ref]`.

Every code file in this pack is Louis Nordbø's own work: either his AltstadtAuto map code, or code
written fresh for this pack. The whole pack is released under the MIT License (see `LICENSE`).

## Old Town generator (`code/oldtown/`)

| File | Origin | First written | Notes |
|---|---|---|---|
| `plan.js` | AltstadtAuto | 2026-10-04 | Unchanged. The layout: streets, river, squares, lanes, blocks, lots, landmarks. |
| `streets.js` | AltstadtAuto | 2026-10-04 | Imports repointed; the plateau tiling loop rewritten for the pack. |
| `river.js` | AltstadtAuto | 2026-10-04 | Imports repointed. River, embankments, quays, stairs, town wall and gates. |
| `bridges.js` | AltstadtAuto | 2026-10-04 | Imports repointed. Three-arch stone road bridges, iron footbridge. |
| `furniture.js` | AltstadtAuto | 2026-10-04 | Imports repointed; the props-kit glue (collision helpers, seats, movable props) and the lamp-pool texture rewritten for the pack. |
| `materials.js` | AltstadtAuto | 2026-10-04 | Imports repointed. |
| `placeholder.js` | AltstadtAuto | 2026-10-04 | Its private random helper replaced by `engine/rng.js`. |
| `sites.js` | AltstadtAuto | 2026-10-04 | Imports repointed to `engine/shops.js`; sign texture code rewritten. |
| `prison.js` | AltstadtAuto | 2026-10-05 | Imports repointed, comments about game hooks reworded. The island jail building. |
| `walklines.js` | AltstadtAuto | 2026-10-04 | The walking-line part of the game's `oldtown/nav.js` only (see Excluded). |
| `streetprops.js` | Written fresh for this pack | 2026-10-05 | Benches, cafe tables and chairs, bins, bike racks, shelters, written for the pack. |
| `index.js` | AltstadtAuto, rebuilt for the pack | 2026-10-04 | Same build order; game-only parts removed; builds into a Group; traffic-signal code rewritten. |
| `buildings/house.js` | AltstadtAuto | 2026-10-04 | Imports repointed. Townhouse generator. |
| `buildings/ground.js` | AltstadtAuto | 2026-10-04 | One comment reworded. Ground floors by use. |
| `buildings/landmarks.js` | AltstadtAuto | 2026-10-04 | Imports repointed. Cathedral, market hall, town hall, clock tower. |
| `buildings/roof.js` | AltstadtAuto | 2026-10-04 | Unchanged. Roofs on any convex footprint. |
| `buildings/merge.js` | AltstadtAuto | 2026-10-04 | Imports repointed. Merged building bodies per cell. |
| `buildings/kit.js` | AltstadtAuto | 2026-10-04 | Imports repointed. Palettes and batches for the buildings. |
| `buildings/details.js` | AltstadtAuto | 2026-10-04 | Imports repointed; the sign-atlas shader hook rewritten. |
| `buildings/index.js` | AltstadtAuto | 2026-10-04 | Imports repointed. |

## Shared world code (`code/world/`)

| File | Origin | First written | Notes |
|---|---|---|---|
| `sky.js` | AltstadtAuto | 2026-10-04 | Unchanged. Physical sky, environment light, sky-coloured fog. |
| `glow.js` | AltstadtAuto | 2026-10-04 | Comments reworded. Lamps and lit windows by time of day. |
| `shadows.js` | AltstadtAuto | 2026-10-04 | Comments reworded. Far shadow map over the whole town. |
| `surfaces.js` | AltstadtAuto | 2026-10-04 | Import repointed; `surfacesPending()` added. Procedural PBR textures. |
| `surfacegen.js` | AltstadtAuto | 2026-10-04 | Import repointed. The texture painters (cobbles, setts, render, ashlar, tiles...). |
| `surfaceworker.js` | AltstadtAuto | 2026-10-04 | Unchanged. Paints the textures in a worker. |

## Engine pieces (`code/engine/`)

| File | Origin | Notes |
|---|---|---|
| `parts.js` | AltstadtAuto (materials) + written fresh (instancing) | `worldMat`, `windowGlass`, `waterMat` are AltstadtAuto's own shader work (2026-10-04), with the vertex-shader skeleton rewritten for the pack. `Batch`, `ChunkSite`, the unit shapes and `updateLod` were written fresh for this pack. |
| `levelkit.js` | AltstadtAuto + written fresh | The times of day, `setTimeOfDay` and `placeSun` are AltstadtAuto's own; `addSky` (lights and shadow setup) and `shadowLayerPass` were written fresh. |
| `post.js` | AltstadtAuto | The post chain (AO, bloom, grade, FXAA), 2026-10-04. Comments reworded. |
| `tonecurve.js` | AltstadtAuto + written fresh | `installLook` (the AgX look) is AltstadtAuto's own; `makeRenderer` written fresh. |
| `collision.js` | Written fresh | Records walk boxes, discs and physics solids as plain data, written for the pack. |
| `rng.js` | Written fresh | A fresh implementation of the public-domain mulberry32 generator, so seeds give the same town as in the game. |
| `vec.js` | Written fresh | One helper. |
| `parking.js` | AltstadtAuto data + written fresh | Vehicle lengths, the parked mix and the paint palettes from AltstadtAuto's own vehicle work; the module itself is new. |
| `shops.js` | Written fresh | Shopfront shells for the three reserved buildings (the game has walk-in interiors there). |

## Export and viewer

`code/export/plan-json.js`, `code/export/bake.js`, `code/index.js`, `viewer/index.html`, the
root `index.html` and `tools/export-from-game.py` were written fresh for this pack.

## Excluded from the pack

| Left out | Why |
|---|---|
| The game's engine-level instancing, collision, random and props modules | Game engine code, not map code: the pack has its own small replacements in `engine/` and `oldtown/streetprops.js`. |
| The pedestrian graph and signal timing of the game's `oldtown/nav.js` | Game AI code; `walklines.js` keeps the map part (the walking lines). |
| Ambience (river, bells, birds) | Game audio. |
| ATMs and street crime, the jail's escape gameplay, police, NPCs, traffic, multiplayer, physics engine, game state, settings, UI, music, fonts | Game-only systems, not part of the map. |
| `oldtown/buildings/testlevel.js` | A development test bed. |

Third-party libraries are loaded from a CDN at runtime and are not included: three.js 0.169.0 (MIT).
