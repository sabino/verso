/** Real production boot/offline and pointer recovery checks; network faults are explicit fixtures. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { browserHarness } from './browser-harness.mjs';
export async function verifyPlatformRecovery({ endpoint, url, out }) {
  const harness = await browserHarness(endpoint, out);
  const checks = [];
  const expectedFixtureErrors = new Set();
  try {
    const page = await harness.page('platform-recovery', url);
    await page.wait(
      "window.stichos.state.offline.phase==='ready'",
      'actual production precache activates',
      30000,
    );
    checks.push('A production worker becomes ready only after its precache activates');
    const appChunks = await page.read(
      "performance.getEntriesByType('resource').map(r=>r.name).filter(name=>/\\/assets\\/app-[^/]+\\.js$/.test(new URL(name).pathname))",
    );
    assert.ok(appChunks.length > 0, 'The loaded production app chunk is identified');
    const beforeFault = harness.errors.length;
    try {
      // This worker has already precached the app. Both bypasses are necessary
      // for the staged network failure to reach the actual import boundary.
      await page.cdp.send('Network.setBypassServiceWorker', { bypass: true });
      await page.cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await page.cdp.send('Network.setBlockedURLs', { urls: appChunks });
      await page.cdp.send('Page.reload', { ignoreCache: true });
      await page.wait(
        "document.querySelector('[aria-label=\"Game loading\"] h1')?.textContent.includes('could not finish')",
        'failed lazy import exposes a recovery action',
      );
      await page.shot('failed-import');
      for (const error of harness.errors.slice(beforeFault)) {
        // Chrome normally reports blocked resources through the Network/Log
        // domains, not console.error. Only exempt that exact fixture if emitted
        // as console output; runtime exceptions and all other errors still fail.
        const text = error.console?.map((arg) => arg.value ?? arg.description ?? '').join(' ');
        if (
          error.name === 'platform-recovery' &&
          text?.includes('Failed to load resource: net::ERR_BLOCKED_BY_CLIENT') &&
          appChunks.some((chunk) => text.includes(chunk))
        )
          expectedFixtureErrors.add(error);
      }
      await page.cdp.send('Network.setBlockedURLs', { urls: [] });
      await page.click('[aria-label="Game loading"] button');
      await page.wait(
        "window.stichos?.state.modal==='title'",
        'native retry loads a new document successfully',
        30000,
      );
    } finally {
      await page.cdp.send('Network.setBlockedURLs', { urls: [] });
      await page.cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
      await page.cdp.send('Network.setBypassServiceWorker', { bypass: false });
    }
    checks.push('A blocked application import shows recovery and native Retry restores the title');
    const mobile = await harness.page('galaxy-pointer', url, {
      width: 390,
      height: 844,
      mobile: true,
    });
    await mobile.click('#v-title-galaxy');
    const selected = await mobile.read("document.querySelector('#v-planet-info').textContent");
    const point = await mobile.read(
      "(()=>{const r=document.querySelector('#v-galaxy-canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
    );
    await mobile.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...point, id: 1 }],
    });
    await mobile.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    assert.equal(
      await mobile.read("document.querySelector('#v-planet-info').textContent"),
      selected,
    );
    await mobile.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...point, id: 2 }],
    });
    await mobile.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x + 50, y: point.y, id: 2 }],
    });
    await mobile.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(
      await mobile.read("document.querySelector('#v-planet-info').textContent"),
      selected,
      'A pan does not select a planet',
    );
    await mobile.click('#v-galaxy-in');
    await mobile.click('#v-galaxy-close');
    await mobile.wait("window.stichos.state.modal==='title'");
    checks.push(
      'Native galaxy touch cancel releases ownership and later pan/zoom/Close remain usable',
    );
    assert.deepEqual(
      harness.errors.filter((error) => !expectedFixtureErrors.has(error)),
      [],
    );
    fs.writeFileSync(
      path.join(out, 'platform-recovery.json'),
      JSON.stringify(
        {
          checks,
          fixtures: ['Network blocked the loaded app chunk with service-worker/cache bypass.'],
          expectedFixtureErrors: [...expectedFixtureErrors],
        },
        null,
        2,
      ),
    );
  } finally {
    await harness.close();
  }
}
