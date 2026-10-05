# 06: Integrate into an existing game

Reference code: `code/index.js`, `code/oldtown/index.js` (the options and the returned map),
`code/engine/collision.js` (collider format), `viewer/index.html` (a complete, small host).

Prompt:

> Add the Old Town (this repository) to our three.js game as a level.
>
> 1. Copy `code/` into the game (for example `src/maps/oldtown/`). It is plain ES modules that
>    import `three` and `three/addons/...`; make sure the game's import map or bundler resolves
>    them (three.js 0.160 or newer; 0.169 is tested).
> 2. Build it once when the level loads:
>    ```js
>    import { buildOldTown } from './maps/oldtown/index.js';
>    const map = buildOldTown(scene, renderer, { seed: 20261004, sky: true });
>    ```
>    `sky: false` keeps the game's own sky and lights (the town still gets its environment map).
>    `map.group` is already in the scene.
> 3. Every frame: `map.update(dt, camera)` (LOD swap, sun shadow box, traffic lights).
> 4. Physics: create static bodies from `map.colliders.solids` (`type: 'box'` = centre x, y, z
>    and full size w, h, d; `type: 'cyl'` = upright cylinder, centre, radius r, height h). For a
>    simple character controller use `map.colliders.boxes` / `circles` (walkable tops) instead.
> 5. Spawn the player at `map.spawn` facing `map.spawnYaw`. NPC spots: `map.walk.lines`;
>    seats: `map.seats`; parked vehicles: `map.parking` (spawn the game's own cars there).
> 6. If the game's unit is not metres, scale `map.group` and the collider numbers together; if the
>    game is z-up, rotate the group -90 degrees about x and swap the collider axes.
> 7. License: MIT (keep LICENSE with the code). Credit appreciated: "Old Town map by Louis
>    Nordbø, from AltstadtAuto (https://wta.lou15.com)."
>
> Not three.js? Import `data/oldtown-medium.glb` (plain meshes with vertex colours, no custom
> shaders, Draco-compressed), or export a fresh one from `viewer/index.html` with "Export .glb"; read colliders, spawn and furniture from
> `data/oldtown-plan.json` (same formats as above).
