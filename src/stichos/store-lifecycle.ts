/** Wallet cookies are shared across mounts and lives. Serialize identity-sensitive
 * requests so a new mount reads the cookie installed by an earlier recovery. */
export class WalletRequestQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>, current: () => boolean = () => true): Promise<T> {
    const result = this.tail.then(() => {
      if (!current()) throw new DOMException('The store view was replaced.', 'AbortError');
      return operation();
    });
    this.tail = result.catch(() => {});
    return result;
  }
}
