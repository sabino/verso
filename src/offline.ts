export interface OfflineStatus {
  phase: 'unsupported' | 'registering' | 'registered' | 'ready' | 'update-ready' | 'failed';
  message: string;
}
/** Observes browser-owned worker phases; registration alone does not prove precache success. */
export class OfflineMonitor {
  private value: OfflineStatus = {
    phase: 'unsupported',
    message: 'Offline play is unavailable in this environment.',
  };
  private listeners = new Set<(status: OfflineStatus) => void>();
  private pending: Promise<void> | null = null;
  private cleanups: (() => void)[] = [];
  private generation = 0;
  private cancel: (() => void) | null = null;
  get status(): OfflineStatus {
    return { ...this.value };
  }
  subscribe(listener: (status: OfflineStatus) => void) {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private set(phase: OfflineStatus['phase'], message: string) {
    if (this.value.phase === phase && this.value.message === message) return;
    this.value = { phase, message };
    for (const listener of this.listeners) listener(this.status);
  }
  register(
    register: () => Promise<ServiceWorkerRegistration>,
    container: Pick<ServiceWorkerContainer, 'addEventListener' | 'removeEventListener'>,
  ) {
    if (this.pending) return this.pending;
    this.cleanups.splice(0).forEach((cleanup) => cleanup());
    const generation = ++this.generation;
    this.set('registering', 'Preparing offline play…');
    let timer: ReturnType<typeof setTimeout>;
    const expired = new Promise<never>((_, reject) => {
      this.cancel = () => reject(new Error('Offline registration cancelled.'));
      timer = setTimeout(() => reject(new Error('Offline registration timed out.')), 15000);
    });
    this.pending = (async () => {
      try {
        const registration = await Promise.race([register(), expired]);
        if (generation !== this.generation) return;
        const watched = new WeakSet<ServiceWorker>();
        let lastInstaller: ServiceWorker | null = null;
        const update = () => {
          if (generation !== this.generation) return;
          const installing = registration.installing;
          if (installing) lastInstaller = installing;
          if (installing && !watched.has(installing)) {
            watched.add(installing);
            installing.addEventListener('statechange', update);
            this.cleanups.push(() => installing.removeEventListener('statechange', update));
          }
          if (registration.waiting)
            this.set(
              'update-ready',
              'An update is ready. Finish playing, then close other Verso tabs and reopen the game to use it.',
            );
          else if (registration.active?.state === 'activated')
            this.set(
              'ready',
              installing
                ? 'Offline play is ready. An update is downloading.'
                : 'Offline play is ready on this device.',
            );
          else if (lastInstaller?.state === 'redundant')
            this.set(
              'failed',
              'Offline preparation failed. Online play is still available; retry when connected.',
            );
          else
            this.set(
              'registered',
              'Offline files are still being prepared. Keep this page open while connected.',
            );
        };
        registration.addEventListener('updatefound', update);
        container.addEventListener('controllerchange', update);
        this.cleanups.push(
          () => registration.removeEventListener('updatefound', update),
          () => container.removeEventListener('controllerchange', update),
        );
        update();
      } catch {
        if (generation === this.generation)
          this.set(
            'failed',
            'Offline preparation failed. Online play is still available; retry when connected.',
          );
      }
    })().finally(() => {
      clearTimeout(timer);
      if (generation === this.generation) {
        this.pending = null;
        this.cancel = null;
      }
    });
    return this.pending;
  }
  dispose() {
    this.generation++;
    this.cancel?.();
    this.cancel = null;
    this.pending = null;
    this.cleanups.splice(0).forEach((cleanup) => cleanup());
    this.listeners.clear();
  }
}
const offline = new OfflineMonitor();
export const getOfflineStatus = () => offline.status;
export const subscribeOfflineStatus = (listener: (status: OfflineStatus) => void) =>
  offline.subscribe(listener);
/** Enable offline play after a production build has been loaded successfully. */
export async function registerOffline(): Promise<void> {
  if (
    typeof window === 'undefined' ||
    !import.meta.env?.PROD ||
    !window.isSecureContext ||
    !('serviceWorker' in navigator)
  )
    return;
  const script = new URL(`${import.meta.env.BASE_URL}sw.js`, document.baseURI);
  if (script.origin !== window.location.origin) return;
  await offline.register(
    () =>
      navigator.serviceWorker.register(script.href, {
        scope: new URL('./', script).href,
        updateViaCache: 'none',
      }),
    navigator.serviceWorker,
  );
}
if (typeof window !== 'undefined')
  window.addEventListener('online', () => {
    if (getOfflineStatus().phase === 'failed') void registerOffline();
  });
