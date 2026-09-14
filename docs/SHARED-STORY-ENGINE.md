# Stories share one game

Theo's story and created lives use the same production application (`src/stichos/app.ts`), `Stichos` simulation, `InfiniteWorld`, renderer, inventory, crafting, combat, navigation, touch controls, multiplayer transport and save/restore path. Selecting Theo creates the established priest on generation-three geography; creating a life selects an existing resident before calling the same application activation function. Activation enables the same living systems for both: field economy, guilds, estates, persistent actors and underworlds.

`Stichos.storyScenario` selects **content**, independently from terrain generation:

| Saved life                                     | Scenario   |
| ---------------------------------------------- | ---------- |
| Generation 1–3 without a selected `lifeOrigin` | `theo`     |
| Any generation with a selected `lifeOrigin`    | `personal` |
| Existing generation 4 without an origin yet    | `personal` |

The existing `universeLife` getter is a compatibility alias for the personal scenario. No additional save field or world migration is needed. Old Theo saves retain their campaign, notebook and established home. A created resident on a generation-three planet now receives its own history, relationships, ordinary commissions and personal dialogue instead of inheriting Theo's campaign rules.

The shared `lifeCulture` reader uses a generated world's existing civilization profile. Earlier geography uses the existing Stíchos culture profile and its actual world clans. This supplies dialogue and notebook content without changing geography, collision, residents, buildings, world identifiers or climate simulation. Generation-four content remains deterministic and unchanged.

Theo's authored introduction, twenty-year journal, Sallas investigation, six-family context, starting possessions and story-specific transfer milestones are scenario content. They are not a second runtime. The notebook uses the same physical-book controls, pagination and styling; the selected scenario supplies its pages. Theo's campaign still gates the additional free-life milestones until its ending, while field systems are available immediately. Multiplayer uses the same authority and system frames for both scenarios; shared-room body changes remain subject to the existing authority restrictions.

The public entry file also retains earlier experimental modes: `?study` loads `src/main.ts` / `Game`, and `?generative` or `?lab` loads `src/procedural/app.ts` / `Crossing`. Those are separate historical prototypes. Neither is the playable Theo route or an implementation to duplicate for new stories.

`tests/theo-shared-systems.test.ts` covers legacy Theo classification and round trips, created generation-three/four personal dialogue and notebook rendering, unchanged generated tiles, actual retirement body transfer and pre-story shrine restrictions, and admission through the real in-memory room authority. Interaction positions in these tests are prepared fixtures; they do not claim traversal or campaign completion. Further stories should add scenario data and eligibility rules to this shared path, not another application or simulation.
