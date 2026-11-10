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

let atlas: HTMLImageElement | null = null;
let unavailable = false;
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
  if (unavailable || typeof Image === 'undefined') return null;
  if (!atlas) {
    atlas = new Image();
    atlas.decoding = 'async';
    atlas.onerror = () => {
      unavailable = true;
    };
    atlas.src = new URL('./assets/impact-atlas.webp', import.meta.url).href;
  }
  return atlas.complete && atlas.naturalWidth > 0 ? atlas : null;
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
