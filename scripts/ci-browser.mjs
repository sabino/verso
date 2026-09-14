/** GitHub-hosted headless Chromium; local users supply a workspace-owned CDP endpoint. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { verifyPortraitMobile } from './browser-portrait-mobile.mjs';
const out = '.dream-loop/ci-browser';
fs.mkdirSync(out, { recursive: true });
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
let browser, profile;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let endpoint = process.env.VERSO_BROWSER_CDP;
  if (!endpoint) {
    if (process.env.GITHUB_ACTIONS !== 'true')
      throw Error('Local QA must use a verified Agent Workspace CDP endpoint');
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'verso-ci-browser-'));
    const log = fs.openSync(path.join(out, 'chromium.log'), 'w');
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
      fs.writeFileSync(path.join(out, 'launch-error.txt'), error.message),
    );
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; !fs.existsSync(portFile) && i < 200; i++) await pause(50);
    if (!fs.existsSync(portFile)) throw Error('CI Chromium failed to expose DevTools');
    endpoint = 'http://127.0.0.1:' + fs.readFileSync(portFile, 'utf8').split('\n')[0];
  }
  await verifyPortraitMobile({ endpoint, url: `http://localhost:${server.address().port}/`, out });
} finally {
  browser?.kill('SIGTERM');
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
