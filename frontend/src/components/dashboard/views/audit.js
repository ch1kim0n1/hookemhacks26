import { html } from 'lit-html';
import { classMap } from 'lit-html/directives/class-map.js';
import { AUDIT_LOG } from '../mock-data.js';
import { store } from '../state.js';
import { Icon } from '../icons.js';

const outcomeToTone = {
  ok: 'ok',
  blocked: 'danger',
  resolved: 'info',
  pending: 'warn',
};

// Local view state — filter + search + which row is expanded.
const viewState = {
  filter: 'all',
  search: '',
  expanded: null,
};

const FILTERS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'auth', label: 'Auth', match: (r) => r.action.startsWith('auth.') || r.action === 'session.login' },
  { key: 'chain', label: 'Chain', match: (r) => r.action.startsWith('chain.') },
  { key: 'agent', label: 'Agents', match: (r) => r.action.startsWith('agent.') },
  { key: 'security', label: 'Security', match: (r) => r.action === 'rule.update' || r.action === 'apikey.rotate' || r.action === 'alert.fire' },
];

const rerender = () => store.goto('audit');

// Deterministic pseudo-ip so the row detail pane has realistic-looking forensic
// data without ever exposing real operator ips in the demo fixtures.
const pseudoIp = (idx) => {
  const a = (91 + ((idx * 7) % 100));
  const b = 214 + ((idx * 13) % 20);
  return `${a}.${b}.x.x`;
};

const auditRow = (r, idx) => {
  const isOpen = viewState.expanded === idx;
  const signature = `${r.time.replace(/[^0-9]/g, '').slice(-8)}-${idx.toString(16).padStart(2, '0')}`;
  return html`
    <tr
      class=${classMap({ 'audit-row': true, 'is-open': isOpen })}
      tabindex="0"
      @click=${() => { viewState.expanded = isOpen ? null : idx; rerender(); }}
      @keydown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); viewState.expanded = isOpen ? null : idx; rerender(); } }}
    >
      <td>
        <span class="audit-chev" aria-hidden="true">${isOpen ? '▾' : '▸'}</span>
        <code class="audit-time">${r.time}</code>
      </td>
      <td class="audit-actor">${r.actor}</td>
      <td><span class="dash-chip is-action">${r.action}</span></td>
      <td class="audit-target">${r.target}</td>
      <td>
        <span class=${classMap({ 'dash-pill': true, [`is-${outcomeToTone[r.outcome]}`]: true })}>
          ${r.outcome}
        </span>
      </td>
      <td class="audit-note">${r.note}</td>
    </tr>
    ${isOpen
      ? html`
          <tr class="audit-detail-row">
            <td colspan="6">
              <div class="audit-detail">
                <div class="audit-detail-grid">
                  <div>
                    <dt>Event ID</dt>
                    <dd><code>evt_${signature}</code></dd>
                  </div>
                  <div>
                    <dt>Timestamp (UTC)</dt>
                    <dd><code>${r.time}</code></dd>
                  </div>
                  <div>
                    <dt>Actor</dt>
                    <dd>${r.actor}</dd>
                  </div>
                  <div>
                    <dt>Source IP</dt>
                    <dd><code>${pseudoIp(idx)}</code></dd>
                  </div>
                  <div>
                    <dt>Action</dt>
                    <dd><code>${r.action}</code></dd>
                  </div>
                  <div>
                    <dt>Target</dt>
                    <dd><code>${r.target}</code></dd>
                  </div>
                  <div>
                    <dt>Outcome</dt>
                    <dd>${r.outcome}</dd>
                  </div>
                  <div>
                    <dt>Row SHA-256</dt>
                    <dd><code>0x${signature}…</code></dd>
                  </div>
                </div>
                <div class="audit-detail-note">
                  <div class="audit-detail-label">Note</div>
                  <p>${r.note}</p>
                </div>
                <div class="audit-detail-actions">
                  <button
                    class="btn btn-ghost btn-sm"
                    type="button"
                    @click=${(e) => {
                      e.stopPropagation();
                      navigator.clipboard?.writeText(JSON.stringify(r, null, 2)).catch(() => {});
                      store.toast('ok', 'Audit row copied as JSON.');
                    }}
                  >
                    ${Icon.copy}
                    <span>Copy JSON</span>
                  </button>
                  <button
                    class="btn btn-ghost btn-sm"
                    type="button"
                    @click=${(e) => {
                      e.stopPropagation();
                      store.toast('info', `Linked events for ${r.actor} (mocked).`);
                    }}
                  >
                    View related events
                  </button>
                </div>
              </div>
            </td>
          </tr>
        `
      : ''}
  `;
};

const storageNote = () => html`
  <aside class="audit-storage">
    <div class="audit-storage-ico">${Icon.audit}</div>
    <div class="audit-storage-body">
      <div class="audit-storage-title">Where does this log live?</div>
      <p>
        Every row is written by <code>skill.db.log_detection</code> and the
        <code>_audit_tool_intercept</code> hook in <code>skill/handler.py</code>
        to the <code>audit_log</code> table — <strong>not DynamoDB</strong>.
        Locally that's SQLite (<code>clawguard.db</code>); in production it's
        Postgres behind the same SQLAlchemy layer. Schema is managed by Alembic
        migration&nbsp;002 and indexed via migration&nbsp;003.
      </p>
      <p>
        Row integrity is verified by replaying the SHA-256 column against the
        event body on export. Chain events additionally have an on-chain
        counterpart in <code>ThreatRegistry</code> on Base Sepolia — the
        <code>chain.publish</code> rows link to a transaction hash you can audit
        independently.
      </p>
    </div>
  </aside>
`;

export const auditView = () => {
  const filterDef = FILTERS.find((f) => f.key === viewState.filter) ?? FILTERS[0];
  const search = viewState.search.trim().toLowerCase();
  const rows = AUDIT_LOG
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => filterDef.match(r))
    .filter(({ r }) => {
      if (!search) return true;
      return [r.actor, r.action, r.target, r.note, r.outcome]
        .some((f) => String(f).toLowerCase().includes(search));
    });

  const onFilter = (key) => {
    viewState.filter = key;
    viewState.expanded = null;
    rerender();
  };

  return html`
    <section class="dash-section">
      <div class="dash-page-header">
        <p class="dash-page-header-sub">
          Every admin action, login, rule update, and chain event — with the
          actor, target, outcome, and the raw note. Click a row to inspect the
          full event record. This is what a SOC reviewer reads first during an
          incident.
        </p>
        <button
          class="btn btn-ghost btn-sm"
          type="button"
          @click=${() => {
            const payload = JSON.stringify(AUDIT_LOG, null, 2);
            navigator.clipboard?.writeText(payload).catch(() => {});
            store.toast('ok', `${AUDIT_LOG.length} rows copied as JSON.`);
          }}
        >
          Export JSON
        </button>
      </div>

      <div class="dash-card">
        <div class="dash-card-header">
          <div class="dash-tabs" role="tablist" aria-label="Audit filter">
            ${FILTERS.map(
              (f) => html`
                <button
                  class=${classMap({ 'dash-tab': true, 'is-active': f.key === viewState.filter })}
                  type="button"
                  role="tab"
                  aria-selected=${f.key === viewState.filter ? 'true' : 'false'}
                  @click=${() => onFilter(f.key)}
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
              placeholder="Filter by actor, target, action, note…"
              .value=${viewState.search}
              @input=${(e) => { viewState.search = e.target.value; viewState.expanded = null; rerender(); }}
            />
          </label>
        </div>
        <div class="dash-table-wrap">
          <table class="dash-table audit-table">
            <thead>
              <tr>
                <th style="width: 200px;">Time</th>
                <th style="width: 180px;">Actor</th>
                <th style="width: 168px;">Action</th>
                <th style="width: 220px;">Target</th>
                <th style="width: 110px;">Outcome</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length
                ? rows.map(({ r, i }) => auditRow(r, i))
                : html`<tr><td colspan="6" class="dash-empty">No events match this filter.</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="dash-table-foot">
          <span>${rows.length} of ${AUDIT_LOG.length} events · last 24h</span>
          <span class="audit-retention">Retained 90 days · immutable</span>
        </div>
      </div>

      ${storageNote()}
    </section>
  `;
};
