/** GitHub-hosted headless Chromium; local users supply a workspace-owned CDP endpoint. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { verifyPortraitMobile } from './browser-portrait-mobile.mjs';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A port file can precede HTTP readiness, especially on a cold hosted runner. */
export async function waitForDevTools(
  browser,
  profile,
  {
    timeoutMs = 90_000,
    now = () => performance.now(),
    sleep = pause,
    readPort = () => fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8'),
    fetcher = fetch,
    diagnostic = () => {},
  } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 90_000)
    throw Error('Chromium startup deadline must be between 1 and 90000 ms');
  const started = now(),
    stopped = new AbortController();
  let attempts = 0,
    reason = 'Waiting for DevToolsActivePort',
    launchError,
    exit =
      browser.exitCode != null || browser.signalCode != null
        ? { code: browser.exitCode, signal: browser.signalCode }
        : null;
  const onError = (error) => {
    launchError = String(error.code || error.name || 'spawn error').slice(0, 80);
    stopped.abort();
  };
  const onExit = (code, signal) => {
    exit = { code, signal };
    stopped.abort();
  };
  browser.on('error', onError);
  browser.on('exit', onExit);
  const report = (status) =>
    diagnostic({
      status,
      pid: browser.pid ?? null,
      timeoutMs,
      elapsedMs: Math.round(now() - started),
      attempts,
      reason,
      launchError: launchError ?? null,
      exit,
    });
  function alive() {
    if (launchError) throw Error(`CI Chromium failed to launch (${launchError})`);
    if (exit)
      throw Error(
        `CI Chromium exited before DevTools was ready (code ${exit.code}, signal ${exit.signal})`,
      );
  }
  report('starting');
  try {
    while (now() - started < timeoutMs) {
      alive();
      attempts++;
      let port, browserPath;
      try {
        const match = readPort()
          .trim()
          .match(/^(\d{1,5})\r?\n(\/devtools\/browser\/[A-Za-z0-9-]+)$/);
        if (match && Number(match[1]) > 0 && Number(match[1]) <= 65535)
          [, port, browserPath] = match;
      } catch {
        /* Chromium has not finished writing the fresh profile's port file. */
      }
      if (port) {
        const endpoint = `http://127.0.0.1:${Number(port)}`;
        reason = 'Waiting for matching DevTools /json/version';
        try {
          const response = await fetcher(`${endpoint}/json/version`, {
            redirect: 'error',
            signal: AbortSignal.any([
              stopped.signal,
              AbortSignal.timeout(
                Math.max(1, Math.min(2000, Math.ceil(timeoutMs - (now() - started)))),
              ),
            ]),
          });
          if (response.ok) {
            const version = await response.json();
            const socket = new URL(version.webSocketDebuggerUrl);
            alive();
            if (
              typeof version.Browser === 'string' &&
              version.Browser &&
              socket.protocol === 'ws:' &&
              ['127.0.0.1', 'localhost'].includes(socket.hostname) &&
              Number(socket.port) === Number(port) &&
              socket.pathname === browserPath &&
              !socket.username &&
              !socket.password &&
              !socket.search &&
              !socket.hash &&
              now() - started < timeoutMs
            ) {
              reason = 'DevTools port and browser endpoint are ready';
              report('ready');
              return endpoint;
            }
          }
        } catch {
          /* Retry transport, partial startup and invalid readiness responses. */
        }
      } else reason = 'Waiting for a complete valid DevToolsActivePort';
      alive();
      report('waiting');
      const remaining = timeoutMs - (now() - started);
      if (remaining > 0) await sleep(Math.min(250, remaining));
    }
    alive();
    throw Error(`CI Chromium did not become ready within ${timeoutMs} ms (${reason})`);
  } catch (error) {
    report('failed');
    throw error;
  } finally {
    browser.removeListener('error', onError);
    browser.removeListener('exit', onExit);
  }
}

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ttf': 'font/ttf',
};
async function main() {
  const out = '.dream-loop/ci-browser';
  fs.mkdirSync(out, { recursive: true });
  const root = path.resolve('dist');
  const server = http.createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
      if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) throw Error('Missing');
      res.writeHead(200, {
        'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  let browser, profile, log;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let endpoint = process.env.VERSO_BROWSER_CDP;
    if (!endpoint) {
      if (process.env.GITHUB_ACTIONS !== 'true')
        throw Error('Local QA must use a verified Agent Workspace CDP endpoint');
      profile = fs.mkdtempSync(path.join(os.tmpdir(), 'verso-ci-browser-'));
      log = fs.openSync(path.join(out, 'chromium.log'), 'w');
      browser = spawn(
        process.env.CHROME_PATH || 'google-chrome',
        [
          '--headless=new',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--remote-debugging-port=0',
          '--user-data-dir=' + profile,
          'about:blank',
        ],
        { stdio: ['ignore', log, log] },
      );
      browser.on('error', (error) =>
        fs.writeFileSync(
          path.join(out, 'launch-error.json'),
          JSON.stringify({ code: error.code ?? null, name: error.name }),
        ),
      );
      browser.on('exit', (code, signal) =>
        fs.writeFileSync(path.join(out, 'chromium-exit.json'), JSON.stringify({ code, signal })),
      );
      endpoint = await waitForDevTools(browser, profile, {
        diagnostic: (state) =>
          fs.writeFileSync(path.join(out, 'startup.json'), JSON.stringify(state, null, 2) + '\n'),
      });
    }
    await verifyPortraitMobile({
      endpoint,
      url: `http://localhost:${server.address().port}/`,
      out,
    });
  } finally {
    browser?.kill('SIGTERM');
    if (log !== undefined) fs.closeSync(log);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
