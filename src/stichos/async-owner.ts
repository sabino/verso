export type AsyncStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled' | 'replaced';
export type AsyncOutcome<T> =
  | { status: 'succeeded'; value: T }
  | { status: 'failed'; error: unknown }
  | { status: 'cancelled' | 'replaced' };

/** One presentation/request lane. Cancellation settles callers; it does not undo
 * an accepted server operation. Reconcile receipts inside the transport owner. */
export class AsyncOwner<Kind extends string> {
  private serial = 0;
  private task: AsyncTask<Kind> | null = null;

  start(kind: Kind) {
    this.task?.cancel('replaced');
    const task: AsyncTask<Kind> = new AsyncTask(
      kind,
      ++this.serial,
      () => this.task === task && this.serial === task.id,
    );
    this.task = task;
    return task;
  }
  cancel() {
    this.task?.cancel('cancelled');
    this.serial++;
  }
  get pending() {
    return this.task?.status === 'pending';
  }
  get kind() {
    return this.pending ? this.task!.kind : null;
  }
  get diagnostic() {
    return this.task ? { id: this.task.id, kind: this.task.kind, status: this.task.status } : null;
  }
}

export class AsyncTask<Kind extends string> {
  readonly kind: Kind;
  readonly id: number;
  private readonly owns: () => boolean;
  private phase: AsyncStatus = 'pending';
  private finish!: (status: Exclude<AsyncStatus, 'pending'>) => void;
  readonly settled = new Promise<Exclude<AsyncStatus, 'pending'>>((resolve) => {
    this.finish = resolve;
  });
  constructor(kind: Kind, id: number, owns: () => boolean) {
    this.kind = kind;
    this.id = id;
    this.owns = owns;
  }
  get status() {
    return this.phase;
  }
  get current() {
    return this.owns() && this.phase !== 'cancelled' && this.phase !== 'replaced';
  }
  settle(status: 'succeeded' | 'failed') {
    if (this.phase !== 'pending') return;
    this.phase = status;
    this.finish(status);
  }
  cancel(status: 'cancelled' | 'replaced') {
    if (this.phase === 'pending') {
      this.phase = status;
      this.finish(status);
    }
  }
  async run<T>(work: () => Promise<T>): Promise<AsyncOutcome<T>> {
    if (!this.current) return { status: this.phase === 'replaced' ? 'replaced' : 'cancelled' };
    const result = Promise.resolve()
      .then(() => {
        if (!this.current) throw Error('The request owner has changed.');
        return work();
      })
      .then(
        (value): AsyncOutcome<T> => {
          this.settle('succeeded');
          return { status: 'succeeded', value };
        },
        (error): AsyncOutcome<T> => {
          this.settle('failed');
          return { status: 'failed', error };
        },
      );
    const interrupted = this.settled.then((status) =>
      status === 'cancelled' || status === 'replaced' ? ({ status } as AsyncOutcome<T>) : result,
    );
    return Promise.race([result, interrupted]);
  }
}
