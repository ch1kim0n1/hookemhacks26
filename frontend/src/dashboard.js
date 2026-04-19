import { render } from 'lit-html';
import { dashboardApp, store } from './components/dashboard-app.js';
import { VERDICT_POOL } from './components/dashboard/mock-data.js';
import { startLive } from './lib/live.js';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const mount = () => render(dashboardApp(), root);
store.subscribe(mount);
mount();

// Attempt to restore a Cognito session on first load so returning users land
// straight on the dashboard instead of the login screen.
store.hydrateFromCognito().catch(() => {
  /* ignore — falls through to the login view */
});

// Scroll-to-top button. Rendered outside the lit template so it doesn't
// retrigger re-renders.
const scrollBtn = document.createElement('button');
scrollBtn.type = 'button';
scrollBtn.className = 'dash-scroll-top';
scrollBtn.setAttribute('aria-label', 'Scroll to top');
scrollBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
scrollBtn.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
});
document.body.appendChild(scrollBtn);
const onScroll = () => {
  scrollBtn.classList.toggle('is-visible', window.scrollY > 320);
};
window.addEventListener('scroll', onScroll, { passive: true });

// -----------------------------------------------------------------------------
// Post-mount effects — only run on the overview route.
// -----------------------------------------------------------------------------
const runModalityBars = () => {
  const fills = document.querySelectorAll('[data-mod-fill]');
  if (!fills.length) return;
  fills.forEach((el, i) => {
    const pct = parseFloat(el.getAttribute('data-target-pct')) || 0;
    if (reducedMotion) {
      el.style.width = `${pct}%`;
      return;
    }
    setTimeout(() => {
      el.style.width = `${pct}%`;
    }, 120 + i * 90);
  });
};

const pad2 = (n) => String(n).padStart(2, '0');
const clockAt = (baseSec) => {
  const h = Math.floor(baseSec / 3600) % 24;
  const m = Math.floor((baseSec % 3600) / 60);
  const s = baseSec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
};

let baseClockSec = 12 * 3600 + 4 * 60 + 22;
let poolCursor = 0;

const tick = () => {
  baseClockSec += 3 + Math.floor(Math.random() * 5);
  const src = VERDICT_POOL[poolCursor % VERDICT_POOL.length];
  poolCursor += 1;
  const fresh = { ...src, time: clockAt(baseClockSec) };
  store.pushVerdict(fresh);
};

let intervalId = null;
const start = () => {
  if (reducedMotion || intervalId) return;
  intervalId = window.setInterval(tick, 3200);
};
const stop = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
  else if (store.getState().route === 'overview' && store.getState().session) start();
});

// Re-arm per-route effects after every render.
store.subscribe(() => {
  requestAnimationFrame(() => {
    runModalityBars();
    const s = store.getState();
    const onOverview = s.route === 'overview' && !!s.session;
    if (onOverview) start();
    else stop();
  });
});

// Close user menu on outside click.
document.addEventListener('click', (e) => {
  const state = store.getState();
  if (!state.userMenuOpen) return;
  const wrap = e.target.closest?.('.dash-user-wrap');
  if (!wrap) store.closeUserMenu();
});

// ESC closes drawer + user menu.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const s = store.getState();
  if (s.drawer) store.closeDrawer();
  else if (s.userMenuOpen) store.closeUserMenu();
});

// Auto-dismiss toasts.
let toastTimer = null;
store.subscribe((state) => {
  if (!state.toast) return;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => store.clearToast(), 3500);
});

// Kick off effects for the initial render.
requestAnimationFrame(() => {
  runModalityBars();
  const s = store.getState();
  if (s.route === 'overview' && s.session) start();
});

// Start polling the FastAPI backend. Runs regardless of session so the AWS
// status card on the login-gated dashboard is warm by the time the operator
// clicks into it. The poll pauses automatically when the tab is hidden.
startLive(store);
