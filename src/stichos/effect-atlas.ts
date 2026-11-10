import type { CombatCue, FeedbackSettings } from './combat-feedback.ts';

/** Artwork is presentation only. Cell coordinates are derived from the decoded image. */
export function effectAtlasFrame(cue: CombatCue) {
  const row =
    cue.kind === 'impact'
      ? 0
      : cue.kind === 'guard' || cue.kind === 'area' || cue.kind === 'level'
        ? 1
        : cue.kind === 'dash'
          ? 2
          : cue.kind === 'loot'
            ? 3
            : -1;
  if (row < 0 || !Number.isFinite(cue.age) || !Number.isFinite(cue.duration) || cue.duration <= 0)
    return null;
  const progress = Math.max(0, Math.min(1, cue.age / cue.duration));
  return { row, column: Math.min(3, Math.floor(progress * 4)), progress };
}

export class EffectAtlasLoader {
  private atlas: HTMLImageElement | null = null;
  private attempts = 0;
  private began = 0;
  private retryAt = 0;
  private phase: 'unrequested' | 'loading' | 'ready' | 'failed' = 'unrequested';
  private readonly create: () => HTMLImageElement;
  private readonly now: () => number;
  constructor(create: () => HTMLImageElement, now = () => performance.now()) {
    this.create = create;
    this.now = now;
  }
  get status() {
    return { phase: this.phase, attempts: this.attempts };
  }
  retry() {
    this.atlas = null;
    this.attempts = 0;
    this.retryAt = 0;
    this.phase = 'unrequested';
  }
  get() {
    const now = this.now();
    if (this.phase === 'loading' && now - this.began >= 10000) this.failed(this.atlas!);
    if (this.phase === 'failed' && (now < this.retryAt || this.attempts >= 3)) return null;
    if (!this.atlas) {
      const image = this.create();
      this.atlas = image;
      this.attempts++;
      this.began = now;
      this.phase = 'loading';
      image.decoding = 'async';
      image.onerror = () => this.failed(image);
      image.src = new URL('./assets/impact-atlas.webp', import.meta.url).href;
    }
    if (this.atlas.complete && this.atlas.naturalWidth > 0) {
      this.phase = 'ready';
      return this.atlas;
    }
    return null;
  }
  private failed(image: HTMLImageElement) {
    if (this.atlas !== image) return;
    this.atlas = null;
    this.phase = 'failed';
    this.retryAt = this.now() + this.attempts * 2000;
  }
}
const atlasLoader = new EffectAtlasLoader(() => new Image());
export const getEffectAtlasStatus = () => atlasLoader.status;
export const retryEffectAtlas = () => atlasLoader.retry();
if (typeof window !== 'undefined') window.addEventListener('online', retryEffectAtlas);
/** Integer boundaries also cover generator outputs that are not divisible by four. */
export function effectAtlasCell(width: number, height: number, row: number, column: number) {
  const x = Math.round((column * width) / 4);
  const y = Math.round((row * height) / 4);
  return {
    x,
    y,
    width: Math.round(((column + 1) * width) / 4) - x,
    height: Math.round(((row + 1) * height) / 4) - y,
  };
}
function loadedAtlas() {
  return typeof Image === 'undefined' ? null : atlasLoader.get();
}

/** At most one bounded draw per cue. Procedural fallbacks and safety warnings remain intact. */
export function drawGeneratedEffect(
  ctx: CanvasRenderingContext2D,
  cue: CombatCue,
  unit: number,
  settings: FeedbackSettings,
) {
  if (settings.reducedMotion || settings.intensity <= 0) return false;
  const frame = effectAtlasFrame(cue);
  if (!frame) return false;
  const image = loadedAtlas();
  if (!image) return false;
  const cell = effectAtlasCell(image.naturalWidth, image.naturalHeight, frame.row, frame.column);
  const size = unit * (cue.kind === 'impact' || cue.kind === 'loot' ? 1.35 : 2.5);
  ctx.save();
  ctx.globalAlpha = settings.intensity * Math.min(0.8, (1 - frame.progress) * 1.5);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    image,
    cell.x,
    cell.y,
    cell.width,
    cell.height,
    Math.round(-size / 2),
    Math.round(-size / 2),
    Math.round(size),
    Math.round(size),
  );
  ctx.restore();
  return true;
}
