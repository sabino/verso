/** Local authority storage. Public replication is a separate durability boundary. */
export interface RoomDurability {
  phase: 'untracked' | 'pending' | 'saving' | 'healthy' | 'degraded';
  lastSavedRevision: number | null;
  /** Timestamp of the last checkpoint whose local write completed successfully. */
  lastSavedAt: number | null;
  error: string | null;
}

export const untrackedDurability = (): RoomDurability => ({
  phase: 'untracked',
  lastSavedRevision: null,
  lastSavedAt: null,
  error: null,
});

export function validRoomDurability(value: unknown): value is RoomDurability {
  if (!value || typeof value !== 'object') return false;
  const v = value as RoomDurability;
  return (
    ['untracked', 'pending', 'saving', 'healthy', 'degraded'].includes(v.phase) &&
    (v.lastSavedRevision === null ||
      (Number.isSafeInteger(v.lastSavedRevision) && v.lastSavedRevision > 0)) &&
    (v.lastSavedAt === null || (Number.isSafeInteger(v.lastSavedAt) && v.lastSavedAt >= 0)) &&
    (v.lastSavedRevision === null) === (v.lastSavedAt === null) &&
    (v.phase !== 'healthy' || v.lastSavedRevision !== null) &&
    (!['untracked', 'pending'].includes(v.phase) || v.lastSavedRevision === null) &&
    (v.phase === 'degraded'
      ? typeof v.error === 'string' && v.error.length > 0 && v.error.length <= 400
      : v.error === null)
  );
}
