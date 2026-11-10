export type ProceduralPhase = 'playing' | 'dead' | 'complete';
export type ProceduralScreen =
  | 'title'
  | 'briefing'
  | 'world'
  | 'pause'
  | 'journal'
  | 'dead'
  | 'complete';
export type ScreenEvent =
  | 'title'
  | 'prepare'
  | 'continue'
  | 'deploy'
  | 'pause'
  | 'journal'
  | 'back'
  | 'recovered'
  | 'phase';
export interface ScreenState {
  screen: ProceduralScreen;
  journalReturn: Exclude<ProceduralScreen, 'journal'> | null;
}
const phaseScreen = (phase: ProceduralPhase): ProceduralScreen =>
  phase === 'playing' ? 'world' : phase;

/** The screen owns dismissal; having a living body is not permission to dismiss the title. */
export function screenTransition(
  state: ScreenState,
  event: ScreenEvent,
  phase: ProceduralPhase,
): ScreenState {
  const show = (screen: ProceduralScreen): ScreenState => ({ screen, journalReturn: null });
  if (event === 'title') return show('title');
  if (event === 'prepare' && phase === 'playing') return show('briefing');
  if (event === 'continue' && state.screen === 'title') return show(phaseScreen(phase));
  if (event === 'deploy' && state.screen === 'briefing' && phase === 'playing')
    return show('world');
  if (event === 'recovered' && state.screen === 'dead' && phase === 'playing') return show('world');
  if (event === 'phase' && phase !== 'playing') return show(phaseScreen(phase));
  if (event === 'pause' && state.screen === 'world' && phase === 'playing') return show('pause');
  if (event === 'journal' && ['world', 'pause', 'dead', 'complete'].includes(state.screen))
    return {
      screen: 'journal',
      journalReturn: state.screen as Exclude<ProceduralScreen, 'journal'>,
    };
  if (event === 'back') {
    if (state.screen === 'journal')
      return show(phase !== 'playing' ? phaseScreen(phase) : (state.journalReturn ?? 'pause'));
    if (state.screen === 'pause' && phase === 'playing') return show('world');
    if (state.screen === 'world' && phase === 'playing') return show('pause');
  }
  return state;
}

export type SaveStatus =
  | { kind: 'empty' | 'saved'; message: string }
  | { kind: 'error'; operation: 'read' | 'write' | 'restore'; message: string };
/** A failed write never replaces the last confirmed snapshot. No save format changes. */
export class CrossingSaveSlot {
  value: string | null = null;
  status: SaveStatus = { kind: 'empty', message: 'This crossing has not been saved yet.' };
  private storage: Pick<Storage, 'getItem' | 'setItem'>;
  private key: string;
  constructor(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string) {
    this.storage = storage;
    this.key = key;
    this.read();
  }
  read() {
    try {
      this.value = this.storage.getItem(this.key);
      // Reading the same bytes is not successful validation of a failed restore.
      if (!(this.value && this.status.kind === 'error' && this.status.operation === 'restore'))
        this.status = this.value
          ? { kind: 'saved', message: 'Crossing saved on this device.' }
          : { kind: 'empty', message: 'This crossing has not been saved yet.' };
      return true;
    } catch {
      this.status = {
        kind: 'error',
        operation: 'read',
        message: 'Saved crossing unavailable. Check browser storage access and retry.',
      };
      return false;
    }
  }
  write(snapshot: string) {
    try {
      this.storage.setItem(this.key, snapshot);
      this.value = snapshot;
      this.status = { kind: 'saved', message: 'Crossing saved on this device.' };
      return true;
    } catch {
      this.status = {
        kind: 'error',
        operation: 'write',
        message:
          'Changes are not saved. Keep this page open, free browser storage, then retry saving.',
      };
      return false;
    }
  }
  restoreSucceeded() {
    this.status = { kind: 'saved', message: 'Crossing restored from this device.' };
  }
  restoreFailed() {
    this.status = {
      kind: 'error',
      operation: 'restore',
      message:
        'That crossing could not be restored. Its saved record is unchanged. Retry, or start another crossing.',
    };
  }
}
