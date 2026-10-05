# 01: Layout

Reference code: `code/oldtown/plan.js` (all of it), output in `data/oldtown-plan.json`.

Prompt:

> Build a deterministic layout generator for a dense central European old town, seeded with
> mulberry32 (seed 20261004 reproduces the original). Units metres, y up, the town spans x and z
> from -200 to 200 inside a town wall (inner face 197, outer 200). Streets and squares stand at
> y = 4.0, pavements 0.14 higher, a river channel runs along x between embankment walls at z = 22
> and z = 56 with 5 m lower quays at y = 1.2 and water at y = 0.62.
>
> 1. Traffic grid: streets along z at x = -112 (Weidengasse), -8 (Lindenallee, a tram avenue with
>    a 7.5 m carriageway and 4.5 m pavements, no parking) and 94 (Gerbergasse); streets along x at
>    z = -100 (Am Graben), 15 (Uferstrasse, the embankment, pavement 3.5 m on the river side, no
>    parking there) and 148 (Nordring). Ordinary streets: 7 m carriageway, 2.2 m parking and 3 m
>    pavement each side. Each street ends in a gate square (171 to 197) at a gate in the wall.
> 2. A 12 m promenade along the north bank (z 56 to 68).
> 3. Carve these specials first with guillotine cuts along their edges, leaving the given lane
>    width outside each edge: Domplatz -91..-29 x 68..139.3 (no lanes), Marktplatz 14..70 x
>    -70..-20 (4.5 m lanes on west, east and south), town hall site 30..54 x -20..6.3, Amselplatz
>    34..56 x 92..112, Brunnenplatz -74..-56 x -60..-44, two shop plots 23..34 and 47..59 x
>    -91.3..-74.5, a civic plot -46..-33 x -6.5..6.3. Landmark sites: cathedral -76..-44 x 88..134
>    (faces -z), market hall 46..66 x -64..-38 (faces -x), bell tower 51..57 x 112..118.
> 4. Split what is left with lanes (BSP): while the longer side exceeds 40 + rand*22 m, cut across
>    it at 36..64%, keeping 19 m either side; lane width 2.6..3.4 (30%, alleys), 4..5.2 (50%),
>    5.5..7 m (20%). Leftovers thinner than 7.5 m are paved yards; up to six small blocks become
>    pocket squares.
> 5. Lots: blocks under 21 m wide get one through-row of houses; others a perimeter ring 10.5..14 m
>    deep round a courtyard. Lot widths 6.5..8.5 (25%), 8.5..12.5 (60%), 12.5..15 m. Storeys 3 to 6
>    by frontage (squares and avenue 4..5, alleys 3..4), styles stucco / stone / brick /
>    half-timber (half-timber only near the market and the cathedral), roofs gable / hip / mansard
>    / flat with parapet, ground-floor use by frontage, a German shop name, a facade colour from
>    the 18-colour pastel list, a facade jog of -0.45..+0.3 m on lanes and squares.
> 6. Bridges: a three-arch road bridge per north-south street, an iron footbridge at x = 46;
>    quay stretches between them; stairs down to each quay near its ends.
>
> Output the plan as plain data (rectangles x0, x1, z0, z1) so the geometry passes can read it.
