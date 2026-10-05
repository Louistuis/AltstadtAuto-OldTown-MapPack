# 05: Lighting and atmosphere

Reference code: `code/engine/levelkit.js` (TIMES, addSky, setTimeOfDay), `code/world/sky.js`,
`code/world/glow.js`, `code/world/shadows.js`, `code/engine/post.js`, `code/engine/tonecurve.js`,
`code/engine/parts.js` (worldMat: the material shader).

Prompt:

> Light the old town at dusk:
>
> - Sun at 16 degrees elevation from the -x, -z quarter, white, intensity about 2.6; a shadow map
>   (2048 px) in a +-26 m box that follows the player, its centre snapped to whole texels so
>   shadow edges do not crawl; a second shadow map drawn once over the whole town for distant
>   shadows.
> - Physical sky (Preetham: turbidity 4, Rayleigh 1.8, Mie 0.005). Use the same sky without the sun
>   disc, prefiltered, as the environment light. Fog takes the sky's colour toward the horizon,
>   haze 0.0008 per metre, fog 85 to 260 m. A faint hemisphere fill with a warm ground (#4a4238).
> - Exposure about 2.2 overall, white balance (1.07, 1.0, 0.9). Tone curve AgX narrowed to -9.5..+2.2
>   EV with a 1.1 power and 1.1 saturation.
> - Lantern glass emissive at about 8 (blooms), lit windows warm (#ffd6a0) at about 0.9, shop
>   fascias softly self-lit, additive light pools under the lanterns (32% opacity). Windows look
>   into rooms (interior mapping) and some have blinds.
> - Materials: physically based, procedural, sampled in world space, with world-scale grime, rain
>   streaks, splash dirt at the foot of walls and puddles that turn the ground mirror-smooth.
> - Post: HDR target with 4x MSAA, ground-truth AO, bloom from 1.6, contrast 1.06, saturation
>   1.06, vignette 0.2, FXAA.
> - Other times: golden hour (sun 9 degrees, lamps 85%, windows 60%), afternoon (30 degrees), day.
