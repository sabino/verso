/** Deterministic native-input first-session proof, run in CI's isolated Chromium. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { browserHarness, chooseLife, delay } from './browser-harness.mjs';

export async function verifyFirstLife({ endpoint, url, out }) {
  const harness = await browserHarness(endpoint, out);
  let page;
  try {
    page = await harness.page('first-life', url, { width: 1440, height: 900 });
    // Fix only the candidate draw in this disposable browser context. The game
    // itself remains seeded and its production creation flow remains unchanged.
    await page.cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const original = crypto.getRandomValues.bind(crypto);
        crypto.getRandomValues = (array) => {
          if (array instanceof Uint32Array && array.length === 1) {
            array[0] = 3;
            return array;
          }
          return original(array);
        };
      })();`,
    });
    await page.cdp.send('Page.reload');
    await page.wait("window.stichos?.state.modal==='title'");
    await chooseLife(page, 'Cushur Puhi', '8');
    await page.wait(
      "document.querySelector('#s-quest-stage')?.textContent === 'Hear the people involved'",
    );
    const initial = await page.state();
    assert.equal(initial.lifeOrigin.index, 3, 'a repeatable body and case');
    assert.equal(initial.personalStory.relationships.filter((r) => r.heard).length, 0);
    assert.equal(
      await page.read("document.querySelector('.s-shell').classList.contains('chat-collapsed')"),
      true,
    );
    const screenshots = [await page.shot('arrival')];
    const speak = async (stance) => {
      const state = await page.state();
      const person = state.personalStory.relationships.find((r) => r.stance === stance);
      const npc = state.npcs.find((n) => n.id === person.npcId);
      assert.ok(npc, `${stance} is a real, present person`);
      const point = await page.read(
        `window.stichos.worldToScreen(${JSON.stringify({ x: npc.x, y: npc.y })})`,
      );
      assert.ok(point.x > 0 && point.x < 1090 && point.y > 0 && point.y < 800);
      await page.point(point.x, point.y);
      await page.wait(
        `window.stichos.state.dialogue?.speaker === ${JSON.stringify(person.name)}`,
        `${stance} conversation`,
        60000,
      );
      assert.match(
        await page.read("document.querySelector('#s-dialogue p')?.textContent"),
        new RegExp(state.personalStory.case.stakes.slice(0, 8)),
      );
      return person;
    };
    await speak('ally');
    assert.equal(
      await page.read('document.querySelector(\'[data-choice="personal:trust"]\')?.disabled'),
      true,
    );
    screenshots.push(await page.shot('first-account'));
    await page.click('#s-dialogue-close');
    await speak('witness');
    assert.equal(
      await page.read('document.querySelector(\'[data-choice="personal:trust"]\')?.disabled'),
      false,
    );
    screenshots.push(await page.shot('second-account'));
    await page.click('[data-choice="personal:trust"]');
    await page.wait("document.querySelector('#s-quest-stage')?.textContent === 'Keep a promise'");
    assert.ok((await page.state()).personalStory.relationships.some((r) => r.trusted));
    screenshots.push(await page.shot('choice-consequence'));
    await page.click('#s-dialogue-close');
    await page.read('window.stichos.startProfile()');
    await delay(2200);
    await page.read('window.stichos.stopProfile()');
    const samples = await page.read('window.stichos.performanceTrace.samples.map(s => s.workMs)');
    assert.ok(samples.length > 30, 'real rendering frames were measured');
    samples.sort((a, b) => a - b);
    const result = {
      seed: initial.seed,
      lifeIndex: initial.lifeOrigin.index,
      stages: ['Hear the people involved', 'Make a choice', 'Keep a promise'],
      renderWorkMs: {
        median: samples[Math.floor(samples.length / 2)],
        p95: samples[Math.floor(samples.length * 0.95)],
      },
      screenshots,
      errors: harness.errors,
    };
    assert.deepEqual(harness.errors, []);
    fs.writeFileSync(path.join(out, 'first-life-results.json'), JSON.stringify(result, null, 2));
    return result;
  } finally {
    await harness.close();
  }
}
