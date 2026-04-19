// Privacy / anonymity layer.
//
// The operator should never be able to correlate a specific human to activity
// + timing ("user #55 is online at 2am reading emails"). This file centralizes
// the pseudonymization so every view uses the same scheme.
//
// Scheme:
//   1. Agent IDs are replaced with "anon-<8 hex>" derived from
//      HMAC-ish FNV(seat_seed || daily_salt). Rotates every UTC day.
//   2. Tenant (owner) domains collapse to "tenant-<4 hex>" — same seat keeps
//      the same tenant label for a single day, across agents.
//   3. Verdict timestamps quantize to 15-minute buckets, so a 02:14 event
//      becomes "02:00–02:15". The operator knows traffic shape, not precise
//      times.
//   4. K-anonymity: when fewer than K peers share the same (bucket, modality)
//      signature, the row's agent identifier is replaced with "anon-group".
//      This is a soft guard — hackathon demo — but communicates intent.
//
// When KMS + real per-seat pseudo-ids ship post-hackathon, this module stays
// as the boundary where plaintext is forbidden.

const K_ANON = 5;

const daySalt = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
};

// FNV-1a 32-bit — not crypto, just a stable hash for demo pseudonyms.
const fnv1a = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

export const anonAgentId = (seatSeed) => `anon-${fnv1a(`${seatSeed}|${daySalt()}`)}`;

export const anonTenant = (orgSeed) =>
  `tenant-${fnv1a(`${orgSeed}|${daySalt()}`).slice(0, 4)}`;

// Collapse an HH:MM:SS (or HH:MM) clock string to a 15-minute band like
// "14:00–14:15". Invalid input falls through unchanged.
export const bucketTime = (clock) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(clock || ''));
  if (!m) return clock || '—';
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const startMin = Math.floor(min / 15) * 15;
  const endMin = startMin + 15;
  const endH = endMin === 60 ? (h + 1) % 24 : h;
  const endMm = endMin === 60 ? 0 : endMin;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(startMin)}–${pad(endH)}:${pad(endMm)}`;
};

// Given a list of objects with { time (bucketed), mod }, return a Set of
// "bucket|mod" keys that appear fewer than K_ANON times. Rows in those buckets
// should have their agent identifier collapsed.
export const computeRareBuckets = (rows) => {
  const counts = new Map();
  for (const r of rows) {
    const key = `${r.time}|${r.mod}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const rare = new Set();
  for (const [key, c] of counts.entries()) {
    if (c < K_ANON) rare.add(key);
  }
  return rare;
};

export const isRareKey = (rareSet, time, mod) => rareSet.has(`${time}|${mod}`);

// Single entry point used by views when rendering an attack row — returns
// { agent, time } stripped of anything that could deanonymize the operator.
export const privatize = (row, rareSet) => {
  const bucket = bucketTime(row.time);
  const rare = rareSet && isRareKey(rareSet, bucket, row.mod);
  return {
    ...row,
    agent: rare ? 'anon-group' : anonAgentId(row.agent),
    time: bucket,
  };
};

export const K_ANON_THRESHOLD = K_ANON;
