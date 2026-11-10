/** Input admission only. Simulation/authority still validate costs, range and receipts. */
export interface InteractionContext {
  started: boolean;
  phase: 'playing' | 'lost';
  paused: boolean;
  modal: string;
  transfer: boolean;
  dialogue: boolean;
  satchel: boolean;
  hidden: boolean;
  portraitRequired: boolean;
  focus: 'world' | 'text' | 'select';
  pending: 'idle' | 'world' | 'combat';
  placement: 'none' | 'estate' | 'production';
}

const reasons = {
  'not-started': 'Choose or continue a life first.',
  background: 'Return to the game window.',
  orientation: 'Rotate your device to continue.',
  transfer: 'Continue the arrival first.',
  modal: 'Close this window to return to the world.',
  dialogue: 'Finish the conversation first.',
  paused: 'Resume the game first.',
  lost: 'Recover this life before acting.',
  satchel: 'Close your satchel first.',
  'text-entry': 'Finish typing before using world controls.',
  'select-entry': 'Finish choosing before using world controls.',
  'action-pending': 'Wait for the current action to finish.',
  placement: 'Finish or cancel construction placement first.',
} as const;
export type InteractionBlock = keyof typeof reasons;
export type InteractionCapability =
  | { allowed: true; reason: null; message: null }
  | { allowed: false; reason: InteractionBlock; message: string };

function capability(reason: InteractionBlock | null): InteractionCapability {
  return reason
    ? { allowed: false, reason, message: reasons[reason] }
    : { allowed: true, reason: null, message: null };
}

/** Pure, deterministic projection of orthogonal state, shared by UI/input/diagnostics. */
export function interactionState(context: InteractionContext) {
  const c = context;
  const surface = c.transfer
    ? { kind: 'transfer' as const }
    : c.modal
      ? { kind: 'modal' as const, name: c.modal }
      : c.dialogue
        ? { kind: 'dialogue' as const }
        : c.satchel
          ? { kind: 'satchel' as const }
          : { kind: 'world' as const };
  const screenBlock: InteractionBlock | null = !c.started
    ? 'not-started'
    : c.hidden
      ? 'background'
      : c.portraitRequired
        ? 'orientation'
        : c.transfer
          ? 'transfer'
          : c.modal
            ? 'modal'
            : c.dialogue
              ? 'dialogue'
              : c.paused
                ? 'paused'
                : null;
  const worldBlock = screenBlock ?? (c.phase === 'lost' ? 'lost' : c.satchel ? 'satchel' : null);
  const focusBlock =
    c.focus === 'text' ? 'text-entry' : c.focus === 'select' ? 'select-entry' : null;
  const moveBlock = worldBlock ?? focusBlock ?? (c.pending === 'world' ? 'action-pending' : null);
  const placementBlock = c.placement !== 'none' ? 'placement' : null;
  const actionBlock =
    worldBlock ?? focusBlock ?? (c.pending !== 'idle' ? 'action-pending' : null) ?? placementBlock;
  // A door acknowledgement temporarily stops simulation but must preserve its route.
  const interrupt = worldBlock ?? focusBlock ?? placementBlock;
  const travelInterruption =
    interrupt === null
      ? null
      : interrupt === 'background'
        ? ('background' as const)
        : interrupt === 'lost'
          ? ('death' as const)
          : interrupt === 'dialogue'
            ? ('dialogue' as const)
            : interrupt === 'text-entry' ||
                interrupt === 'select-entry' ||
                interrupt === 'placement'
              ? ('interaction' as const)
              : ('menu' as const);
  return {
    schemaVersion: 1 as const,
    lifecycle: c.started ? c.phase : ('not-started' as const),
    surface,
    focus: c.focus,
    pending: c.pending,
    placement: c.placement,
    travelInterruption,
    capabilities: {
      // Keep simulation running during text entry/satchel use; suppress player input only.
      // Lost phase is processed by the existing recovery screen transition in the frame loop.
      simulate: capability(screenBlock ?? (c.pending === 'world' ? 'action-pending' : null)),
      move: capability(moveBlock),
      travel: capability(moveBlock ?? placementBlock),
      combat: capability(actionBlock),
      interact: capability(actionBlock),
      // An intentional ground click can leave text entry and can preview a blueprint.
      worldPointer: capability(worldBlock ?? (c.pending !== 'idle' ? 'action-pending' : null)),
      // PTT is a deliberate pointer action; its own V shortcut guards text/select focus.
      voice: capability(worldBlock),
    },
  };
}

/** Underground attacks use the authoritative kit, not the surface body's appearance. */
export function strikeDestination(underworld: boolean, surfaceArmed: boolean) {
  return underworld || surfaceArmed ? 'combat' : 'equipment';
}
