import { html } from 'lit-html';
import { classMap } from 'lit-html/directives/class-map.js';
import { store } from '../state.js';
import { Icon } from '../icons.js';
import { privatize, computeRareBuckets, bucketTime } from '../privacy.js';
import { resolveVerdictPool } from '../../../lib/adapters.js';

const FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'block', label: 'Blocked', match: (a) => a.verdict === 'block' },
  { key: 'quar', label: 'Quarantined', match: (a) => a.verdict === 'quar' },
  { key: 'pass', label: 'Passed', match: (a) => a.verdict === 'pass' },
];

let activeFilter = 'all';
let searchTerm = '';

const summaryStat = (label, value, tone) => html`
  <div class=${classMap({ 'dash-summary-stat': true, [`is-${tone ?? 'neutral'}`]: true })}>
    <span class="dash-summary-label">${label}</span>
    <span class="dash-summary-value">${value}</span>
  </div>
`;

const attackRow = (a) => html`
  <tr
    @click=${() => store.openDrawer({ type: 'verdict', payload: a })}
    tabindex="0"
    @keydown=${(e) => { if (e.key === 'Enter') store.openDrawer({ type: 'verdict', payload: a }); }}
  >
    <td>${a.time}</td>
    <td>${a.agent}</td>
    <td>${a.mod}</td>
    <td><span class="dash-chip is-family">${a.family.replace(/_/g, ' ')}</span></td>
    <td class="hash">${a.hash}…</td>
    <td>${a.layer}</td>
    <td>${a.latencyMs} ms</td>
    <td style="text-align: right;"><span class="dash-badge is-${a.verdict}">${a.verdict}</span></td>
  </tr>
`;

export const attacksView = () => {
  const { live } = store.getState();
  const feed = resolveVerdictPool(live);
  const filterDef = FILTERS.find((f) => f.key === activeFilter) ?? FILTERS[0];
  const normalizedSearch = searchTerm.trim().toLowerCase();

  // Privacy pass: compute bucketed times first so k-anon grouping uses the
  // same bucket keys the user will see.
  const bucketed = feed.map((a) => ({ ...a, time: bucketTime(a.time) }));
  const rareBuckets = computeRareBuckets(bucketed);
  const privatized = feed.map((a) => privatize(a, rareBuckets));

  const rows = privatized.filter(filterDef.match).filter((a) => {
    if (!normalizedSearch) return true;
    return (
      (a.agent || '').toLowerCase().includes(normalizedSearch) ||
      (a.hash || '').toLowerCase().includes(normalizedSearch) ||
      (a.family || '').toLowerCase().includes(normalizedSearch) ||
      (a.mod || '').toLowerCase().includes(normalizedSearch)
    );
  });

  const blockedCount = feed.filter((a) => a.verdict === 'block').length;
  const quarCount = feed.filter((a) => a.verdict === 'quar').length;
  const passCount = feed.filter((a) => a.verdict === 'pass').length;
  const avgLatency = feed.length
    ? feed.reduce((sum, a) => sum + parseFloat(a.latencyMs || 0), 0) / feed.length
    : 0;

  const handleFilter = (key) => {
    activeFilter = key;
    store.toast(null, null);
    store.goto('attacks');
  };

  const handleSearch = (event) => {
    searchTerm = event.target.value;
    store.goto('attacks');
  };

  return html`
    <section class="dash-section">
      <div class="dash-page-header">
        <p class="dash-page-header-sub">
          Full detection feed. Click a row for the verdict, the matching detection
          layer, and the exact reason the pipeline blocked or held the payload.
        </p>
        <button class="btn btn-ghost" type="button" @click=${() => store.toast('ok', 'CSV export queued (mocked).')}>
          Export CSV
        </button>
      </div>

      <div class="dash-summary-grid">
        ${summaryStat('Total (24h)', feed.length, 'neutral')}
        ${summaryStat('Blocked', blockedCount, 'danger')}
        ${summaryStat('Quarantined', quarCount, 'warn')}
        ${summaryStat('Passed', passCount, 'ok')}
        ${summaryStat('Avg latency', `${avgLatency.toFixed(1)} ms`, 'neutral')}
      </div>

      <div class="dash-card">
        <div class="dash-card-header">
          <div class="dash-tabs" role="tablist" aria-label="Verdict filter">
            ${FILTERS.map(
              (f) => html`
                <button
                  class=${classMap({ 'dash-tab': true, 'is-active': f.key === activeFilter })}
                  type="button"
                  role="tab"
                  aria-selected=${f.key === activeFilter ? 'true' : 'false'}
                  @click=${() => handleFilter(f.key)}
                >
                  ${f.label}
                </button>
              `,
            )}
          </div>
          <label class="dash-search">
            <span class="dash-search-icon" aria-hidden="true">${Icon.search}</span>
            <input
              class="dash-search-input"
              type="search"
              placeholder="Filter by agent, hash, or family"
              .value=${searchTerm}
              @input=${handleSearch}
            />
          </label>
        </div>
        <div class="dash-table-wrap">
          <table class="dash-table is-interactive">
            <thead>
              <tr>
                <th style="width: 88px;">Time</th>
                <th style="width: 108px;">Agent</th>
                <th style="width: 76px;">Mod</th>
                <th>Family</th>
                <th style="width: 112px;">Fingerprint</th>
                <th style="width: 96px;">Layer</th>
                <th style="width: 90px;">Latency</th>
                <th style="width: 92px; text-align: right;">Verdict</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length
                ? rows.map(attackRow)
                : html`<tr><td colspan="8" class="dash-empty">No detections match this filter.</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="dash-table-foot">
          <span>${rows.length} of ${feed.length} detections</span>
          <div class="dash-pager">
            <button class="btn btn-ghost btn-sm" type="button" @click=${() => store.toast('info', 'Demo dataset is a single page.')}>Prev</button>
            <button class="btn btn-ghost btn-sm" type="button" @click=${() => store.toast('info', 'Demo dataset is a single page.')}>Next</button>
          </div>
        </div>
      </div>
    </section>
  `;
};
