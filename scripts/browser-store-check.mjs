/** Isolated real-DOM store/Canvas2D verification. Store HTTP is mocked in this disposable
 * document: no real checkout, payment, entitlement server or gameplay state is modified. */
import fs from 'node:fs';
import path from 'node:path';
const endpoint = process.argv[2];
const origin = process.argv[3] ?? 'http://127.0.0.1:4173';
for (const value of [endpoint, origin])
  if (!value || !['localhost', '127.0.0.1'].includes(new URL(value).hostname))
    throw Error('Use verified workspace CDP and local app URLs.');
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(Error('Store fixture CDP connection timed out'));
    }, 10000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(Error('Store fixture CDP connection failed'));
    };
    ws.onclose = () => {
      clearTimeout(timer);
      reject(Error('Store fixture CDP connection closed'));
    };
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const value = JSON.parse(event.data),
      p = pending.get(value.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(value.id);
    value.error ? p.reject(Error(JSON.stringify(value.error))) : p.resolve(value.result);
  };
  const closed = () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error('Store fixture CDP connection closed'));
    }
    pending.clear();
  };
  ws.onclose = closed;
  ws.onerror = closed;
  return {
    ws,
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const next = ++id;
        const timer = setTimeout(() => {
          pending.delete(next);
          reject(Error(`Store fixture CDP timeout: ${method}`));
        }, 20000);
        pending.set(next, { resolve, reject, timer });
        try {
          if (ws.readyState !== WebSocket.OPEN) throw Error('Store fixture CDP is not open');
          ws.send(JSON.stringify({ id: next, method, params }));
        } catch (error) {
          clearTimeout(timer);
          pending.delete(next);
          reject(error);
        }
      }),
  };
}
const version = await (
  await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(10000) })
).json();
const browser = await connect(version.webSocketDebuggerUrl);
const out = path.resolve(process.env.VERSO_STORE_EVIDENCE ?? '.dream-loop/stichos-progression');
fs.mkdirSync(out, { recursive: true });
let context, page;
const checks = [];
try {
  context = (await browser.send('Target.createBrowserContext')).browserContextId;
  const { targetId } = await browser.send('Target.createTarget', {
    url: new URL('/src/stichos/store.ts', origin).href,
    browserContextId: context,
  });
  const target = (
    await (await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(10000) })).json()
  ).find((t) => t.id === targetId);
  page = await connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1120,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const evaluate = async (expression) => {
    const r = await page.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const check = async (label, expression) => {
    const value = await evaluate(expression);
    if (!value) throw Error(label);
    checks.push(label);
  };
  await evaluate(
    `(${async function setup() {
      const { mountStore, restoreStoreEntitlements } = await import('/src/stichos/store.ts');
      const { appearance } = await import('/src/stichos/world.ts');
      const { createProgression, COSMETICS } = await import('/src/stichos/progression.ts');
      await import('/src/stichos/style.css');
      document.body.replaceChildren();
      document.title = 'Stichos isolated store fixture';
      document.body.style.cssText = 'overflow:auto;height:auto;background:#12242d;padding:24px';
      const container = document.createElement('main');
      container.style.cssText = 'max-width:1040px;margin:auto';
      document.body.append(container);
      const state = {
        enabled: false,
        ids: [],
        calls: [],
        response: 'invalid',
        changes: 0,
        fail: false,
        game: null,
        csrf: 'fixture-csrf-0123456789',
        recoveryConfigured: false,
        hold: null,
      };
      const game = {
        player: { appearance: appearance(703) },
        progression: createProgression(703),
        bodyId: 'fixture-priest',
        setCosmeticEntitlements(ids) {
          this.verified = ids;
        },
        progress(action) {
          if (!this.verified.includes(action.styleId)) return { ok: false, message: 'Not owned.' };
          this.progression.equippedStyles[this.bodyId] = action.styleId;
          return { ok: true, message: 'Outfit equipped.' };
        },
        verified: [],
      };
      state.game = game;
      window.fetch = async (url, init = {}) => {
        const call = {
          url: String(url),
          method: init.method ?? 'GET',
          credentials: init.credentials,
          csrf: init.headers?.['X-Verso-CSRF'],
          body: init.body,
        };
        state.calls.push(call);
        if (state.hold && String(url).endsWith('/' + state.hold.path)) {
          const held = state.hold;
          state.hold = null;
          held.started();
          await held.promise;
        }
        if (state.fail) throw Error('Fixture offline');
        let data;
        if (String(url).endsWith('/catalog'))
          data = {
            enabled: state.enabled,
            testMode: true,
            skins: COSMETICS.filter((s) => s.currency === 'premium').map((s) => ({
              id: s.id,
              name: '<img src=x onerror=alert(1)>',
              amount: state.enabled ? 1099 : null,
              currency: state.enabled ? 'usd' : null,
              available: state.enabled,
            })),
          };
        else if (String(url).endsWith('/wallet')) {
          data = {
            csrf: state.csrf,
            entitlements: state.ids,
            recoveryConfigured: state.recoveryConfigured,
          };
          state.walletReadDone?.(data);
          state.walletReadDone = null;
        } else if (String(url).endsWith('/recovery')) {
          state.recoveryConfigured = true;
          data = {
            csrf: state.csrf,
            entitlements: state.ids,
            recoveryConfigured: true,
            recoveryCode: 'VR1-' + 'a'.repeat(64),
          };
        } else if (String(url).endsWith('/recover')) {
          state.csrf = 'rotated-fixture-csrf-0123456789';
          state.ids = ['sallas-silver'];
          data = { csrf: state.csrf, entitlements: state.ids, recoveryConfigured: true };
        } else if (String(url).endsWith('/checkout')) {
          if (state.response === 'owned') {
            state.ids = ['aurora-mantle'];
            data = { owned: true };
          } else data = { url: 'https://checkout.stripe.com.evil.invalid/c/pay' };
        } else throw Error('Unexpected fixture HTTP request');
        call.response = data;
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };
      state.mount = () => mountStore(container, game, () => state.changes++);
      state.waitForWallet = () =>
        new Promise((resolve) => {
          state.walletReadDone = resolve;
        });
      state.holdNext = (path) => {
        let release, started;
        const promise = new Promise((resolve) => {
          release = resolve;
        });
        state.heldStarted = new Promise((resolve) => {
          started = resolve;
        });
        state.hold = { path, promise, started };
        state.release = release;
      };
      state.restore = () => restoreStoreEntitlements(game, () => state.changes++);
      state.text = () => container.innerText;
      window.storeFixture = state;
      history.replaceState(null, '', '?store=success');
      await state.mount();
    }.toString()})()`,
  );
  await check(
    'Disabled server exposes three previews without prices or enabled purchase',
    `document.querySelectorAll('.s-store-card').length === 3 && [...document.querySelectorAll('[data-store-action^="buy:"]')].every(b => b.disabled) && storeFixture.text().includes('Purchases are disabled') && !storeFixture.text().includes('$10.99')`,
  );
  await check(
    'Success query alone confers no ownership',
    `storeFixture.game.verified.length === 0 && Object.keys(storeFixture.game.progression.equippedStyles).length === 0`,
  );
  await check(
    'All wallet/catalog requests include credentials; no checkout happens during mount',
    `storeFixture.calls.every(c => c.credentials === 'include') && !storeFixture.calls.some(c => c.url.endsWith('/checkout'))`,
  );
  await evaluate(`(async()=>{storeFixture.enabled = true; await storeFixture.mount();})()`);
  await check(
    'Configured test catalog renders real server amount and test label',
    `storeFixture.text().includes('$10.99') && storeFixture.text().includes('Test mode') && !document.querySelector('[data-store-action="buy:aurora-mantle"]').disabled && !document.querySelector('.s-store img')`,
  );
  const click = async (selector) => {
    const p = await evaluate(
      `(() => { const node = document.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:'center'}); const b = node.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}; })()`,
    );
    await page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...p,
      button: 'left',
      clickCount: 1,
    });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...p,
      button: 'left',
      clickCount: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
  };
  await click('[data-store-action="buy:aurora-mantle"]');
  await check(
    'Actual Buy click sends only product ID with CSRF and refuses deceptive host',
    `storeFixture.calls.filter(c => c.url.endsWith('/checkout')).length === 1 && storeFixture.calls.at(-1).csrf === 'fixture-csrf-0123456789' && storeFixture.calls.at(-1).body === JSON.stringify({skinId:'aurora-mantle'}) && storeFixture.text().includes('invalid checkout link') && location.hostname !== 'checkout.stripe.com.evil.invalid' && storeFixture.game.verified.length === 0`,
  );
  await evaluate(`storeFixture.response='owned';`);
  await click('[data-store-action="buy:aurora-mantle"]');
  await check(
    'Already-owned checkout response refreshes wallet rather than granting from response',
    `storeFixture.game.verified.includes('aurora-mantle') && storeFixture.calls.at(-1).url.endsWith('/wallet') && !!document.querySelector('[data-store-action="equip:aurora-mantle"]')`,
  );
  await click('[data-store-action="equip:aurora-mantle"]');
  await check(
    'Owned outfit equips for current body through normal progression adapter',
    `storeFixture.game.progression.equippedStyles['fixture-priest'] === 'aurora-mantle' && document.querySelector('[data-store-action="equip:aurora-mantle"]').disabled`,
  );
  await click('[data-store-action="recovery"]');
  await check(
    'Explicit Generate requests a recovery code with CSRF and hides it initially',
    `storeFixture.calls.filter(c => c.url.endsWith('/recovery')).length === 1 && storeFixture.calls.at(-1).csrf === 'fixture-csrf-0123456789' && document.querySelector('[data-store-action="recovery-code"]').type === 'password' && document.querySelector('[data-store-action="recovery-code"]').value.length === 68 && !location.search.includes('VR1-') && !Object.values(localStorage).some(v=>v.includes('VR1-'))`,
  );
  await evaluate(
    `window.downloadFixture = {blob:null,filename:null}; window.fixtureCreateURL=URL.createObjectURL; window.fixtureAnchorClick=HTMLAnchorElement.prototype.click;URL.createObjectURL=(blob)=>{downloadFixture.blob=blob;return 'blob:mock-private-recovery'};HTMLAnchorElement.prototype.click=function(){downloadFixture.filename=this.download};`,
  );
  await click('[data-store-action="download-code"]');
  await check(
    'Private recovery download contains the code and its ownership warning',
    `(async()=>downloadFixture.filename === 'verso-wallet-recovery.txt' && (await downloadFixture.blob.text()).includes(document.querySelector('[data-store-action="recovery-code"]').value) && (await downloadFixture.blob.text()).includes('Anyone with it'))()`,
  );
  await evaluate(
    `URL.createObjectURL=fixtureCreateURL; HTMLAnchorElement.prototype.click=fixtureAnchorClick; delete window.downloadFixture;`,
  );
  await click('[data-store-action="restore-wallet"]');
  await check(
    'Malformed recovery input is rejected before any network request',
    `!storeFixture.calls.some(c=>c.url.endsWith('/recover')) && storeFixture.text().includes('Enter the complete recovery code')`,
  );
  await evaluate(
    `(()=>{const input=document.querySelector('[data-store-action="restore-code"]');input.value='VR1-'+'b'.repeat(64);input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await click('[data-store-action="restore-wallet"]');
  await check(
    'Restore applies only returned wallet entitlements, clears secret inputs and discloses previous-session signout',
    `storeFixture.game.verified.join() === 'sallas-silver' && document.querySelector('[data-store-action="restore-code"]').value === '' && !document.querySelector('[data-store-action="recovery-code"]') && storeFixture.text().includes('previous wallet session is signed out')`,
  );
  await click('[data-store-action="recovery"]');
  await check(
    'Subsequent wallet mutation uses rotated CSRF from recovered wallet',
    `storeFixture.calls.at(-1).csrf === 'rotated-fixture-csrf-0123456789'`,
  );
  await evaluate(`window.scrollTo(0,0)`);
  fs.writeFileSync(
    path.join(out, 'store-desktop.png'),
    Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await check(
    'Mobile store has no horizontal overflow',
    `document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.s-store-card')].every(c=>c.getBoundingClientRect().right <= innerWidth)`,
  );
  fs.writeFileSync(
    path.join(out, 'store-mobile.png'),
    Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'),
  );
  await evaluate(`(async()=>{storeFixture.ids=[]; await storeFixture.restore();})()`);
  await check(
    'Silent startup wallet refresh revokes refunded ownership',
    `storeFixture.game.verified.length === 0`,
  );
  await evaluate(
    `(async()=>{storeFixture.ids=['sallas-silver']; await storeFixture.restore();})()`,
  );
  await check(
    'Silent startup refresh restores only verified premium IDs',
    `storeFixture.game.verified.join() === 'sallas-silver'`,
  );
  await evaluate(`(async()=>{storeFixture.fail=true; await storeFixture.restore();})()`);
  await check(
    'Offline startup clears unverified premium entitlement without a UI toast',
    `storeFixture.game.verified.length === 0 && !document.querySelector('.s-store-status.is-error')`,
  );
  await evaluate(
    `(async()=>{storeFixture.fail=false;storeFixture.ids=[];await storeFixture.mount();storeFixture.holdNext('catalog');const oldWallet=storeFixture.waitForWallet();storeFixture.oldMount=storeFixture.mount();await storeFixture.heldStarted;if((await oldWallet).entitlements.length!==0)throw Error('The old wallet response must complete before replacement');storeFixture.ids=['sallas-silver'];await storeFixture.mount();storeFixture.release();await storeFixture.oldMount;})()`,
  );
  await check(
    'A replaced catalog request cannot overwrite the current mounted wallet',
    `storeFixture.game.verified.join()==='sallas-silver'&&!!document.querySelector('[data-store-action="equip:sallas-silver"]')&&!document.querySelector('[data-store-action="refresh"]').disabled`,
  );
  await evaluate(
    `(()=>{storeFixture.holdNext('recover');const input=document.querySelector('[data-store-action="restore-code"]');input.value='VR1-'+'b'.repeat(64);input.dispatchEvent(new Event('input',{bubbles:true}));storeFixture.beforeWalletReads=storeFixture.calls.filter(c=>c.url.endsWith('/wallet')).length;})()`,
  );
  await click('[data-store-action="restore-wallet"]');
  await evaluate(`storeFixture.heldStarted`);
  // Returning the mount promise would make CDP await the recovery release
  // scheduled below, deadlocking the very queue ordering this scenario tests.
  await evaluate(`void (storeFixture.newMount=storeFixture.mount());`);
  await check(
    'A replacement mount waits for an in-flight cookie recovery before reading the wallet',
    `storeFixture.calls.filter(c=>c.url.endsWith('/wallet')).length===storeFixture.beforeWalletReads`,
  );
  await evaluate(`(async()=>{storeFixture.release();await storeFixture.newMount;})()`);
  await check(
    'Recovery completion reconciles into the new mount without a stale busy state or leaked code',
    `storeFixture.game.verified.join()==='sallas-silver'&&!document.querySelector('[data-store-action="refresh"]').disabled&&!document.querySelector('[data-store-action="recovery-code"]')`,
  );
  const image = await evaluate(
    `(${async function furnitureSheet() {
      const { drawHomeDecoration } = await import('/src/stichos/progression-art.ts');
      const { FURNITURE } = await import('/src/stichos/progression.ts');
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 660;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#c1d1d1';
      ctx.fillRect(0, 0, 1200, 660);
      ctx.font = '15px Georgia';
      FURNITURE.forEach((f, i) => {
        const x = 150 + (i % 4) * 300,
          y = 215 + Math.floor(i / 4) * 245;
        drawHomeDecoration(
          ctx,
          {
            id: f.id,
            homeId: 'fixture',
            buildingId: 'house',
            seed: 703,
            x: 0,
            y: 0,
            kind: 'furniture',
            furnitureId: f.id,
          },
          x,
          y,
          2.3,
          4,
          true,
        );
        ctx.fillStyle = '#284852';
        ctx.fillText(f.name, x - 100, y + 32);
      });
      ['seedling', 'growing', 'ready'].forEach((stage, i) =>
        drawHomeDecoration(
          ctx,
          {
            id: 'crop' + i,
            homeId: 'fixture',
            buildingId: 'house',
            seed: 703,
            x: 0,
            y: 0,
            kind: 'crop',
            plot: i,
            stage,
            crop: { plant: 'cequin', seed: 703, plantedAt: 0, readyAt: 60, yield: 3 },
          },
          380 + i * 210,
          615,
          1.8,
          4,
          true,
        ),
      );
      return canvas.toDataURL('image/png').split(',')[1];
    }.toString()})()`,
  );
  fs.writeFileSync(path.join(out, 'home-furniture.png'), Buffer.from(image, 'base64'));
  fs.writeFileSync(
    path.join(out, 'store-results.json'),
    JSON.stringify(
      {
        checks,
        limitations: [
          'Store HTTP responses mocked in isolated fixture; no live payment or real Checkout session tested.',
          'Furniture sheet is real Canvas2D asset rendering, not a gameplay home purchase route.',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ passed: checks.length, checks, output: out }, null, 2));
} finally {
  page?.ws.close();
  try {
    if (context) await browser.send('Target.disposeBrowserContext', { browserContextId: context });
  } finally {
    browser.ws.close();
  }
}
