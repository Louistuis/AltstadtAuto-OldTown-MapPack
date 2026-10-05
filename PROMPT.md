# The Old Town: master prompt

This file is written to be handed to an AI coding agent (Claude Code, Codex, Cursor, or a person)
together with this repository. Part A tells the agent how to run and integrate the real Old Town
code. Part B is the full design specification, with the real numbers from the code, for
rebuilding the town from scratch in an engine that cannot run JavaScript.

Copy everything from "PROMPT" down into your agent, and point it at this repository.

---

## PROMPT

You are integrating an existing, finished 3D world into a game. The world is the Old Town from
AltstadtAuto by Louis Nordbø: a procedural central European old town at dusk, about 400 x 400
metres inside its town wall, with a river crossed by stone bridges, quays, cobbled lanes and
squares, a market square with a fountain and an iron-and-glass market hall, a Gothic cathedral,
a town hall with a clock tower, a bell tower, town gates in a crenellated wall, an island jail,
and 469 (at the default seed) four to six storey townhouses with shops, cafes and signs. Everything is
generated in code from a seed: there are no model or texture files.

The repository you have:

```
code/index.js                 public entry: buildOldTown, planToJSON, bakeForExport, makePost, makeRenderer
code/oldtown/index.js         the builder: buildOldTown(scene, renderer, options) -> map
code/oldtown/plan.js          the layout from a seed: streets, river, squares, lanes, blocks, lots, landmark sites
code/oldtown/streets.js       the ground: plateau collision, cobbles, setts, flagstones, kerbs, asphalt, zebras, rails
code/oldtown/river.js         water, embankment walls, lower quays, stairs, parapets, the town wall and gates
code/oldtown/bridges.js       three-arch stone road bridges, the iron footbridge
code/oldtown/buildings/       the houses and landmarks:
    house.js                  townhouse generator (a lot -> storeys, bays, windows, balconies, cornice, roof)
    ground.js                 ground floors by use (shopfronts, house doors, arcades, banks)
    roof.js                   roofs on any convex footprint (gable, hip, mansard, flat with parapet, spires)
    landmarks.js              cathedral, market hall, town hall, clock towers
    merge.js                  merges every building body into one mesh per material per 128 m cell
    kit.js, details.js        palettes, window and rail geometry, the shop sign atlas
    index.js                  buildLots(C, lots), buildLandmark(C, site)
code/oldtown/furniture.js     lanterns, trees, benches, cafe terraces, market stalls, fountain, well,
                              tram stops and wires, finger posts, bollards, bins, parked cars and scooters
code/oldtown/streetprops.js   bench, cafe table and chairs, bin, bike rack, shelter
code/oldtown/sites.js         the three reserved buildings (two shops, the town watch house)
code/oldtown/prison.js        the jail on its river island (optional)
code/oldtown/walklines.js     pedestrian lines (for NPC navigation)
code/oldtown/materials.js     the shared material list (cobble, setts, stucco, ashlar, brick, roof tile...)
code/world/surfacegen.js      procedural texture painters (run in a worker by surfaces.js)
code/world/sky.js             physical sky, environment light, sky-coloured fog
code/world/glow.js            lamp and window glow by time of day
code/world/shadows.js         a far shadow map drawn once over the whole town
code/engine/parts.js          world-space PBR materials (worldMat) and the instancing Batch + LOD
code/engine/levelkit.js       sky, sun, times of day, sun shadow box that follows the camera
code/engine/post.js           post chain: ambient occlusion, bloom, colour grade, FXAA
code/engine/tonecurve.js      the AgX tone curve with AltstadtAuto's look, makeRenderer()
code/engine/collision.js      collision output: walk boxes, walk discs, physics solids (plain data)
code/export/plan-json.js      the town as plain JSON (data/oldtown-plan.json is made by it)
code/export/bake.js           the town as plain vertex-coloured meshes for a .glb
viewer/index.html             standalone viewer (fly around, export .glb and .json)
data/oldtown-plan.json        the whole plan, furniture and collision as data
data/oldtown-medium.glb       the static town as a Draco-compressed glTF (medium detail)
```

How it fits together: `buildOldTown` makes the plan (`plan.js`), creates the materials, then
runs the phases in order (ground, river and wall, bridges, houses, landmarks, reserved buildings,
furniture, jail, lamp pools, traffic signals). Every module adds instances to shared batches
(`engine/parts.js` Batch: one InstancedMesh per geometry + material per 64 m tile) or merged
building bodies (`buildings/merge.js`), and records collision in `engine/collision.js` lists. At
the end every batch is built into one `THREE.Group`. The function returns:

```js
const map = buildOldTown(scene, renderer, {
  seed: 20261004,          // layout seed (same seed = same town)
  detailSeed: 4242,        // furniture variation
  sky: true,               // add the Old Town's own sky, sun, fog and environment light to scene
  jail: true,              // build the island jail
  fog: { near: 85, far: 260 },
  shadowRes: 2048,
  time: null,              // or 'day' | 'afternoon' | 'evening' | 'golden'
});
map.group        // THREE.Group with everything visible, already added to scene
map.colliders    // { boxes, circles, solids } in world metres (see code/engine/collision.js)
map.spawn        // THREE.Vector3 on the market square; map.spawnYaw
map.plan         // the plan object (streets, squares, lanes, lots, sites, bridges...)
map.seats, map.parking, map.props, map.lamps, map.walk, map.houses, map.jail
map.update(dt, camera)   // every frame: LOD swap, sun shadow box, traffic lights, lamp pools
map.setTime('golden')    // change the time of day
```

Units are metres, y is up, the town spans x and z from -200 to 200. The river bed is y = 0, the
water y = 0.62, the quays y = 1.2, streets and squares y = 4.0, pavements y = 4.14.

Your task, in order:

1. Run the viewer first to see the world: from the repository root run `python3 -m http.server 8080`
   (or `npx serve .`) and open http://localhost:8080/viewer/. It needs a WebGL2 browser and
   internet access for three.js 0.169 from jsDelivr.
2. Find out what engine and renderer the target game uses.
   - three.js (any version from 0.160 up; 0.169 is tested): copy `code/` into the game, make sure
     the import map (or bundler) resolves `three` and `three/addons/` to the game's three.js, and
     call `buildOldTown(scene, renderer, { sky: false })` if the game has its own sky and lights,
     or `{ sky: true }` to use the Old Town's dusk. Add `map.update(dt, camera)` to the game loop.
     Load `map.colliders` into the game's physics (boxes and upright cylinders only; static
     bodies). Put the player at `map.spawn`. If the game uses a bundler, the worker in
     `code/world/surfaces.js` is created with `new URL('./surfaceworker.js', import.meta.url)`,
     which Vite, webpack 5 and esbuild all understand.
   - Scale: if the game's unit is not one metre, scale `map.group` and the collider numbers by the
     same factor. If the game is z-up, rotate the group by -90 degrees about x.
   - Placement: to put the town elsewhere in a larger world, move `map.group` and offset the
     colliders by the same vector (they are plain numbers in world space).
   - Another engine (Unity, Unreal, Godot, Babylon, PlayCanvas, a custom engine): import
     `data/oldtown-medium.glb` (the static town as plain vertex-coloured meshes, Draco-compressed;
     decompress with `npx @gltf-transform/cli copy` if the engine has no Draco), or make a new one
     with the viewer's "Export .glb" button (`bakeForExport` + three's GLTFExporter). Take
     colliders, spawn, seats, parking, lamps and pedestrian lines from `data/oldtown-plan.json`.
     Rebuild the dusk lighting with Part B section 9.
3. Performance (measured in the viewer): about 1,300 draw calls and 2 million triangles over the
   whole town from the air, 500 to 850 draw calls at street level. Keep the LOD swap (`map.update`) running; on weak devices use `post.setQuality('low')`
   or skip `engine/post.js`, set `shadowRes: 1024`, and consider `jail: false`.
4. The pack is MIT-licensed (keep the LICENSE file with the code). Credit is appreciated
   somewhere players can see it (credits screen or map info):
   "Old Town map by Louis Nordbø, from AltstadtAuto (https://wta.lou15.com)."

Do not rewrite the generator unless asked. Change its inputs (seed, options) and its outputs
(scale, placement, colliders) to fit the game.

---

## Part B: the design specification (for a rebuild from scratch)

Use this when the code cannot be run (for example a C++ or C# engine and you want native
generation). Every number below is taken from the code. Build it as a generator with a seed:
`mulberry32(20261004)` drives the plan, so a faithful port gives the same town.

### 1. Frame, units, heights

- Metres, y up. The walled town spans x, z in [-200, 200]: inner face of the wall at 197, outer
  face at 200. The code calls +z north.
- The river bed is the world floor, y = 0. Water surface 0.62. Lower quays 1.2. The town stands on
  a plateau: streets, lanes and squares at T = 4.0, pavements a kerb (0.14) higher.
- The plateau is solid collision in 16 m tiles, with the river channel cut out.

### 2. Layout logic

1. Lay the traffic grid: three streets running along z (at x = c) and three along x (at z = c):

| id | name | runs along | centre | kind | carriageway | parking each side | pavements |
|---|---|---|---|---|---|---|---|
| xw | Weidengasse | z | x = -112 | street | 7.0 m | 2.2 m | 3 m |
| xa | Lindenallee | z | x = -8 | avenue (tram, tree rows, granite setts) | 7.5 m | none | 4.5 m |
| xe | Gerbergasse | z | x = 94 | street | 7.0 m | 2.2 m | 3 m |
| zs | Am Graben | x | z = -100 | street | 7.0 m | 2.2 m | 3 m |
| zq | Uferstrasse | x | z = 15 | embankment | 7.0 m | 2.2 m town side, none river side | 3 m town side, 3.5 m river side |
| zn | Nordring | x | z = 148 | street | 7.0 m | 2.2 m | 3 m |

   Traffic lanes run 1.75 m either side of the centre line; stop lines 7.8 m from a junction
   centre. Nine junctions. Each street runs out flush (no kerbs) into a gate square from 171 to
   197 at both ends, where a gate tower stands in the wall.
2. The river runs along x between embankment walls at z = 22 and z = 56 (34 m channel), lower
   quays 5 m deep along both walls (z 22 to 27 and 51 to 56), broken by the bridges, with stairs
   down from the street near the ends of each quay stretch (1.8 m wide, 0.18 m rises, 0.3 m
   treads, a 1.6 m landing through a gap in the parapet). The water runs on past the town to
   x = +-330 through water gates in the wall.
3. A promenade 12 m deep runs along the north bank (z 56 to 68): flagstones, a gravel strip with
   lindens every 8 m (z 60.4 to 63.6), lantern posts along the parapet every 16 m, benches every
   12 m facing the water.
4. Superblocks are the rectangles between the street bands, the river, the promenade and the wall.
5. Special rectangles are carved first (guillotine cuts along their edges, each cut leaving a
   lane of the given width outside the special):

| special | x | z | size | notes |
|---|---|---|---|---|
| Domplatz (cathedral square) | -91 to -29 | 68 to 139.3 | 62 x 71 m | opens onto the promenade; single rows of houses either side |
| Cathedral site | -76 to -44 | 88 to 134 | 32 x 46 m | facade faces -z (toward the river) |
| Marktplatz (market square) | 14 to 70 | -70 to -20 | 56 x 50 m | 4.5 m lanes round three sides |
| Market hall site | 46 to 66 | -64 to -38 | 20 x 26 m | inside the square, entrance faces -x |
| Market fountain | centre (30, -46) | | radius 3.6 m | |
| Town hall site | 30 to 54 | -20 to 6.3 | 24 x 26 m | closes the market's north side, faces -z |
| Amselplatz (cafe square) | 34 to 56 | 92 to 112 | 22 x 20 m | big tree at (45, 102), bell tower site 51 to 57 x 112 to 118 |
| Brunnenplatz | -74 to -56 | -60 to -44 | 18 x 16 m | well at (-65, -52), radius 1.6 |
| Two shops | 23 to 34 and 47 to 59 | -91.3 to -74.5 | | facing the market across its south lane |
| Town watch house | -46 to -33 | -6.5 to 6.3 | | on the embankment street |

6. The rest of each superblock is split by lanes (binary space partition): split the longer side
   while it is longer than 40 to 62 m (random per block); lane width is 2.6 to 3.4 m (30%, an
   alley if under 3.6 m), 4 to 5.2 m (50%) or 5.5 to 7 m (20%); keep at least 19 m either side;
   cut at 36 to 64% along. Pieces thinner than 7.5 m become paved yards. Up to six small blocks
   (under 900 m2, both sides over 13 m, away from the river) are left open as little squares
   with a tree (45% chance each).
7. Lots round every block. A block narrower than 21 m gets one row of houses running right
   through (front and back both on a street). Otherwise a perimeter block: a ring of houses 10.5
   to 14 m deep round a gravel courtyard, corner lots in the rows along z. Lot widths along the
   front: 6.5 to 8.5 m (25%), 8.5 to 12.5 m (about 60%), 12.5 to 15 m (the rest), never over 16.5 m,
   never leaving a remainder under 6.5 m.
8. Per lot (from the seed): storeys 4 to 5 on squares and the avenue, 3 to 5 on streets, 3 to 4 on
   alleys, 3 to 5 elsewhere; 8% get one more; at most 6; neighbours in one block stay within two
   storeys. Style: within 70 m of the market (30, -40) or 50 m of the cathedral (-60, 110), 16% are
   half-timbered; otherwise stucco about 60%, stone 22%, brick 12%. Roof on the avenue: mansard
   55%, hip 25%, flat with parapet 20%; half-timbered houses gable; elsewhere gable 48%, hip 18%,
   mansard 22%, flat with parapet 12%. On lanes and squares each facade stands 0.45 m forward to
   0.3 m back from the line. Age 0.15 to 0.95 (weathering). Neighbours never share a colour.
9. Ground floor use by what the lot faces: market square (cafe, restaurant, bakery, shop, arcade,
   pharmacy), cathedral square (cafe, gallery, shop, restaurant, bank, door), cafe square (cafes,
   restaurant, bakery, shop), promenade (cafe, restaurant, shop, gallery), avenue (shops, bank,
   cafe, pharmacy, restaurant, gallery), streets (shops, doors, bakery, restaurant, cafe,
   pharmacy), lanes (shop, doors, restaurant, gallery, cafe, bakery), alleys mostly house doors.
   Shops get German names ("Buchhandlung Amsel", "Café Mondschein", "Apotheke am Dom").

### 3. Townhouses

- Storeys: ground floor 4.2 m; first floor 3.35 to 3.45 m; middle floors 3.12 to 3.3 m; top
  floor 3.05 to 3.2 m. A mansard storey lives in the roof.
- Footprint: the lot rectangle, every edge a front, a corner facet, a courtyard back or a party
  wall. Corner lots get a chamfer, a rounded corner, a turret, an oriel or a square corner.
- Facade grammar, bottom up: ground floor by use; a cornice or string course; upper floors in
  bays (2.5 to 3.1 m; stone 2.8 to 3.3 m; half-timber 2.1 to 2.5 m), each window a real hole with
  reveals and a set-back pane, 42 to 50% of the bay wide; the first floor (piano nobile) grander
  (pediment, segmental or straight caps, a balcony: full, central or Juliet); the top floor
  plainer; quoins or pilaster strips at the ends; a deep cornice with modillions; then the roof
  with dormers over the bays and chimneys on the party walls. Shutters: stucco 60%, half-timber
  45%, brick 35%, stone 15%. Oriels on 14% of wide houses. Half-timbered houses jetty out 0.22 to
  0.34 m per floor and turn a timbered gable to the street; brick gables are often stepped.
- Roof pitch: hip 34 to 42 degrees, gable to the street 48 to 56, other gables 38 to 50. Roof
  material: terracotta pan tiles (most), slate (stone and some stucco houses), zinc (flat roofs,
  some mansards).
- Shopfronts: pilasters, a fascia with the shop's name (lit at dusk), stall riser, big panes, a
  recessed door, a striped awning; blade signs for cafes, bakeries, pharmacies; arcades on some
  market houses.
- Weathering: rising damp at the foot, grime under the cornice, darker with age.
- Palettes (sRGB):
  - stucco: #e8c9a0 #efe2c4 #e9b89a #cfd8b8 #b8c7cf #e6c3c0 #dccba4 #f0d9a8 #c9b28a #e3d3b8 #d8a77c #bfcdbf #e8d0b0 #d9c2d0 #cdb79a #f2e6d0 #c4a57e #e2b98a
  - trim: #f4efe4 #eee6d6 #e8dfcc #f6f3ec #e2dccf
  - shutters: #3f5b45 #5d7560 #6f8796 #4e6474 #6e2b25 #5a4030 #b9bcb0 #e0d8c0 #2f4a5a #7a8a6a
  - window frames: #f4f1ea (mostly), #ece4d2, #d8d2c4; old frames #3a2a1e #2f3d33 #4a3426 #5a2a24
  - shopfronts: #1f3a2e #5a1d1d #1d2a44 #232323 #3e2a1c #2d4a4a #6a4a1a #3b2a40 #284d34
  - awnings (stripe pairs): red #8a1f1f, green #1f4a34, blue #1d2f55, ochre #b07020, plum #5a2a3a, black #2a2a2a, each with cream #f1e6d0
  - doors: #4a2e1c #2f3d33 #1d2a44 #5a1d1d #3a3a38 #6a4a2a
  - lit window: #ffd6a0

### 4. Landmarks

- Cathedral (Gothic, warm limestone #f4e8d6): nave about 14.7 m wide and 20 m to the eaves,
  aisles 9.2 m high, flying buttresses with pinnacles, a polygonal apse (radius about 7.4 m),
  a west front of two square towers (about 8.4 m) rising 35 m in four stages (lancets, then a
  belfry with tall openings), corner pinnacles, octagonal copper spires about 26 m tall with
  lucarnes (the tips about 61 m above the square); a rose window over a portal of four stepped,
  pointed archivolts with colonnettes, a trumeau and a tympanum; a gallery of blind arches with
  statues; stained glass that glows at dusk.
- Market hall (20 x 26 m): brick end walls with a stone-dressed great round arch (up to 6.5 m
  wide, open) and a lunette above; cast-iron columns painted green #2c3a34 in two lines at 27%
  and 73% of the width; nave 11.5 m high under a 30 degree glazed roof, lean-to aisles 6.8 m;
  inside two rows of market stalls with striped canopies, hanging lamps, crates and benches.
- Town hall (24 x 26 m): the house grammar at civic scale in sandstone #faf2e4 with a rusticated
  ground-floor arcade (4.8 m), storeys of 5.2, 4.4 and 3.6 m, central balcony, quoins, a grand
  cornice and a copper hip roof at 32 degrees; a clock tower up to 7.5 m square rising from the
  middle of the front 16 m above the cornice: clock stage with gold faces, an open belfry with
  louvres, an octagonal drum with oculi, a copper dome, lantern, spire and gold ball.
- Bell tower on the cafe square: about 5.6 m square, 24 m high, three string courses, small
  windows, the same clock top as the town hall.
- Town wall: crenellated, gate towers where the six streets meet it, water gates where the river
  passes.
- Island jail (optional): an island in the river (x 112 to 162, z 29 to 49) east of the
  Gerbergasse bridge with a two-storey cell block, a gatehouse, a service wing, a walled yard
  (5.5 m wall) and a watchtower with a searchlight, reached by a stone footbridge from the
  promenade.

### 5. Bridges

- One road bridge per north-south street (x = -112, -8, 94), as wide as the carriageway plus
  5 m (6 m on the avenue): three stone arches over spans z 27 to 34, 35.5 to 42.5 and 44 to 51,
  springing 0.92 m above the riverbed (0.3 m above the water), two piers with pointed cutwaters,
  barrel vaults with ring stones on both faces, solid abutments over the quays, a cornice,
  balustraded parapets with lamp pedestals over the piers (candelabra lamps), pavements behind
  kerbs, tram rails on the avenue's.
- An iron bowstring footbridge at x = 46, 4.4 m wide: ribs arching over a timber deck, hangers,
  railings.

### 6. Streets and ground

- Cobbles (about 11 cm stones) on lanes and alleys with a 0.5 m sett gutter down the middle;
  granite setts (14 x 20 cm) on squares laid in panels between flagstone bands; flagstone
  pavements (50 x 80 cm slabs) behind honed granite kerbs, rounded at junction corners (radius
  2 m) with build-outs 9 m either side of each junction; asphalt carriageways with zebra
  crossings (3 m wide, 0.6 m from the crossing carriageway), setts on the avenue and in the
  parking bays; tram rails set into the avenue; gravel courtyards. No two surfaces overlap.
- Traffic signals on every junction corner: dark green poles 4.6 m tall, pedestrian heads (figure
  and hand) and three-lamp vehicle heads.

### 7. Street furniture

- Lanterns: cast-iron lantern posts at the kerb every ~20 m, alternating sides; wall lanterns on
  iron arms in the lanes every ~13 m, alternating sides; posts round each square (about one per
  18 m of perimeter); candelabra on the bridges; posts along the promenade parapet every 16 m.
  Each throws a soft additive light pool on the ground.
- Trees: two rows on the avenue a metre in from the kerb, lindens on the promenade, rows down
  both sides of the Domplatz every 10 m, one in every little square, a big one on the cafe square.
- Market: the fountain (stone basin, water), stalls. Cafe terraces of round tables with two
  chairs and parasols in front of every cafe and restaurant on a square or the promenade.
  Benches on the promenade (facing the water) and round the squares (facing in), a bin beside
  each. Bins, bike racks and scooters along the pavements; bollards across lane mouths where they
  meet traffic streets; finger posts on the squares; tram stops and overhead wires on the avenue
  (poles at both kerbs every 30 m, contact wire 5.9 m up).
- Parked cars in the parking lanes (about 70% of the bays): city cars 30%, classics 15%, saloons
  17%, estates 16%, vans 10%, coupes 7%, taxis 5%.

### 8. Materials

All materials are physically based and procedural (no image files): a colour map whose alpha says
how much the per-instance tint applies, and a detail map (slope in r, g; roughness in b; cavity in
a). They are sampled in world space (planar by the surface normal: walls by horizontal x height,
floors by x, z; roofs along the slope) so scaled boxes never stretch; small turned pieces (beams,
rails, shutters) use their own axes. A shared world-scale macro map adds grime patches, rain
streaks, splash dirt at the foot of walls and puddles over tens of metres, and blends a second,
rotated sample to hide tiling.

| material | scale (tiles per metre) | look |
|---|---|---|
| cobble | 1/2 | domed stones, polished tops, sandy joints, puddles |
| setts | 1/2 | granite setts |
| flagstone | 1/3 | pavement slabs |
| asphalt | 1/4 | |
| curb | 1/2 | honed granite |
| quay (ashlar) | 1/6 | big weathered blocks, darker low down |
| water | 1/4 | #23383a, mirror-like, two ripple layers drifting |
| stucco (render) | 1/4 | trowelled lime render with patches and hairline cracks, tinted per house |
| stone (ashlar) | 1/4 | limestone courses of 36 cm, #e6dfd0 |
| sandstone | 1/4 | #d9b48a |
| brick | 1/2 | #c27a5e |
| plinth (rustic) | 1/2 | rusticated ground floors, #c2baae |
| trim | 1/2 | fine render #f2ece0 |
| timber | 1 | dark oiled wood #5a4030, grain along each beam |
| roof tile | 1/2 | terracotta pan tiles, 14 cm courses, lichen |
| slate, zinc, copper | 1/2 | grey slate; zinc sheet with oxide; green patina over brown copper |
| glass | | windows that look into rooms (interior mapping: walls, floor, ceiling lights, furniture, blinds), warm when lit |
| stained glass | | glows its own colours at dusk |
| iron | 1 | black-painted wrought iron #2a2b2d |
| awning | 1 | canvas, tinted |
| gold | | clock faces and finials |

### 9. Lighting, time of day, atmosphere

- The Old Town's own time is evening. The sun stands at 16 degrees elevation toward -x, -z (in
  the code's frame), white light at 2.6 x 1.12 x 0.9 intensity with a shadow map that follows the
  player (a box of +-26 m, 2048 px, normal bias 0.02), plus a second shadow map drawn once over
  the whole town for distant shadows.
- Physical sky (Preetham): turbidity 4, Rayleigh 1.8, Mie 0.005; the same sky without the sun disc
  is the prefiltered environment light; fog takes the sky's own colour toward the horizon,
  haze 0.0008 per metre, fog from 85 to 260 m; a faint hemisphere fill (ground #4a4238).
- Exposure 1.45 x 1.5, white balance (1.07, 1.0, 0.9). Tone curve: AgX narrowed to -9.5 .. +2.2
  EV with a 1.1 power and 1.1 saturation look.
- Dusk lights: lantern glass emits at 8 (well into bloom), lit windows at 1.2 x 0.75, shop fascias
  glow; additive light pools under the lanterns at 32% opacity. Golden hour: sun 9 degrees,
  lamps 0.85, windows 0.6.
- Post: 4x MSAA HDR target, ground-truth ambient occlusion from depth, bloom from 1.6 (linear),
  contrast 1.06, saturation 1.06, vignette 0.2, FXAA.

### 10. Performance approach

- Draw everything from a few unit shapes (box, cylinder, cone, sphere, plane, roof prisms) as
  instances: one batch per shape + material, built into one InstancedMesh per 64 m tile, so the
  camera culls by area. Every material compiles to the same shader program: the differences are
  uniforms.
- Merge each building's unique geometry (walls with real window holes, cornices, roofs) into one
  mesh per material per 128 m cell, with a position-only copy per 64 m cell that only the shadow
  pass draws.
- LOD: small detail (window joinery, rails, brackets, signs, louvres) only within 60 m of the
  camera; beyond that cheap stand-ins (a bar for a balcony rail). The swap is per tile, so a
  building changes as a whole.
- Paint the procedural textures in a web worker while the town builds (each texture starts as
  its average colour).
- The result: about 1,300 draw calls and 2 million triangles over the whole town from the air,
  500 to 850 draw calls at street level; 469 houses and about 133,000 instances, built in a few
  seconds in a desktop browser.
