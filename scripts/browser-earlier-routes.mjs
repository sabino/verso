/** Native-input checks for the earlier playable routes. Storage failures below are explicitly staged environmental faults. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { browserHarness } from './browser-harness.mjs';

export async function verifyEarlierRoutes({ endpoint, url, out }) {
  const harness = await browserHarness(endpoint, out);
  const evidence = [];
  try {
    for (const mobile of [false, true]) {
      const size = mobile ? { width: 390, height: 844, mobile } : { width: 1440, height: 900 };
      const page = await harness.page(
        `procedural-${mobile ? 'phone' : 'desktop'}`,
        `${url}?lab=1`,
        {
          ...size,
          ready: "window.versoProcedural?.state.screen==='title'",
        },
      );
      await page.fill('#p-name', 'Lifecycle');
      await page.fill('#p-root', '3886');
      await page.click('#p-start button');
      await page.wait("window.versoProcedural.state.screen==='briefing'");
      await page.key('Escape', 'Escape', 27);
      assert.equal(await page.read('window.versoProcedural.state.screen'), 'briefing');
      await page.click('#p-deploy');
      await page.wait("window.versoProcedural.state.screen==='world'");
      const initial = await page.read('window.versoProcedural.state');
      assert.equal(initial.player.hp, initial.player.maxHp);
      await page.wait("document.querySelector('[data-command=heal]').disabled");
      assert.equal(
        await page.read("document.querySelector('[data-command=heal]').dataset.blockedReason"),
        'full-health',
      );
      assert.match(
        await page.read(
          "document.querySelector('[data-command=heal]').getAttribute('aria-description')",
        ),
        /already whole/,
      );
      await page.key('q', 'KeyQ', 81);
      assert.equal(await page.read('window.versoProcedural.state.memories'), initial.memories);
      evidence.push(await page.shot('whole-body'));
      await page.click('#p-pause');
      await page.click('#p-record');
      await page.click('#p-return');
      assert.equal(
        await page.read('window.versoProcedural.state.screen'),
        'pause',
        'journal returns to its owning pause menu',
      );
      await page.click('#p-new');
      await page.click('.p-terminal h2');
      await page.key('Escape', 'Escape', 27);
      await page.key('j', 'KeyJ', 74);
      assert.equal(
        await page.read('window.versoProcedural.state.screen'),
        'title',
        'title cannot accidentally resume its old live body',
      );
      await page.click('#p-continue');
      const resumed = await page.read('window.versoProcedural.state');
      assert.equal(resumed.screen, 'world');
      assert.equal(resumed.seed, initial.seed);
      assert.equal(resumed.player.genome.id, initial.player.genome.id);

      if (!mobile) {
        // Environmental fault only: actual game state and saves still go through normal UI paths.
        await page.read(`(() => {
          const original = Storage.prototype.setItem;
          window.__quotaFault = true;
          Storage.prototype.setItem = function(key, value) {
            if (key === 'verso.procedural.v1' && window.__quotaFault) throw new DOMException('Staged quota fault', 'QuotaExceededError');
            return original.call(this, key, value);
          };
          return true;
        })()`);
        const durableBefore = await page.read("localStorage.getItem('verso.procedural.v1')");
        await page.click('#p-pause');
        await page.click('#p-new');
        assert.equal(await page.read('window.versoProcedural.state.save.kind'), 'error');
        assert.match(
          await page.read("document.querySelector('[data-save-feedback]').textContent"),
          /not saved/,
        );
        assert.equal(await page.read("localStorage.getItem('verso.procedural.v1')"), durableBefore);
        evidence.push(await page.shot('staged-storage-failure'));
        await page.read('window.__quotaFault = false');
        await page.click('#p-retry-save');
        assert.equal(await page.read('window.versoProcedural.state.save.kind'), 'saved');
        await page.click('#p-continue');
        assert.equal(await page.read('window.versoProcedural.state.seed'), initial.seed);
      }
      await page.cdp.send('Page.reload');
      await page.wait("window.versoProcedural?.state.screen==='title'");
      await page.click('#p-continue');
      assert.equal(await page.read('window.versoProcedural.state.seed'), initial.seed);
      assert.equal(
        await page.read('window.versoProcedural.state.player.genome.id'),
        initial.player.genome.id,
      );
      evidence.push(await page.shot('continued'));

      const study = await harness.page(`study-${mobile ? 'phone' : 'desktop'}`, `${url}?study=1`, {
        ...size,
        ready:
          "window.verso?.loaded && window.verso.modal==='title' && !!document.querySelector('#operative-name')",
      });
      await study.fill('#operative-name', 'Readiness');
      await study.click('#start-form button[type=submit]');
      await study.click('#deploy-button');
      await study.wait('window.verso.modal===null');
      await study.wait("document.querySelector('[data-action=mend]').disabled");
      assert.equal(
        await study.read("document.querySelector('[data-action=mend]').dataset.blockedReason"),
        'whole',
      );
      assert.match(
        await study.read(
          "document.querySelector('[data-action=mend]').getAttribute('aria-description')",
        ),
        /already whole/,
      );
      const fragments = await study.read('window.verso.state.player.fragments');
      await study.key('q', 'KeyQ', 81);
      assert.equal(await study.read('window.verso.state.player.fragments'), fragments);
      await study.click('[data-action=pulse]');
      await study.wait("document.querySelector('[data-action=pulse]').disabled");
      assert.equal(
        await study.read("document.querySelector('[data-action=pulse]').dataset.blockedReason"),
        'cooldown',
      );
      assert.equal(
        await study.read(
          "document.querySelector('[data-action=pulse]').getAttribute('aria-disabled')",
        ),
        'true',
      );
      await study.wait("!document.querySelector('[data-action=pulse]').disabled");
      assert.equal(await study.read('window.verso.actions.pulse.allowed'), true);
      evidence.push(await study.shot('action-readiness'));
    }
    const malformed = await harness.page('procedural-staged-invalid-save', `${url}?lab=1`, {
      ready: "window.versoProcedural?.state.screen==='title'",
    });
    await malformed.read("localStorage.setItem('verso.procedural.v1', '{broken')");
    await malformed.cdp.send('Page.reload');
    await malformed.wait(
      "window.versoProcedural?.state.screen==='title' && !!document.querySelector('#p-continue')",
    );
    await malformed.click('#p-continue');
    assert.equal(await malformed.read('window.versoProcedural.state.screen'), 'title');
    assert.equal(await malformed.read('window.versoProcedural.state.save.kind'), 'error');
    assert.match(
      await malformed.read("document.querySelector('[data-save-feedback]').textContent"),
      /could not be restored/,
    );
    assert.equal(await malformed.read("localStorage.getItem('verso.procedural.v1')"), '{broken');
    await malformed.click('#p-retry-save');
    assert.equal(await malformed.read('window.versoProcedural.state.screen'), 'title');
    assert.equal(await malformed.read('window.versoProcedural.state.save.kind'), 'error');
    assert.match(
      await malformed.read("document.querySelector('[data-save-feedback]').textContent"),
      /could not be restored/,
    );
    assert.equal(await malformed.read("localStorage.getItem('verso.procedural.v1')"), '{broken');
    evidence.push(await malformed.shot('staged-invalid-save'));
    assert.deepEqual(harness.errors, []);
    fs.writeFileSync(
      path.join(out, 'earlier-routes-results.json'),
      JSON.stringify(
        {
          ok: true,
          evidence,
          storageFault:
            'Explicitly staged Storage.setItem failure in disposable context; no gameplay-state injection.',
        },
        null,
        2,
      ),
    );
  } finally {
    await harness.close();
  }
}
