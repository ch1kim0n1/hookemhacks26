import { html } from 'lit-html';
import { Icon } from '../icons.js';
import { store } from '../state.js';
import { hourlyChart } from '../chart.js';
import { privatize, computeRareBuckets, bucketTime, K_ANON_THRESHOLD } from '../privacy.js';
import {
  resolveOverviewStats,
  resolveModalities,
  resolveVerdicts,
} from '../../../lib/adapters.js';

const pageHeader = (live) => {
  const stale = live?.lastUpdate
    ? Math.max(1, Math.round((Date.now() - live.lastUpdate) / 1000))
    : null;
  const isLive = !live?.mockForced && !!live?.health;
  const chipLabel = live?.mockForced
    ? 'mock data'
    : stale != null
      ? `updated ${stale}s ago`
      : 'connecting…';
  return html`
    <div class="dash-page-header">
      <p class="dash-page-header-sub">
        <strong>Blocked</strong> never reached the model.
        <strong>Quarantined</strong> was sanitized &amp; escalated.
        Confirmed attacks are published to Base Sepolia so peers short-circuit the pipeline on a ~5&nbsp;ms chain lookup.
      </p>
      <span class="dash-chip is-ghost">
        <span class="dash-dot" style=${isLive ? 'background:#1b7a94;' : ''}></span>
        ${chipLabel}
      </span>
    </div>
  `;
};

const statCard = (s) => html`
  <div class="dash-stat">
    <div class="dash-stat-label">
      ${Icon.info}
      <span>${s.label}</span>
    </div>
    <div class="dash-stat-value">${s.value}</div>
    <div class="dash-stat-delta ${s.deltaClass}">${s.delta}</div>
    <div class="dash-stat-hint">${s.hint}</div>
  </div>
`;

const chartCard = () => html`
  <div class="dash-card">
    <div class="dash-card-header">
      <div>
        <div class="dash-card-title">Attacks blocked — last 24h</div>
        <div class="dash-card-sub">hourly · includes cache hits from peers</div>
      </div>
      <div class="dash-tabs" role="tablist" aria-label="Chart time range">
        <button class="dash-tab is-active" type="button" role="tab" aria-selected="true">24h</button>
        <button class="dash-tab" type="button" role="tab" aria-selected="false" @click=${() => store.toast('info', 'Extended ranges are enabled on the paid plan.')}>7d</button>
        <button class="dash-tab" type="button" role="tab" aria-selected="false" @click=${() => store.toast('info', 'Extended ranges are enabled on the paid plan.')}>30d</button>
      </div>
    </div>
    ${hourlyChart()}
  </div>
`;

const modalityCard = (modalities) => {
  if (!modalities.length) {
    return html`
      <div class="dash-card">
        <div class="dash-card-header">
          <div>
            <div class="dash-card-title">By modality</div>
            <div class="dash-card-sub">where did the payload arrive from?</div>
          </div>
          <span class="dash-chip is-ghost">live</span>
        </div>
        <div class="dash-card-empty" style="padding:28px 8px;color:var(--color-muted);text-align:center;font-size:13px;">
          No payloads scanned on this node yet. Kick off <code>make demo</code>
          (or hit <code>/api/scan</code>) and this chart will populate.
        </div>
      </div>
    `;
  }
  const max = Math.max(1, ...modalities.map((m) => m.value));
  return html`
    <div class="dash-card">
      <div class="dash-card-header">
        <div>
          <div class="dash-card-title">By modality</div>
          <div class="dash-card-sub">where did the payload arrive from?</div>
        </div>
        <span class="dash-chip is-ghost">24h</span>
      </div>
      ${modalities.map(
        (m) => html`
          <div class="dash-mod-row">
            <span class="dash-mod-label">${m.label}</span>
            <div class="dash-mod-track">
              <div
                class="dash-mod-fill"
                data-mod-fill=${m.label}
                style="width: 0%; background: ${m.color};"
                data-target-pct=${(m.value / max) * 100}
              ></div>
            </div>
            <span class="dash-mod-value">${m.value}</span>
          </div>
        `,
      )}
    </div>
  `;
};

const verdictRow = (v) => html`
  <tr @click=${() => store.openDrawer({ type: 'verdict', payload: v })} tabindex="0" @keydown=${(e) => { if (e.key === 'Enter') store.openDrawer({ type: 'verdict', payload: v }); }}>
    <td>${v.time}</td>
    <td>${v.agent}</td>
    <td>${v.mod}</td>
    <td class="hash">${v.hash}…</td>
    <td style="text-align: right;">
      <span class="dash-badge is-${v.verdict}">${v.verdict}</span>
    </td>
  </tr>
`;

const verdictsCard = (verdicts) => {
  const raw = verdicts;
  const bucketed = raw.map((v) => ({ ...v, time: bucketTime(v.time) }));
  const rare = computeRareBuckets(bucketed);
  const rows = raw.map((v) => ({ ...privatize(v, rare), _raw: v }));
  return html`
  <div class="dash-card">
    <div class="dash-card-header">
      <div>
        <div class="dash-card-title">Recent verdicts</div>
        <div class="dash-card-sub">
          last 6 decisions · 15-min buckets · k-anon ≥ ${K_ANON_THRESHOLD}
        </div>
      </div>
      <button
        class="dash-card-link"
        type="button"
        @click=${() => store.goto('attacks')}
      >
        View all
        <span class="dash-arrow">${Icon.arrowRight}</span>
      </button>
    </div>
    <table class="dash-table is-interactive">
      <thead>
        <tr>
          <th style="width: 128px;">Window</th>
          <th style="width: 138px;">Agent</th>
          <th style="width: 92px;">Modality</th>
          <th>Fingerprint</th>
          <th style="width: 92px; text-align: right;">Verdict</th>
        </tr>
      </thead>
      <tbody>${rows.map(verdictRow)}</tbody>
    </table>
    <div class="dash-legend">
      <span class="dash-legend-item">
        <span class="dash-badge is-block">block</span>
        <span>refused — the agent never saw it</span>
      </span>
      <span class="dash-legend-item">
        <span class="dash-badge is-quar">quar</span>
        <span>sanitized &amp; held for human review</span>
      </span>
      <span class="dash-legend-item">
        <span class="dash-badge is-pass">pass</span>
        <span>clean input, forwarded to the agent</span>
      </span>
    </div>
  </div>
`;
};

const privacyCard = () => html`
  <div class="dash-card dash-privacy">
    <div class="dash-card-header">
      <div>
        <div class="dash-card-title">Privacy mode · on</div>
        <div class="dash-card-sub">what this console can &amp; cannot see</div>
      </div>
      <span class="dash-chip is-ghost">
        <span class="dash-dot" style="background:#1b7a94;"></span>
        anon layer active
      </span>
    </div>
    <div class="dash-privacy-grid">
      <div class="dash-privacy-item">
        <div class="dash-privacy-ico">${Icon.shield}</div>
        <div>
          <strong>Rotating pseudonyms.</strong>
          Agent IDs shown here are HMAC(seat · daily-salt) truncated to 8 hex.
          Yesterday's <code>anon-a2c4…</code> is not today's.
        </div>
      </div>
      <div class="dash-privacy-item">
        <div class="dash-privacy-ico">${Icon.info}</div>
        <div>
          <strong>Time bucketing.</strong>
          Every verdict time collapses to a 15-minute window. 02:14:03 renders as
          <code>02:00–02:15</code> — the operator sees shape, not timing.
        </div>
      </div>
      <div class="dash-privacy-item">
        <div class="dash-privacy-ico">${Icon.audit}</div>
        <div>
          <strong>K-anonymity guard.</strong>
          If fewer than ${K_ANON_THRESHOLD} peers share a (window, modality) bucket, the agent column is
          replaced with <code>anon-group</code>.
        </div>
      </div>
      <div class="dash-privacy-item">
        <div class="dash-privacy-ico">${Icon.key}</div>
        <div>
          <strong>KMS next.</strong>
          Production will pin seat seeds behind AWS KMS so this console never touches a
          raw user identifier — even transiently.
        </div>
      </div>
    </div>
  </div>
`;

const flowStage = (n, label, sub, tone = 'info') => html`
  <div class=${'dash-flow-stage is-' + tone}>
    <div class="dash-flow-stage-num">${n}</div>
    <div class="dash-flow-stage-body">
      <div class="dash-flow-stage-label">${label}</div>
      <div class="dash-flow-stage-sub">${sub}</div>
    </div>
  </div>
`;

const threatFlowCard = () => html`
  <div class="dash-card">
    <div class="dash-card-header">
      <div>
        <div class="dash-card-title">Threat flow — anatomy of a block</div>
        <div class="dash-card-sub">every inbound payload walks this pipeline · short-circuits on first hit</div>
      </div>
      <span class="dash-chip is-ghost">avg 11.3&nbsp;ms end-to-end</span>
    </div>
    <div class="dash-flow">
      ${flowStage('1', 'Extract', 'PDF · email · image · audio · html → text', 'info')}
      ${flowStage('2', 'SHA-256', 'stable content fingerprint', 'info')}
      ${flowStage('3', 'Chain cache', '~5 ms · hit = instant block', 'ok')}
      ${flowStage('4', 'Rules', '30 regex · severity gate', 'warn')}
      ${flowStage('5', 'Classifier', 'deberta-v3 prompt-injection', 'warn')}
      ${flowStage('6', 'LLM judge', 'Claude Haiku · fails closed', 'danger')}
      ${flowStage('7', 'Verdict', 'block · sanitize · pass', 'neutral')}
    </div>
  </div>
`;

export const overviewView = () => {
  const { live, verdicts: streamedVerdicts } = store.getState();
  const stats = resolveOverviewStats(live);
  const modalities = resolveModalities(live);
  // If we have live attacks, prefer those; otherwise stick with the streamed
  // mock verdicts so the table never goes empty.
  const liveVerdicts = resolveVerdicts(live);
  const rows = live?.mockForced || liveVerdicts.length === 0
    ? streamedVerdicts
    : liveVerdicts;
  return html`
    ${pageHeader(live)}
    <div class="dash-stats">${stats.map(statCard)}</div>
    <div class="dash-row">
      ${chartCard()}
      ${modalityCard(modalities)}
    </div>
    ${verdictsCard(rows)}
  `;
};
