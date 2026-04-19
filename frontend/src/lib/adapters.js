// Translate raw FastAPI responses into the shapes the mock-data views expect.
// Keeps the live<->mock swap trivial: each view asks `resolve*()` which
// picks live data when available and mock data otherwise.
//
// Design goal: never return empty arrays — an empty dashboard mid-demo looks
// broken. If the backend hasn't seen any detections yet, we fall back to the
// mock pool so there is always *something* on screen, and the topbar chip
// tells the operator whether the data is live or mock.

import {
  OVERVIEW_STATS,
  MODALITIES,
  HOURLY,
  VERDICT_POOL,
  INITIAL_VERDICTS,
} from '../components/dashboard/mock-data.js';

const pad2 = (n) => String(n).padStart(2, '0');

const timeFromUnix = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

/**
 * Best-effort live → mock-shape conversion for one detection row. If the
 * backend forgets a field we back-fill with something sensible instead of
 * rendering "undefined" in the UI.
 */
const detectionToVerdict = (det) => {
  const verdict =
    det.verdict === 'sanitize'
      ? 'quar'
      : det.verdict === 'block'
        ? 'block'
        : 'pass';
  const hashSource = det.content_hash || '';
  const hash = hashSource
    ? `0x${hashSource.slice(0, 6)}`
    : '0x' + Math.random().toString(16).slice(2, 8);
  const mod = (det.modality || 'TEXT').toUpperCase();
  const reasons = Array.isArray(det.reasons) ? det.reasons : [];
  const family =
    (reasons[0] && reasons[0].replace(/:.*/, '').trim()) || 'unknown';
  return {
    time: timeFromUnix(det.timestamp),
    agent: det.tool_name || 'openclaw',
    mod: mod.slice(0, 5),
    hash,
    verdict,
    family,
    confidence: typeof det.confidence === 'number' ? det.confidence.toFixed(2) : '—',
    payload: det.content_preview || '',
    layer: reasons[0] ? reasons[0].split(':')[0] : 'pipeline',
    classifierScore: det.confidence ?? 0,
    judgeScore: det.confidence ?? 0,
    peerConfirmations: 0,
    txHash: '—',
    region: 'us-east-1',
    latencyMs: 11,
    rulesMatched: [],
    sanitized: det.content_preview ? '[sanitized]' : '',
    remediation: '',
  };
};

export function resolveVerdicts(live) {
  if (live?.mockForced) return [...INITIAL_VERDICTS];
  const arr = Array.isArray(live?.attacks) ? live.attacks : [];
  // When backend is connected (health present), trust it even if empty.
  // An empty real feed is more honest than stale mock data.
  if (live?.health) return arr.slice(0, 16).map(detectionToVerdict);
  return [...INITIAL_VERDICTS];
}

export function resolveOverviewStats(live) {
  if (live?.mockForced) return OVERVIEW_STATS;
  if (!live?.stats) {
    // Backend hasn't answered yet — show empty real shape, not mock.
    if (live?.health) {
      return [
        { label: 'BLOCKED · LIVE', value: '0', delta: 'no detections yet', deltaClass: 'flat', hint: 'Live — /api/stats.' },
        { label: 'CHAIN CACHE', value: String(live?.health?.cached_threats ?? 0), delta: live?.health?.chain_available ? 'Base Sepolia · live' : 'chain offline', deltaClass: 'flat', hint: 'Hashes cached from ThreatRegistry.' },
        { label: 'AGENTS ONLINE', value: '1', delta: 'this node', deltaClass: 'flat', hint: '/api/network.' },
        { label: 'TOTAL SCANS', value: '0', delta: `api v${live?.health?.version ?? ''}`.trim() || 'api live', deltaClass: 'flat', hint: 'intercept() invocations.' },
      ];
    }
    return OVERVIEW_STATS;
  }
  const s = live.stats;
  const v = s.by_verdict || {};
  const blocked = (v.block || 0) + (v.sanitize || 0);
  const sanitized = v.sanitize || 0;
  const threats = s.cached_threats ?? live?.health?.cached_threats ?? 0;
  const nodes = live?.network?.nodes?.length ?? 0;
  return [
    {
      label: 'BLOCKED · LIVE',
      value: String(blocked),
      delta: `${v.block || 0} blocks · ${sanitized} quarantined`,
      deltaClass: blocked > 0 ? 'up' : 'flat',
      hint: 'Detections served by this API since its last boot. Pulled from /api/stats.',
    },
    {
      label: 'CHAIN CACHE',
      value: String(threats),
      delta: live?.health?.chain_available ? 'Base Sepolia · live' : 'chain offline',
      deltaClass: live?.health?.chain_available ? 'up' : 'flat',
      hint: 'Threat hashes cached from the on-chain ThreatRegistry.',
    },
    {
      label: 'AGENTS ONLINE',
      value: String(Math.max(nodes, 1)),
      delta: live?.network?.peer_urls_configured?.length
        ? `${live.network.peer_urls_configured.length} peers`
        : 'standalone',
      deltaClass: 'flat',
      hint: 'OpenClaw agents reported by /api/network.',
    },
    {
      label: 'TOTAL SCANS',
      value: String(s.total_scans ?? 0),
      delta: live?.health?.version ? `api v${live.health.version}` : 'api live',
      deltaClass: 'flat',
      hint: 'Every invocation of the intercept() hook since last boot.',
    },
  ];
}

export function resolveModalities(live) {
  if (live?.mockForced) return MODALITIES;
  if (!live?.stats) return live?.health ? [] : MODALITIES;
  const raw = live.stats.by_modality || {};
  const entries = Object.entries(raw);
  if (!entries.length) return [];
  const colors = [
    'var(--color-ocean-800)',
    'var(--color-ocean-600)',
    'var(--color-crab)',
    'var(--color-crab-2)',
    'var(--color-muted)',
  ];
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value], i) => ({
      label: String(label || '?').toUpperCase().slice(0, 6),
      value,
      color: colors[i] ?? colors[colors.length - 1],
    }));
}

export function resolveHourly(live) {
  if (live?.mockForced) return HOURLY;
  if (!live?.stats) return live?.health ? new Array(24).fill(0) : HOURLY;
  const rows = live.stats.hourly_blocks || [];
  if (!rows.length) return new Array(24).fill(0);
  const now = Math.floor(Date.now() / 1000 / 3600);
  const buckets = new Array(24).fill(0);
  for (const r of rows) {
    const hourAgo = now - Math.floor(r.hour / 3600);
    const idx = 23 - hourAgo;
    if (idx >= 0 && idx < 24) buckets[idx] = r.count;
  }
  return buckets;
}

export function resolveVerdictPool(live) {
  if (live?.mockForced) return VERDICT_POOL;
  const arr = Array.isArray(live?.attacks) ? live.attacks : [];
  if (live?.health) return arr.slice(0, 50).map(detectionToVerdict);
  return VERDICT_POOL;
}

// Synthetic mesh used in mock/killswitch mode so the registry graph has
// something to render when the backend is intentionally disconnected. Mirrors
// the production fabric shape (6 peer-a + 6 peer-b + 2 validators, ring +
// chord + validator edges, max 3 outbound / node).
const MOCK_TOPOLOGY = (() => {
  const regions = ['us-east-1', 'eu-west-1', 'ap-southeast-1'];
  const mkPeer = (group, i) => ({
    id: `peer-${group}${i}`,
    role: 'peer',
    region: regions[i % regions.length],
    tenant: `${group === 'a' ? 'acme' : 'globex'}-${i}`,
  });
  const groupA = Array.from({ length: 6 }, (_, i) => mkPeer('a', i));
  const groupB = Array.from({ length: 6 }, (_, i) => mkPeer('b', i));
  const validators = [
    { id: 'validator-0', role: 'validator', region: 'us-east-1', tenant: 'clawguard-core' },
    { id: 'validator-1', role: 'validator', region: 'eu-west-1', tenant: 'clawguard-core' },
  ];
  const nodes = [...groupA, ...groupB, ...validators];
  const edges = [];
  const ringAndChord = (group, validatorId) => {
    const n = group.length;
    for (let i = 0; i < n; i += 1) {
      edges.push({ from: group[i].id, to: group[(i + 1) % n].id });
      edges.push({ from: group[i].id, to: group[(i + 3) % n].id });
      edges.push({ from: group[i].id, to: validatorId });
    }
  };
  ringAndChord(groupA, 'validator-0');
  ringAndChord(groupB, 'validator-1');
  edges.push({ from: 'validator-0', to: 'validator-1' });
  edges.push({ from: 'validator-1', to: 'validator-0' });
  return {
    selfId: 'peer-a0',
    selfRole: 'peer',
    source: 'mock',
    nodes,
    edges,
  };
})();

const MOCK_VALIDATORS = {
  available: true,
  latest_block: 18923472,
  window: 8,
  validators: [
    { address: '0x4200000000000000000000000000000000000011', blocks_recent: 4 },
    { address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045', blocks_recent: 3 },
    { address: '0x6fC03fC4d0ec6b51e3B6e11c2c3b9F19d4Af3b2a', blocks_recent: 2 },
  ],
};

export function resolveValidators(live) {
  if (live?.mockForced) return MOCK_VALIDATORS;
  return live?.validators || null;
}

/**
 * Normalize the network/topology payload into {nodes, edges} with enough
 * metadata for the registry graph. Returns null until the API answers so
 * the graph can render a loading placeholder.
 */
export function resolveTopology(live) {
  if (live?.mockForced) return MOCK_TOPOLOGY;
  const t = live?.topology;
  if (!t || !Array.isArray(t.nodes) || t.nodes.length === 0) return null;
  return {
    selfId: t.self_id || null,
    selfRole: t.self_role || null,
    source: t.source || 'unknown',
    nodes: t.nodes.map((n) => ({
      id: String(n.id || ''),
      role: String(n.role || 'peer'),
      region: String(n.region || '—'),
      tenant: String(n.tenant || '—'),
    })),
    edges: (Array.isArray(t.edges) ? t.edges : []).map((e) => ({
      from: String(e.from || ''),
      to: String(e.to || ''),
    })).filter((e) => e.from && e.to),
  };
}
