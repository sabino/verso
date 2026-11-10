import type { CoopRooms } from './room-authority.mjs';
import {
  signRoomCheckpoint,
  type RoomSigningIdentity,
  type SignedRoomCheckpoint,
} from './room-checkpoint.ts';
import type { SavedRoom } from './room-storage.ts';
import type { RoomDurability } from './room-durability.ts';

/** Coalesces snapshots; live authority is the only writer. Storage failures reach the caller. */
export class RoomPersistence {
  private previous = new Map<string, SignedRoomCheckpoint>();
  private running: Promise<void> | null = null;
  private hub: CoopRooms;
  private save: (room: SavedRoom) => Promise<void> | void;
  constructor(
    hub: CoopRooms,
    save: (room: SavedRoom) => Promise<void> | void,
    identity?: RoomSigningIdentity,
    restored?: SignedRoomCheckpoint,
  ) {
    this.hub = hub;
    this.save = save;
    if (restored) {
      this.previous.set(restored.state.room, restored);
      if (identity) this.hub.setSigningIdentity(restored.state.room, identity);
      this.hub.setDurability(restored.state.room, {
        phase: 'healthy',
        lastSavedRevision: restored.revision,
        lastSavedAt: restored.createdAt,
        error: null,
      });
    }
  }
  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.capture().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  /** Orderly shutdown must capture again if an older asynchronous save was in flight. */
  async flushLatest() {
    // A failed older capture must not suppress the final recovery attempt.
    if (this.running) await this.running.catch(() => {});
    await this.flush();
  }
  private async capture() {
    let failure: unknown;
    for (const id of this.hub.rooms.keys()) {
      const before = this.hub.getDurability(id);
      // Retain the failure while retrying: starting a write is not recovery.
      this.hub.setDurability(id, { ...before, phase: before.error ? 'degraded' : 'saving' });
      try {
        const identity = await this.hub.signingIdentity(id);
        const record = this.hub.exportRoom(id);
        if (!record) continue;
        const checkpoint = await signRoomCheckpoint(record.state, identity, this.previous.get(id));
        await this.save({ checkpoint, owner: { identity, privateState: record.privateState } });
        this.previous.set(id, checkpoint);
        this.hub.setDurability(id, {
          phase: 'healthy',
          lastSavedRevision: checkpoint.revision,
          lastSavedAt: checkpoint.createdAt,
          error: null,
        });
        this.hub.publishCheckpoint(checkpoint);
      } catch (error) {
        failure ??= error;
        const status: RoomDurability = {
          ...before,
          phase: 'degraded',
          error:
            'World saving failed. Shared actions and new arrivals are paused until storage recovers. Keep this host open.',
        };
        this.hub.setDurability(id, status);
      }
    }
    if (failure) throw failure;
  }
}
