/** Native-input QA helper. Only attach to a verified agent-workspace Chromium endpoint. */
import fs from 'node:fs';
import path from 'node:path';
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serialized into the page after focus; readiness comes from frames, not a fixed sleep. */
export async function measureStableClickTarget(selector) {
  const deadline = performance.now() + 3000;
  let previous,
    stableFrames = 0;
  while (performance.now() < deadline) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          cancelAnimationFrame(frame);
          reject(Error('Click target layout did not settle: ' + selector));
        },
        Math.max(1, deadline - performance.now()),
      );
      const frame = requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (performance.now() >= deadline) break;
    const element = document.querySelector(selector);
    if (!element || element.disabled) throw Error('Missing/disabled: ' + selector);
    const rect = element.getBoundingClientRect();
    let top = 0,
      bottom = innerHeight,
      scroller = null;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent),
        bounds = parent.getBoundingClientRect();
      if (/auto|scroll|hidden/.test(style.overflowY)) {
        top = Math.max(top, bounds.top);
        bottom = Math.min(bottom, bounds.bottom);
        if (
          /auto|scroll/.test(style.overflowY) &&
          parent.scrollHeight > parent.clientHeight + 1 &&
          !scroller
        )
          scroller = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      }
    }
    const geometry = JSON.stringify([
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      top,
      bottom,
      innerWidth,
      innerHeight,
      scroller,
    ]);
    stableFrames = geometry === previous ? stableFrames + 1 : 1;
    previous = geometry;
    if (stableFrames < 2) continue;
    const x = rect.x + rect.width / 2,
      y = (Math.max(rect.top, top) + Math.min(rect.bottom, bottom)) / 2;
    if (
      rect.bottom <= top ||
      rect.top >= bottom ||
      !element.contains(document.elementFromPoint(x, y))
    )
      return {
        scroll: scroller ?? { x: innerWidth / 2, y: innerHeight / 2 },
        delta: Math.max(-450, Math.min(450, (rect.top + rect.bottom) / 2 - (top + bottom) / 2)),
      };
    return { x, y };
  }
  throw Error('Click target layout did not settle: ' + selector);
}

export async function connect(address, events = () => {}) {
  const socket = new WebSocket(address);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let serial = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) {
      events(message.method, message.params);
      return;
    }
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timeout);
    pending.delete(message.id);
    message.error
      ? item.reject(Error(JSON.stringify(message.error)))
      : item.resolve(message.result);
  };
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++serial;
        pending.set(id, {
          resolve,
          reject,
          timeout: setTimeout(() => {
            pending.delete(id);
            reject(Error(`CDP timeout: ${method}`));
          }, 20000),
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}
export async function browserHarness(endpoint, out) {
  if (!endpoint || !['127.0.0.1', 'localhost'].includes(new URL(endpoint).hostname))
    throw Error('Supply the workspace_browser_targets verified loopback CDP endpoint.');
  fs.mkdirSync(out, { recursive: true });
  const browser = await connect(
    (await (await fetch(`${endpoint}/json/version`)).json()).webSocketDebuggerUrl,
  );
  const clients = [],
    errors = [];
  async function page(name, url, { width = 1440, height = 960, mobile = false } = {}) {
    if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname))
      throw Error('This harness is local-only.');
    const { browserContextId } = await browser.send('Target.createBrowserContext');
    const { targetId } = await browser.send('Target.createTarget', {
      url: 'about:blank',
      browserContextId,
      newWindow: true,
    });
    const targets = await (await fetch(`${endpoint}/json/list`)).json();
    const cdp = await connect(
      targets.find((t) => t.id === targetId).webSocketDebuggerUrl,
      (method, params) => {
        if (method === 'Runtime.exceptionThrown')
          errors.push({ name, exception: params.exceptionDetails });
        if (method === 'Runtime.consoleAPICalled' && params.type === 'error')
          errors.push({ name, console: params.args });
      },
    );
    async function read(expression) {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    async function wait(expression, label = expression, timeout = 15000) {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        if (await read(expression).catch(() => false)) return;
        await delay(80);
      }
      throw Error(`${name}: ${label}`);
    }
    async function focus() {
      await cdp.send('Page.bringToFront');
    }
    async function key(key, code, vk, hold = 0, modifiers = 0) {
      await focus();
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code,
        windowsVirtualKeyCode: vk,
        ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
        modifiers,
      });
      if (hold) await delay(hold);
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code,
        windowsVirtualKeyCode: vk,
        modifiers,
      });
      await delay(60);
    }
    async function dispatchPoint(x, y) {
      if (mobile) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          button: 'left',
          clickCount: 1,
          x,
          y,
        });
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          button: 'left',
          clickCount: 1,
          x,
          y,
        });
      }
      await delay(100);
    }
    async function point(x, y) {
      await focus();
      return dispatchPoint(x, y);
    }
    async function click(selector) {
      for (let attempt = 0; attempt < 16; attempt++) {
        // Focusing can resize the viewport or dismiss input UI. Measure only after
        // that transition, then keep focus unchanged until trusted pointer input.
        await focus();
        const rect = await read(
          `(${measureStableClickTarget.toString()})(${JSON.stringify(selector)})`,
        );
        if (!rect.scroll) return dispatchPoint(rect.x, rect.y);
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          ...rect.scroll,
          deltaX: 0,
          deltaY: rect.delta || 120,
        });
        await delay(120);
      }
      throw Error(`${name}: unreachable ${selector}`);
    }
    async function fill(selector, text) {
      await click(selector);
      await key('a', 'KeyA', 65, 0, 2);
      await cdp.send('Input.insertText', { text });
    }
    async function shot(label) {
      await focus();
      await delay(140);
      const screenshot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      const file = path.join(out, `${name}-${label}.png`);
      fs.writeFileSync(file, Buffer.from(screenshot.data, 'base64'));
      return file;
    }
    async function resize(width, height) {
      await focus();
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        mobile,
        deviceScaleFactor: 1,
      });
      await read(
        `new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Viewport did not render after resize')),3000);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve(true)}))})`,
      );
    }
    const client = {
      name,
      cdp,
      read,
      wait,
      key,
      point,
      click,
      fill,
      focus,
      shot,
      resize,
      browserContextId,
      targetId,
      state: () => read('window.stichos.state'),
    };
    clients.push(client);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: 5 });
    await resize(width, height);
    await cdp.send('Page.navigate', { url });
    await wait("window.stichos?.state.modal==='title'", 'title ready');
    await read('document.fonts.ready.then(()=>true)');
    return client;
  }
  return {
    browser,
    page,
    clients,
    errors,
    async close() {
      for (const client of clients) {
        client.cdp.close();
        await browser.send('Target.disposeBrowserContext', {
          browserContextId: client.browserContextId,
        });
      }
      browser.close();
    },
  };
}
export async function chooseLife(client, name = 'Aster', seed = '8', mobile = false) {
  await client.fill('#s-seed-input', seed);
  await client.click('#s-start button[type=submit]');
  await client.wait("window.stichos.state.modal==='creation'", 'creation ready', 30000);
  if (mobile) await client.click('[data-creation-page=look]');
  await client.fill('#v-create-name', name);
  await client.key('Tab', 'Tab', 9);
  await client.click('#v-accept-life');
  await client.wait('window.stichos.state.transfer', 'arrival');
  await client.click('#s-skip');
  await client.wait("!window.stichos.state.transfer && window.stichos.state.modal===''");
}
