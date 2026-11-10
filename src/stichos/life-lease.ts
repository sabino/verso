/** A browser identity has one active tab when Web Locks are available. */
export type LifeLeaseState = 'idle' | 'requesting' | 'held' | 'busy' | 'unsupported' | 'failed';
export type LifeLockRequest = (
  name: string,
  options: { ifAvailable: true },
  callback: (lock: unknown | null) => Promise<void>,
) => Promise<unknown>;

export class LifeTabLease {
  private state: LifeLeaseState = 'idle';
  private generation = 0;
  private pending: Promise<boolean> | null = null;
  private settle: ((held: boolean) => void) | null = null;
  private releaseLock: (() => void) | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private readonly provider: () => LifeLockRequest | undefined;

  constructor(provider: () => LifeLockRequest | undefined) {
    this.provider = provider;
  }

  claim(): Promise<boolean> {
    if (this.state === 'held' || this.state === 'unsupported') return Promise.resolve(true);
    if (this.pending) return this.pending;
    const generation = ++this.generation;
    let request: LifeLockRequest | undefined;
    try {
      request = this.provider();
    } catch {
      this.state = 'failed';
      return Promise.resolve(false);
    }
    if (!request) {
      // Preserve single-tab play on older browsers, but never report an exclusive lock.
      this.state = 'unsupported';
      return Promise.resolve(true);
    }
    this.state = 'requesting';
    const result = new Promise<boolean>((resolve) => (this.settle = resolve));
    this.pending = result;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (held: boolean) => {
      clearTimeout(timer);
      if (this.timeout === timer) this.timeout = null;
      if (generation !== this.generation) return;
      this.settle?.(held);
      this.settle = null;
      this.pending = null;
    };
    const failed = () => {
      if (generation !== this.generation) return;
      this.state = 'failed';
      finish(false);
      this.releaseLock?.();
      this.releaseLock = null;
      // A delayed browser callback must release its lock without taking ownership.
      ++this.generation;
    };
    timer = setTimeout(failed, 5000);
    this.timeout = timer;
    try {
      void request('verso.continuing-life.v1', { ifAvailable: true }, async (lock) => {
        if (generation !== this.generation) return;
        if (!lock) {
          this.state = 'busy';
          finish(false);
          return;
        }
        const lifetime = new Promise<void>((resolve) => (this.releaseLock = resolve));
        this.state = 'held';
        finish(true);
        await lifetime;
        if (generation === this.generation) {
          this.releaseLock = null;
          this.state = 'idle';
        }
      }).catch(failed);
    } catch {
      failed();
    }
    return result;
  }

  release() {
    ++this.generation;
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
    this.settle?.(false);
    this.settle = null;
    this.pending = null;
    this.releaseLock?.();
    this.releaseLock = null;
    this.state = 'idle';
  }

  get snapshot() {
    return {
      state: this.state,
      exclusive: this.state === 'held',
      canSave: this.state === 'held' || this.state === 'unsupported',
      message:
        this.state === 'unsupported'
          ? 'Keep this life open in one tab. This browser cannot coordinate simultaneous tabs.'
          : this.state === 'busy'
            ? 'This life is already open in another tab.'
            : this.state === 'failed'
              ? 'This browser could not reserve your life. Retry before continuing.'
              : null,
    };
  }
}

const lease = new LifeTabLease(() => {
  if (!navigator.locks) return;
  return (name, options, callback) => navigator.locks.request(name, options, callback);
});
export const claimLifeTab = () => lease.claim();
export const releaseLifeTab = () => lease.release();
export const lifeTabStatus = () => lease.snapshot;
