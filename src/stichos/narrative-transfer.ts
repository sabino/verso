export type TransferKind = 'opening' | 'arrival' | 'return' | 'clinic';
export interface ActiveTransfer<Scope> {
  kind: TransferKind;
  scope: Scope;
  startedAt: number;
  page: number;
  step: number;
  replay: boolean;
  after?: () => void;
}

/** Owns presentation and the one deferred transition; finishing consumes it
 * before any callback can open another arrival or replace the current life. */
export class NarrativeTransfer<Scope> {
  active: ActiveTransfer<Scope> | null = null;
  start(kind: TransferKind, scope: Scope, startedAt: number, after?: () => void, replay = false) {
    this.active = { kind, scope, startedAt, page: 0, step: -1, replay, after };
  }
  cancel() {
    this.active = null;
  }
  finish(scope: Scope) {
    const completed = this.active;
    if (!completed || completed.scope !== scope) return null;
    this.active = null;
    return completed;
  }
}
