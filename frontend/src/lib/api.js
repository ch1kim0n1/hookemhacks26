// Live API client for the FastAPI backend (or API Gateway in prod).
//
// Every call is best-effort: network failure, CORS miss, 4xx/5xx — we always
// return `{ ok: false, error }`, never throw. The store then decides whether
// to fall back to mock data. This keeps the demo alive even when the live
// plumbing misbehaves.
//
// Config is read from Vite env at build time:
//   VITE_API_BASE_URL    — where to point (default: http://localhost:8000)
//   VITE_API_ADMIN_TOKEN — only used if the operator opts in via Settings
//
// There is also a runtime kill switch in localStorage:
//   clawguardian.mock.force = "1"    → always use mock data
//   clawguardian.api.token = "<tok>" → admin bearer for /api/audit (optional)

const LS_FORCE_MOCK = 'clawguardian.mock.force';
const LS_ADMIN_TOKEN = 'clawguardian.api.token';

const FALLBACK_BASE = 'http://localhost:8000';

/** @returns {string} */
export function apiBaseUrl() {
  const raw =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
    FALLBACK_BASE;
  return String(raw).replace(/\/+$/, '');
}

/** @returns {boolean} */
export function isMockForced() {
  try {
    return localStorage.getItem(LS_FORCE_MOCK) === '1';
  } catch {
    return false;
  }
}

export function setMockForced(on) {
  try {
    if (on) localStorage.setItem(LS_FORCE_MOCK, '1');
    else localStorage.removeItem(LS_FORCE_MOCK);
  } catch {
    /* storage disabled — the toggle becomes no-op this session */
  }
}

/** @returns {string} */
export function adminToken() {
  try {
    const stored = localStorage.getItem(LS_ADMIN_TOKEN);
    if (stored) return stored;
  } catch {
    /* storage disabled */
  }
  const built =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_ADMIN_TOKEN) ||
    '';
  return String(built || '');
}

export function setAdminToken(tok) {
  try {
    if (tok) localStorage.setItem(LS_ADMIN_TOKEN, tok);
    else localStorage.removeItem(LS_ADMIN_TOKEN);
  } catch {
    /* ignore */
  }
}

/**
 * Issue a GET and resolve to `{ ok, data?, status?, error? }` — never throws.
 *
 * @param {string} path  relative path starting with /api/...
 * @param {{ admin?: boolean, signal?: AbortSignal }} [opts]
 */
export async function apiGet(path, opts = {}) {
  const base = apiBaseUrl();
  const url = `${base}${path}`;
  const headers = { 'Accept': 'application/json' };
  if (opts.admin) {
    const tok = adminToken();
    if (tok) headers['X-Admin-Token'] = tok;
  }
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      credentials: 'omit',
      signal: opts.signal,
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      return { ok: false, status: res.status, error: data?.detail || `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, error: err?.message || 'network error' };
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Run a callback every `intervalMs` ms. Returns a stop function. First call
 * fires immediately. Polls pause while the tab is hidden to save backend
 * capacity, and resume on visibilitychange.
 */
export function startPoll(fn, intervalMs) {
  let stopped = false;
  let timerId = null;

  const schedule = () => {
    if (stopped) return;
    timerId = setTimeout(run, intervalMs);
  };
  const run = async () => {
    if (stopped) return;
    if (document.visibilityState === 'hidden') {
      schedule();
      return;
    }
    try {
      await fn();
    } catch {
      /* callbacks never throw — but defensive */
    }
    schedule();
  };

  run();
  return () => {
    stopped = true;
    if (timerId != null) clearTimeout(timerId);
  };
}
