import { mkdir, readdir, readFile, writeFile, rename, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { verifyRoomCheckpoint } from '../src/stichos/room-checkpoint.ts';
import { RoomPersistence } from '../src/stichos/room-persistence.ts';

const MAX_PRIVATE_BACKUP_BYTES = 32_000_000;

/** Files contain private authority keys and traveler credentials: never serve this directory. */
export async function attachRoomDisk(hub, directory, { onCheckpoint } = {}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Fail before listening if the persistent mount is read-only or owned by another UID.
  const probe = join(directory, `.write-probe-${randomUUID()}`);
  await writeFile(probe, 'ready', { mode: 0o600, flag: 'wx' });
  await unlink(probe);
  const writers = new Map();
  // The last local checkpoint is the durable outbox. Restart reconstructs pending publication
  // from those files, so a bridge outage requires no second private save schema.
  const pendingReplicas = new Map(),
    replication = new Map(),
    publishing = new Map();
  const enqueueReplica = (checkpoint) => {
    if (!onCheckpoint) return;
    const room = checkpoint.state.room;
    pendingReplicas.set(room, checkpoint);
    if (!replication.has(room))
      replication.set(room, {
        phase: 'pending',
        lastPublishedRevision: null,
        lastPublishedAt: null,
        error: null,
      });
    else if (replication.get(room).phase === 'healthy')
      replication.set(room, { ...replication.get(room), phase: 'pending' });
  };
  const publishReplica = (room) => {
    if (publishing.has(room)) return publishing.get(room);
    const checkpoint = pendingReplicas.get(room);
    if (!checkpoint) return Promise.resolve();
    const before = replication.get(room);
    replication.set(room, { ...before, phase: before.error ? 'degraded' : 'publishing' });
    const task = Promise.resolve()
      .then(() => onCheckpoint(checkpoint))
      .then(
        () => {
          if (pendingReplicas.get(room) === checkpoint) pendingReplicas.delete(room);
          replication.set(room, {
            phase: pendingReplicas.has(room) ? 'pending' : 'healthy',
            lastPublishedRevision: checkpoint.revision,
            lastPublishedAt: checkpoint.createdAt,
            error: null,
          });
        },
        () => {
          replication.set(room, {
            ...before,
            phase: 'degraded',
            error:
              'Public replication failed. The local world checkpoint remains saved; publication will retry.',
          });
        },
      )
      .finally(() => publishing.delete(room));
    publishing.set(room, task);
    return task;
  };
  const save = async (record) => {
    const path = join(directory, `${record.checkpoint.state.room}.json`);
    const raw = JSON.stringify(record);
    if (Buffer.byteLength(raw) > MAX_PRIVATE_BACKUP_BYTES)
      throw Error('Saved world exceeds the storage limit.');
    await writeFile(`${path}.tmp`, raw, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    enqueueReplica(record.checkpoint);
  };
  for (const name of (await readdir(directory))
    .filter((n) => /^[A-Z0-9]{4,16}\.json$/.test(n))
    .slice(0, hub.maxRooms)) {
    const path = join(directory, name);
    if ((await stat(path)).size > MAX_PRIVATE_BACKUP_BYTES)
      throw Error('Saved world exceeds the storage limit.');
    const raw = await readFile(path, 'utf8');
    if (Buffer.byteLength(raw) > MAX_PRIVATE_BACKUP_BYTES)
      throw Error('Saved world exceeds the storage limit.');
    const record = JSON.parse(raw);
    if (!record.owner || !(await verifyRoomCheckpoint(record.checkpoint)))
      throw Error(`Saved world ${name} failed signature verification.`);
    hub.restoreRoom(record.checkpoint.state, record.owner.privateState);
    writers.set(
      record.checkpoint.state.room,
      new RoomPersistence(
        singleRoom(hub, record.checkpoint.state.room),
        save,
        record.owner.identity,
        record.checkpoint,
      ),
    );
    hub.publishCheckpoint(record.checkpoint);
    enqueueReplica(record.checkpoint);
  }
  return {
    replication: () => [...replication].map(([room, status]) => ({ room, ...status })),
    async flush(latest = false) {
      for (const id of hub.rooms.keys())
        if (!writers.has(id)) writers.set(id, new RoomPersistence(singleRoom(hub, id), save));
      const results = await Promise.allSettled(
        [...writers.values()].map((writer) => (latest ? writer.flushLatest() : writer.flush())),
      );
      await Promise.all([...pendingReplicas.keys()].map(publishReplica));
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    },
  };
}
function singleRoom(hub, id) {
  return {
    rooms: new Map([[id, null]]),
    exportRoom: (code) => hub.exportRoom(code),
    publishCheckpoint: (c) => hub.publishCheckpoint(c),
    signingIdentity: (code) => hub.signingIdentity(code),
    setSigningIdentity: (code, identity) => hub.setSigningIdentity(code, identity),
    getDurability: (code) => hub.getDurability(code),
    setDurability: (code, status) => hub.setDurability(code, status),
  };
}
