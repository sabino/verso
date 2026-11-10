export type BootState = 'loading' | 'slow' | 'ready' | 'failed';
/** Imports cannot be cancelled safely after module evaluation starts. A slow load offers
 * a page restart, never a second competing application instance. */
export function observeAppLoad(
  load: Promise<unknown>,
  changed: (state: BootState) => void,
  timeoutMs = 15000,
) {
  let disposed = false;
  changed('loading');
  const timer = setTimeout(() => {
    if (!disposed) changed('slow');
  }, timeoutMs);
  void load
    .then(
      () => {
        if (!disposed) changed('ready');
      },
      () => {
        if (!disposed) changed('failed');
      },
    )
    .finally(() => clearTimeout(timer));
  return () => {
    disposed = true;
    clearTimeout(timer);
  };
}
