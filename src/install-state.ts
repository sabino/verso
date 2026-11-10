export interface AppInstallPrompt {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export type InstallOutcome = 'accepted' | 'dismissed' | 'failed' | 'cancelled' | 'installed';

/** The native prompt owns its user wait; page lifecycle owns cancellation. */
export class InstallFlow {
  private prompt: AppInstallPrompt | null = null;
  private pending: Promise<InstallOutcome> | null = null;
  private resolve: ((outcome: InstallOutcome) => void) | null = null;
  private generation = 0;
  private state: 'unavailable' | 'available' | 'prompting' | InstallOutcome = 'unavailable';
  private readonly changed: () => void;
  constructor(changed: () => void = () => {}) {
    this.changed = changed;
  }
  capture(prompt: AppInstallPrompt) {
    if (this.state === 'installed') return;
    this.prompt = prompt;
    if (!this.pending) this.state = 'available';
    this.changed();
  }
  request(): Promise<InstallOutcome> | null {
    if (this.pending) return this.pending;
    if (this.state === 'installed') return Promise.resolve('installed');
    if (!this.prompt) return null;
    const prompt = this.prompt;
    this.prompt = null;
    const generation = ++this.generation;
    this.state = 'prompting';
    const pending = new Promise<InstallOutcome>((resolve) => (this.resolve = resolve));
    this.pending = pending;
    this.changed();
    void (async () => {
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (generation === this.generation) this.finish(choice.outcome);
      } catch {
        if (generation === this.generation) this.finish('failed');
      }
    })();
    return pending;
  }
  private finish(outcome: InstallOutcome) {
    this.state = outcome;
    this.resolve?.(outcome);
    this.resolve = null;
    this.pending = null;
    this.changed();
  }
  cancel() {
    ++this.generation;
    this.prompt = null;
    if (this.pending) this.finish('cancelled');
    else if (this.state === 'available') {
      this.state = 'unavailable';
      this.changed();
    }
  }
  installed() {
    ++this.generation;
    this.prompt = null;
    this.finish('installed');
  }
  get snapshot() {
    return { state: this.state, available: !!this.prompt, pending: !!this.pending };
  }
}
