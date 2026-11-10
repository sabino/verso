# Generated artwork

These two original assets were created for the playable-world pass with the built-in image generator. They are bundled locally, included in the offline build, and make no runtime image-service requests. Lossless WebP conversion preserves every RGBA pixel (including transparent pixels).

| File                                     | Role                                                | Rendering contract                                                                                        |
| ---------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/stichos/assets/frontier-title.webp` | Title atmosphere: gathering, workshops, exploration | Cover image only; does not claim to be a gameplay screenshot.                                             |
| `src/stichos/assets/impact-atlas.webp`   | Impact, botanical burst, rift and mining frames     | Four rows × four columns. Cell dimensions derive from the decoded image, not a guessed output resolution. |

`effect-atlas.ts` maps only decorative cues onto the atlas. Hitboxes, cooldowns, hostile telegraphs, deterministic simulation and saved state do not depend on image pixels. Reduced motion or zero effect intensity disables the atlas. The procedural renderer remains available while the image loads or if it fails.

## Effect atlas prompt

+> Use case: stylized-concept

> Asset type: transparent game VFX sprite atlas for a top-down 2D pixel RPG called Verso.
> Create a square 1024x1024 PNG with exactly 4 rows and 4 columns of evenly spaced 256x256 cells. Every cell contains ONE centered isolated effect, ample transparent margin, never touching cell borders. Pixel-art rendering, bold readable clusters, restrained luminous amber, ivory, cyan and violet; no text, no grid lines, no character, no background.
> Row 1: four stages of a golden steel impact spark, from small contact star to expanding burst to dispersing shards to fading dust.
> Row 2: four stages of a cyan botanical magic burst, from small seed of light to curling leaves and runic ring to spreading wisps to fading motes.
> Row 3: four stages of a violet teleport/rift swirl, initial concentric crack, opening vortex, bright elliptical ring, disappearing sparks.
> Row 4: four stages of an amber-orange ore/mining impact, contact flash, flying angular stone shards, spreading debris, fading dust.
> Keep same center and visual scale across each row. Artwork should fit within inner 192x192 pixels of each cell with fully transparent surrounding pixels. Genuine alpha transparency. This is production game artwork, not a mockup. No letters, borders or labels.

## Title prompt

+> Use case: stylized-concept

> Asset type: widescreen title background for a top-down pixel-art exploration, production, and tactical RPG called Verso.
> Create a beautiful 16:9 illustrated pixel-art vista. The right half shows a small frontier village with three readable workshops, a sawmill beside golden timber, an ore sorting machine emitting warm sparks, green propagation beds with luminous cyan leaves, stone road leading toward a ruined observatory, and a lone small cloaked adult traveler seen from behind. Distant hazy violet mountain silhouettes and two small moons under a blue dusk sky. Original world, charming but grounded, chunky deliberate pixel clusters and soft restrained atmospheric light, like a meticulously made 1990s computer RPG, not smooth vector art or modern 3D.
> Composition: lower-right village framed by tall dark trees, panoramic horizon upper third. Left 45 percent is low-contrast dark navy-blue woodland shadows with very little detail for readable interface text, fade smoothly into the detailed right half. Warm amber workshop light and cool teal plant light. Calm promise of adventure and useful work. No text, letters, logos, HUD, grids, charts or borders. Full bleed image.
