# Constructed production

**Work** opens production. Choose a platform, then click a clear three-by-three patch within two paces. Roads, water, buildings, excavation sites, nearby resources and living people prevent placement. Powered platforms require crafting level two; the propagation bed can be built without that level. A household can maintain eight platforms.

| Platform                   | Construction cost       | One batch                                                        | Active work |
| -------------------------- | ----------------------- | ---------------------------------------------------------------- | ----------- |
| Sheltered propagation beds | 35 coins, 5 wood, 1 ore | 1 selected cequin/heartleaf/emberroot + 1 wood → 3 of that plant | 80 seconds  |
| Portable sawmill           | 55 coins, 6 wood, 4 ore | 1 ore + 1 reserved pine within 16 tiles → 4 wood                 | 55 seconds  |
| Ore sorting table          | 50 coins, 4 wood, 5 ore | 1 wood + 1 reserved rock within 16 tiles → 4 ore                 | 65 seconds  |

A platform accepts one job of one to five batches. Loading spends all physical inputs before work starts and reserves each required actual source once. Platforms and household workers exclude each other's active resource reservations. Jobs advance through active session updates, including underground expeditions, but not wall-clock time while closed, modal pauses or skipped rest time. Fractional work at the end of a batch carries into the next batch. Ordinary home garden plots have their own rest-based cultivation rules; these platforms are a separate production system.

The constructed platform appears in the actual world. A working job exposes current-batch progress, whole-job progress and remaining active seconds; finished output remains in its storage. Stand within three paces on the surface to load or collect. Matching coordinates on an underground floor do not provide access to a surface platform. Collection fills the available satchel space and leaves any remainder safely stored for another trip. Carried inventions count toward capacity, so a full platform never requires scrapping equipment to retrieve its goods. Partial trips do not multiply crafting practice: the collection reward applies when the stored output is emptied. Platform storage is limited to 60 units. Merely viewing a job or standing far away does not grant its materials.

A blocked source reports its reason. Retry checks the actual remaining resource again; cancellation returns the unworked prepaid inputs once, retaining completed output. A pending online claim must be resolved before cancellation. Platforms, job identifiers, progress, reserved sources and stored outputs persist in the planet's life. Leaving a body does not erase the work site.

An idle, empty solo platform can be dismantled nearby when the area is safe. This frees its construction slot and returns half of each original material cost, rounded down, provided the satchel has space. Coins and crafting practice are not refunded or awarded; rebuilding spends the full price and receives a new platform ID. Finish or cancel the job and collect all output first.

## Shared worlds

Platforms register with the room authority and are visible to other members. Registration requires a real clear site and permits up to eight machines per authenticated member. Personal recipe inputs, job time and resulting inventory still belong to the client; this is not a server-owned economy.

A sawmill or sorter that reaches completion online waits for the authority's source claim. The authority checks machine ownership, kind, source coordinates, range and depletion. Its persistent receipt binds owner, machine, job and source: the same acknowledged job can retry after a lost reply, while another job cannot consume that resource again. The client materializes output only after acknowledgement. Propagation beds use already carried cuttings and need no wild-source claim.

When a room is interrupted, uncertain source work remains pending rather than silently awarding a duplicate. Joining a room does not turn local household worker assignments into shared NPC automation; those assignments remain solo. [Shared-state contract](MULTIPLAYER.md).

The room protocol does not yet support platform removal. Platforms present during shared play remain protected from dismantling, including after disconnect and reload, so the local client cannot orphan a platform retained by the room authority. Older saves with a remembered room conservatively retain their platforms as well.

## Real-input proof

On 11 September 2026, 15:26:09–15:28:50 UTC, `scripts/browser-production.mjs` passed **9/9** checks on frozen local build `app-tZDgoFWJ.js` / `app-B_fqJ_rx.css`, with no browser exceptions or console errors.

A fresh Theo life used its actual axe and pickaxe to harvest three trees and one mineral stock, yielding six wood and two ore. It walked to clear ground at `(6, 9)`, constructed a bed for the exact displayed cost, and loaded one cequin batch for one wood and one cutting. Real keyboard walking advanced production. A 1.6-second Work-menu pause left the job timer unchanged; 80 active seconds, 83.6 wall seconds including inspection, produced exactly three stored portions. Remote collection was disabled. Nearby collection granted three portions once, and reload/Continue retained the platform, depleted inputs, coins and result.

The harness uses actual keyboard, pointer and menu input plus read-only DOM/world diagnostics. Its path planner does not assign position or grant resources. It creates and disposes its own browser context. Two preliminary harness-only routing failures were corrected before the full passing run: an offscreen resource click and a floor click on a decorative plant. No gameplay code was changed for this proof.

Evidence is under `.dream-loop/stichos-production/`: `results.json`, `final-state.json`, `02-garden-constructed.png`, `03-garden-growing.png`, `04-garden-progress-ui.png`, `05-garden-ready.png` and `07-restored-garden.png`. Earlier `FAIL-*` files, if present, are not the final result.

```sh
node scripts/browser-production.mjs http://127.0.0.1:WORKSPACE_CDP_PORT http://localhost:4174/
```

This verifies one complete solo propagation batch through the browser. Sawmill/sorter costs, reservations, source completion, persistence and acknowledged multiplayer claims have automated coverage; the complete powered-machine multiplayer UI cycle is not established by this garden proof.
