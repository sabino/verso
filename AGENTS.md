# Working on Verso

Read [the state-machine map](docs/STATE-MACHINES.md) before changing a lifecycle or action gate. It identifies the owner, transitions, authority boundaries and known gaps across the app.

- Keep one owner for each state transition. Represent mutually exclusive states with typed alternatives; keep independent state dimensions separate.
- Use `src/stichos/interaction-state.ts` for main-game input admission. Visible controls, keyboard/touch handlers and `window.stichos.state.interaction` must agree. Session and server validation still decide costs, range, permissions and receipts.
- Treat a held gesture separately from permission to start another action. A pending attack acknowledgement must not discard an existing hold or block dialog navigation.
- Give asynchronous work an owner and a terminal outcome on success, failure, cancellation and replacement. Stale callbacks must neither mutate a newer owner nor leave the previous caller waiting.
- Preserve save and wire formats unless the task deliberately includes a migration. Never treat a browser capability snapshot as server authorization.
- When fixing a transition, reproduce its failure and test the recovery path plus relevant invariants. Use native-input browser checks for focus, touch and accessibility changes; a pure selector test cannot prove DOM behavior.
- Keep the map current when adding or changing a machine. Pure generators and transient visual interpolation do not need artificial lifecycle abstractions.
