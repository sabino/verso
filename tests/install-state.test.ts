import test from 'node:test';
import assert from 'node:assert/strict';
import { InstallFlow } from '../src/install-state.ts';

function offer() {
  let choose!: (choice: { outcome: 'accepted' | 'dismissed' }) => void;
  let prompts = 0;
  return {
    prompt: {
      prompt: async () => {
        prompts++;
      },
      userChoice: new Promise<{ outcome: 'accepted' | 'dismissed' }>((r) => (choose = r)),
    },
    choose: (outcome: 'accepted' | 'dismissed') => choose({ outcome }),
    prompts: () => prompts,
  };
}

test('repeated install requests share one native prompt and acceptance is not installation proof', async () => {
  const flow = new InstallFlow(),
    first = offer();
  assert.equal(flow.request(), null);
  flow.capture(first.prompt);
  const request = flow.request();
  assert.equal(flow.request(), request);
  assert.equal(first.prompts(), 1);
  first.choose('accepted');
  assert.equal(await request, 'accepted');
  assert.equal(flow.snapshot.state, 'accepted');
  assert.equal(flow.request(), null);
  flow.installed();
  assert.equal(flow.snapshot.state, 'installed');
});

test('page cancellation settles the caller and a late native choice cannot overwrite a new prompt', async () => {
  const flow = new InstallFlow(),
    first = offer(),
    second = offer();
  flow.capture(first.prompt);
  const old = flow.request();
  flow.cancel();
  assert.equal(await old, 'cancelled');
  flow.capture(second.prompt);
  const current = flow.request();
  first.choose('accepted');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(flow.snapshot.state, 'prompting');
  second.choose('dismissed');
  assert.equal(await current, 'dismissed');
});

test('installation event wins late choice and failures permit a fresh offer', async () => {
  const flow = new InstallFlow(),
    first = offer();
  flow.capture({
    prompt: async () => {
      throw Error('unavailable');
    },
    userChoice: Promise.resolve({ outcome: 'dismissed' }),
  });
  assert.equal(await flow.request(), 'failed');
  flow.capture(first.prompt);
  const request = flow.request();
  flow.installed();
  assert.equal(await request, 'installed');
  first.choose('dismissed');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(flow.snapshot, { state: 'installed', available: false, pending: false });
});
