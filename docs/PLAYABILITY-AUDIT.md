# Playability and presentation audit

## Release goal

A new resident should have a visible next action, usable tools, a sustainable path to production, and readable combat. The working loop is **meet people → gather and prepare → build and supply → explore and fight → return and improve**. The reference points are Tibia's readable persistent world, Factorio's tangible resource transformations, and StarCraft's clear roles and attack preparation. This pass retains Verso's own inhabited-world and body-transfer identity.

## Menu and interaction review

| Area reviewed                              | Decision                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title, creation, arrival                   | Show the three-part play loop; use original frontier artwork; preserve rerolls and existing-life saves.                                                       |
| Current objective, notebook, tracking      | Show the same derived next step in HUD and notebook; release completed tracked quests; remove repeated quest prose.                                           |
| Personal dialogue                          | Keep consequential choices and Continue visible; disclose optional talk only when present.                                                                    |
| Merchant and equipment                     | Determine commerce from the NPC's semantic role, independent of generated profession wording; preserve exact generated item stats.                            |
| Satchel, preparation, tools                | Preserve finite inventory, actual preparation, tool wear and repair costs. Tools remain correctly held with an invention equipped.                            |
| Work, placement and machines               | Explain missing costs and skill gates before placement; display whole-job progress; preserve work across surface/underground travel.                          |
| Dismantling                                | Recover half the materials from empty idle solo platforms, with no coin or XP refund; never orphan a shared room's registered machine.                        |
| Household and labor                        | Workers and machines respect each other's reserved finite sources.                                                                                            |
| Combat, techniques, quick step             | Preserve telegraph geometry; fix range, visible-target choice, failed-shot costs, windup rules and body-transition action leakage.                            |
| Atlas, galaxy, travel                      | Retain explored-area limits, deliberate travel, world identity and explicit room addresses.                                                                   |
| Expeditions, campaign, professions         | Retain staged survey/combat/supply objectives and earned progression; verify complete campaign and recovery paths.                                            |
| Rooms, chat and voice                      | Preserve authority, receipts and optional voice controls; no new networking or microphone activation.                                                         |
| Audio, accessibility, app settings         | Generated effects respect reduced motion/intensity; move unavailable experimental companion setup under diagnostics.                                          |
| Housing, guilds, estates and field systems | Preserve contracts and save schemas. Their separate stores remain a larger design issue; do not silently exchange incompatible currencies or item identities. |
| Clothing, cosmetic store, installation     | Preserve optional status and unavailable-purchase boundaries; these do not gate progression.                                                                  |
| Pause, loss, retirement and ending         | Keep explicit exits and recovery; cancel unfinished physical actions when entering a different body.                                                          |

## Gameplay evidence

The focused final progression check passed 106 tests spanning generated-life completion, expeditions, finite production, resources, survival, rescue, and underground encounters. The full 24-step legacy campaign test used actual session movement, gathering, crafting and choices, traveled about 12,132 tiles and performed 76 harvests. It measured simulated active time, not human playtime. Existing multiplayer authority, save validation and offline build checks remain part of the full suite.

The first-life browser proof additionally checks actual conversation/trust actions, an unobstructed Continue button, loading of the bundled effect atlas on a ward, construction requirements and the phone's current-objective notebook. Exact final check counts and deployment outcome belong in the release PR, rather than being inferred from these design notes.

## Remaining design work

This is a completed correctness and presentation pass, not a claim that every possible generated life has been played. Further work should reconcile personal and field/estate inventories and measure a long human session on actual phones. Enemy navigation now handles local cover; global routing and long-distance pursuit remain outside that bounded system. Shared-platform dismantling needs a server-authorized unregister protocol. Factory logistics networks, controllable squads, and StarCraft-scale warfare are not implemented by this pass.

## Navigation and production follow-up — 10 November 2026

- Solo and room-authoritative enemies route around nearby obstacles using the same deterministic steering helper. Planning is limited to four searches per tick, 192 visited cells per search, a ten-tile radius, and a 650 ms retry delay. Closed doors remain barriers; attack preparation and encounter retreat/hold rules remain intact. Routes are runtime caches, not saved state.
- Work previews show the selected batch count's total inputs, output, active seconds, and available unreserved sources. Invalid jobs explain their requirement before loading. A persistent pause notice and visible return button make clear that waiting inside Work does not complete production.
- Platforms permit capacity-limited collection trips while retaining every uncollected item. Practice is awarded when the store is emptied, so splitting pickup does not multiply rewards.
- Dismantling the final platform retains its structure and job counters across saving and reloading. Changing to another life requires returning to the surface, preventing a surface resident from inheriting dungeon coordinates.
- Platforms display distinct stationary state signs, stored crates, and whole-job progress. Reduced motion freezes saw blades and vibrating sieves. Preview canvases include the complete status sign and progress bar.
- The browser production route is part of hosted CI: real gathering, construction, recipe and batch selection, a 390-pixel phone preview, active work, pause, collection, save and Continue. It uses ordinary inputs rather than injecting supplies or finished jobs.

The expanded procedural-art sweep covers **1,350 samples**, including 24 production views, with zero raster-boundary flags. This remains sampled visual evidence; it is not a claim of exhaustive seed coverage or a long human session.

## Procedural artwork — 10 November 2026

The intended loop is to explore a lived-in world, gather finite resources, build useful production, and survive readable tactical encounters. Art must communicate an object's purpose and physical state at gameplay scale. Generated concept images and effects support that direction; seeded simulation objects retain a reproducible construction rather than inheriting arbitrary image geometry.

The procedural-art pass rendered **1,335 deterministic samples** through Canvas2D. Raster boundaries were checked for opaque pixels touching a sprite edge, excluding ground patches which deliberately tile edge to edge. Fifteen family sheets were generated under `.dream-loop/art-audit/`; representative tree, prop, door, building, humanoid, tool, production, estate, furniture, crop, fauna, and biome sheets were visually inspected. The final sweep reported **zero boundary flags**.

| Family                         | Samples | Coverage                                                                                                |
| ------------------------------ | ------: | ------------------------------------------------------------------------------------------------------- |
| Regional trees                 |     336 | Seven tree forms, 48 seeds each                                                                         |
| Regional rocks                 |     240 | Five mineral materials, 48 seeds each                                                                   |
| Legacy props and state changes |     210 | All 17 prop kinds, 12 seeds, plus open/closed door, chest and radio states                              |
| Regional doors                 |      20 | Ten cultures, open and closed                                                                           |
| Regional buildings             |     210 | Seven archetypes, ten cultures, three footprints (5×5, 8×8, 12×10)                                      |
| Legacy buildings               |       6 | All six non-cathedral civic archetypes                                                                  |
| Humanoids                      |     192 | Four technology tiers, empty hands and three weapon families, four directions, three gait/strike phases |
| Work poses                     |      36 | Axe, pickaxe, sickle; four directions; three work phases with an artifact equipped                      |
| Production                     |       9 | Three platforms at empty, partial and completed batch progress                                          |
| Estate stations                |      10 | Five station kinds, idle and working                                                                    |
| Furniture                      |       8 | Every furniture definition                                                                              |
| Crops                          |      12 | Three crops at four growth stages                                                                       |
| Fauna                          |      24 | Four animal kinds across six visual activities                                                          |
| Biome patches                  |      11 | Actual 5×5 generated patches in every wilderness biome                                                  |
| Ground materials               |      11 | Every terrain material                                                                                  |

The culture sample includes Gothic, adobe, basalt, timber, stilt and alpine construction, with primitive through electronic treatments and all four roof profiles. Biome patches can contain roads or transitional ground: they are generated world samples rather than isolated color swatches.

### Defects corrected

- The generated weapon raster now records its actual grip. Flexible bows, crossbows, electronic launchers, staffs and blades attach to that grip instead of a hard-coded point plus an approximate bow offset.
- A forearm, palm and held object use one shared moving joint. Attack progress and body width no longer make the item drift away from the hand.
- Gathering renders the selected work tool even when the actor carries an invented artifact. Its stroke angle is independent of the carried weapon family.
- Fractional pixel lines explicitly reach both joints, preventing short missing endpoints in articulated limbs and connected details.
- Snow-laden legacy conifers reserve sufficient transparent space for their full canopy. Their world-space foot anchor is unchanged.
- Regional conifer tier spacing follows the generated tree height. Short trees no longer paint their lowest foliage below the roots.
- Open electronic door leaves retain their full width beyond the jambs; enlarging the raster does not move the doorway's ground anchor.
- Large civic halls and naves reserve vertical canvas space for the rise derived from their actual footprint, preserving the full roof apex.

### Repeating the asset check

With Node 24+ and optional `@napi-rs/canvas` available to Node:

```sh
node --experimental-strip-types scripts/render-art-audit.mjs
```

This tool is offline and does not change saves, gameplay state or generated worlds. It writes labeled PNG contact sheets and `report.json` to `.dream-loop/art-audit/`, and returns failure if a sampled isolated sprite touches its raster boundary. The native Canvas dependency is for this development check only; the browser game does not require it.

The focused regression tests additionally check 1,200 generated weapon grips, work-tool rendering across carried equipment, and fractional line endpoints:

```sh
node --experimental-strip-types --test tests/stichos-held-items.test.ts
```

### Limits of this evidence

This samples every listed family, not every possible seed or customization. It does not establish that all palettes read equally well on every display, that every combat or quest path is complete, or that long sessions remain enjoyable. Alpha-boundary checks catch crop errors, not all internal occlusion mistakes. Browser interaction, collision, save compatibility, multiplayer authority, animation timing and performance require their separate gameplay checks. The authored legacy cathedral, every underground room arrangement and all contextual effect combinations are not covered by this isolated asset sweep.
