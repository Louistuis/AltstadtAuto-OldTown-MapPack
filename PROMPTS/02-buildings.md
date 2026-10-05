# 02: Townhouses

Reference code: `code/oldtown/buildings/house.js` (planLot is the full parameter list),
`ground.js` (ground floors), `roof.js` (roofs), `merge.js` (how bodies are merged), `kit.js`
(palettes).

Prompt:

> Write a townhouse generator. Input: a lot { x0, x1, z0, z1, base, fronts (which sides face a
> street: zn, zp, xn, xp), corner, floors, style (stucco | stone | brick | timber), roof (gable |
> hip | mansard | flat-parapet), colour, age 0..1, groundUse, name, seed }. Output: a body whose
> footprint is the lot (corner lots chamfered, rounded, turreted, with an oriel, or square),
> every edge a front facade, a courtyard back or a party wall (party walls blank where a
> neighbour covers them).
>
> - Storeys: ground 4.2 m, first 3.35..3.45, middle 3.12..3.3, top 3.05..3.2. Mansard: the top
>   storey is in the roof.
> - Bays 2.5..3.1 m (stone 2.8..3.3, half-timber 2.1..2.5); windows 42..50% of the bay, real holes
>   with reveals (wall depth 0.25 stucco, 0.34 stone, 0.26 brick, 0.1 timber) and a set-back pane.
> - Piano nobile grander: pediment / segmental / cap over the windows, balcony (full, central,
>   Juliet). Shutters by style (stucco 60%, timber 45%, brick 35%, stone 15%). Quoins or pilaster
>   strips, string courses, sill courses, rusticated ground floors, attic windows, oriels on 14% of
>   wide houses, half-timber jetties of 0.22..0.34 m per storey with timber gables to the street,
>   stepped gables on narrow brick houses.
> - Cornice grand (modillions) / simple / eaves. Roof pitch: hip 34..42 deg, street gable 48..56,
>   other gables 38..50. Dormers over the bays, chimneys on the party walls. Roof material
>   terracotta tile, slate or zinc by style.
> - Ground floor by use: shopfront (pilasters, fascia with the name, stall riser, big panes,
>   recessed door, striped awning), house door with stone surround and fanlight, carriage arch,
>   bank (arched windows, pedimented door), arcade (arches with a walkable passage).
> - Weathering: darker with age, rising damp at the foot, grime under the cornice.
>
> Merge every house body into one mesh per material per 128 m cell (vertex colours carry the
> tints); keep the small parts (window joinery, rails, brackets, signs) as instances that only
> draw within 60 m, with cheap stand-ins beyond.
