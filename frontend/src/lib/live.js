// Live-data orchestrator. Polls the FastAPI backend and fans new data out to
// the dashboard store. Every call is wrapped in apiGet which never throws —
// a failure just leaves the last successful snapshot in place, so the UI
// never flickers to an empty state mid-demo.
//
// Polling cadence is tuned so the dashboard feels "alive" without hammering
// the backend during a demo:
//   status + aws  → 30s   (rarely changes)
//   stats         → 6s
//   attacks feed  → 4s    (operator's eye is here)
//   network       → 12s
//   validators    → 15s
//
// The store subscribes by calling `startLive(store)` once from dashboard.js;
// we return a single stop() handle.

import { apiGet, isMockForced, startPoll } from './api.js';

const DEFAULTS = Object.freeze({
  health: null,
  stats: null,
  attacks: [],
  network: null,
  topology: null,
  validators: null,
  awsStatus: null,
  learning: null,
  lastError: null,
  lastUpdate: 0,
});

export function initialLiveState() {
  return { ...DEFAULTS, mockForced: isMockForced() };
}

/**
 * Wire up polling against `store`. Store must expose `patchLive(patch)`.
 * Returns a stop() function.
 */
export function startLive(store) {
  if (!store || typeof store.patchLive !== 'function') {
    throw new Error('startLive: store.patchLive missing');
  }

  const stops = [];

  // Touch these once on boot to prime the UI fast.
  const refreshHealth = async () => {
    const [health, aws] = await Promise.all([
      apiGet('/api/health'),
      apiGet('/api/aws/status'),
    ]);
    store.patchLive({
      health: health.ok ? health.data : null,
      awsStatus: aws.ok ? aws.data : null,
      lastError: health.ok && aws.ok ? null : (health.error || aws.error || null),
      lastUpdate: Date.now(),
    });
  };

  const refreshStats = async () => {
    const r = await apiGet('/api/stats');
    if (r.ok) store.patchLive({ stats: r.data, lastUpdate: Date.now() });
    else store.patchLive({ lastError: r.error });
  };

  const refreshAttacks = async () => {
    const r = await apiGet('/api/attacks?limit=80');
    if (r.ok) {
      store.patchLive({
        attacks: Array.isArray(r.data?.attacks) ? r.data.attacks : [],
        lastUpdate: Date.now(),
      });
    } else {
      store.patchLive({ lastError: r.error });
    }
  };

  const refreshNetwork = async () => {
    const r = await apiGet('/api/network');
    if (r.ok) store.patchLive({ network: r.data, lastUpdate: Date.now() });
  };

  const refreshTopology = async () => {
    const r = await apiGet('/api/network/topology');
    if (r.ok) store.patchLive({ topology: r.data, lastUpdate: Date.now() });
  };

  const refreshValidators = async () => {
    const r = await apiGet('/api/chain/validators');
    if (r.ok) store.patchLive({ validators: r.data, lastUpdate: Date.now() });
  };

  const refreshLearning = async () => {
    const r = await apiGet('/api/learning');
    if (r.ok) store.patchLive({ learning: r.data, lastUpdate: Date.now() });
  };

  stops.push(startPoll(refreshHealth, 30_000));
  stops.push(startPoll(refreshStats, 6_000));
  stops.push(startPoll(refreshAttacks, 4_000));
  stops.push(startPoll(refreshNetwork, 12_000));
  // Topology doesn't change at runtime (baked into each task's env) — poll
  // slowly just to re-establish after transient 503s during rolling deploys.
  stops.push(startPoll(refreshTopology, 45_000));
  stops.push(startPoll(refreshValidators, 15_000));
  stops.push(startPoll(refreshLearning, 20_000));

  return () => {
    for (const stop of stops) {
      try {
        stop();
      } catch {
        /* ignore */
      }
    }
  };
}
