import './install';
import { observeAppLoad } from './boot-state.ts';
const mode = new URLSearchParams(location.search);
const load = mode.has('study')
  ? import('./main')
  : mode.has('generative') || mode.has('lab')
    ? import('./procedural/app')
    : import('./stichos/app');
let notice: HTMLElement | null = null;
observeAppLoad(load, (state) => {
  if (state === 'ready') {
    notice?.remove();
    return;
  }
  if (state === 'loading') return;
  notice?.remove();
  notice = document.createElement('section');
  notice.setAttribute('role', 'alert');
  notice.setAttribute('aria-label', 'Game loading');
  notice.style.cssText =
    'position:fixed;inset:20% 10%;z-index:10000;padding:2rem;background:#122630;color:#e4e8df;border:2px solid #c9ae70;font:18px system-ui;overflow:auto';
  const heading = document.createElement('h1');
  heading.textContent =
    state === 'failed' ? 'Verso could not finish loading' : 'Verso is taking longer to load';
  const detail = document.createElement('p');
  detail.textContent =
    'Check your connection and try again. Your saved life is kept in this browser.';
  const retry = document.createElement('button');
  retry.textContent = 'Retry loading';
  retry.onclick = () => location.reload();
  notice.append(heading, detail, retry);
  document.body.append(notice);
});
