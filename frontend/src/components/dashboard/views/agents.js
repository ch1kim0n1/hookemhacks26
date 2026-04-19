import { html } from 'lit-html';
import { classMap } from 'lit-html/directives/class-map.js';
import { AGENTS_LIST } from '../mock-data.js';
import { store } from '../state.js';
import { anonAgentId, anonTenant } from '../privacy.js';

const statusTone = {
  healthy: 'ok',
  warning: 'warn',
  maintenance: 'info',
  offline: 'danger',
};

// Synthesize additional rows so the page looks like a fleet, not a toy list.
const OWNER_POOL = ['acme.co', 'labs.internal', 'stellar.fi', 'northwind.io', 'altostrat.ai'];
const ROLE_POOL = [
  'Customer support', 'Email triage', 'Docs uploader', 'Research assistant',
  'Crawler companion', 'Finance ops', 'Sales operator', 'Contract reader',
  'Data room guard', 'Patch analyzer', 'Dev copilot', 'Ops responder',
  'Risk scanner', 'Knowledge base', 'Inventory checker',
];
const REGION_POOL = ['us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1'];
const MODEL_POOL = ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-7'];
const STATUS_WEIGHTS = ['healthy', 'healthy', 'healthy', 'healthy', 'healthy', 'healthy', 'warning', 'maintenance'];

const mulberry = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const synthesizeAgents = () => {
  const rand = mulberry(101);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const extras = Array.from({ length: 137 }).map((_, i) => {
    const idx = i + 13;
    const status = pick(STATUS_WEIGHTS);
    const hexId = (0x1000 + Math.floor(rand() * 0xefff)).toString(16);
    return {
      id: `agent-${hexId.slice(0, 4)}`,
      owner: pick(OWNER_POOL),
      role: pick(ROLE_POOL),
      model: pick(MODEL_POOL),
      region: pick(REGION_POOL),
      status,
      blocked24h: status === 'maintenance' ? 0 : Math.floor(rand() * 240),
      // Coarse last-seen: quarter-hour buckets so the operator cannot infer
      // sleep/wake patterns from this column.
      lastSeen: status === 'maintenance'
        ? `${(Math.floor(rand() * 4) + 1) * 15}m ago`
        : rand() > 0.5 ? 'within 15m' : 'within 1h',
      version: rand() > 0.15 ? 'cg-0.4.1' : 'cg-0.4.0',
      _idx: idx,
    };
  });
  return [...AGENTS_LIST, ...extras];
};

// Raw roster (contains the real seat + owner). NEVER rendered directly — the
// view applies anonAgentId + anonTenant to scrub before display.
const RAW_AGENTS = synthesizeAgents();

// Build the display view once per day (pseudonyms rotate daily). Recomputed on
// module evaluation because the browser reloads per session anyway.
const ALL_AGENTS = RAW_AGENTS.map((a) => ({
  ...a,
  _seat: a.id,
  _owner: a.owner,
  id: anonAgentId(a.id),
  owner: anonTenant(a.owner),
}));

// Local view state — not part of the global store since it's UI ephemera.
const tableState = {
  q: '',
  statusFilter: 'all',
  sortBy: 'blocked24h',
  sortDir: 'desc',
  page: 0,
  pageSize: 15,
};

const rerender = () => {
  // Touch the store to trigger the root re-render loop.
  store.goto('agents');
};

const filterAndSort = (rows) => {
  const q = tableState.q.trim().toLowerCase();
  let result = rows;
  if (q) {
    result = result.filter((r) =>
      r.id.toLowerCase().includes(q) ||
      r.owner.toLowerCase().includes(q) ||
      r.role.toLowerCase().includes(q) ||
      r.region.toLowerCase().includes(q),
    );
  }
  if (tableState.statusFilter !== 'all') {
    result = result.filter((r) => r.status === tableState.statusFilter);
  }
  const { sortBy, sortDir } = tableState;
  const dir = sortDir === 'asc' ? 1 : -1;
  result = [...result].sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (typeof av === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  return result;
};

const sortHeader = (key, label, active) => html`
  <th
    class=${classMap({ 'is-sorted': active })}
    @click=${() => {
      if (tableState.sortBy === key) {
        tableState.sortDir = tableState.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        tableState.sortBy = key;
        tableState.sortDir = 'desc';
      }
      tableState.page = 0;
      rerender();
    }}
  >
    ${label}${active ? (tableState.sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
  </th>
`;

const row = (a) => html`
  <tr
    tabindex="0"
    @click=${() => store.toast('info', `${a.id}: middleware log streaming (mocked).`)}
    @keydown=${(e) => { if (e.key === 'Enter') store.toast('info', `${a.id}: middleware log streaming (mocked).`); }}
  >
    <td class="agents-id">
      <span class="agents-status-dot is-${statusTone[a.status]}"></span>${a.id}
    </td>
    <td>${a.role}</td>
    <td>${a.owner}</td>
    <td>${a.model}</td>
    <td>${a.region}</td>
    <td>${a.blocked24h}</td>
    <td>${a.lastSeen}</td>
    <td>
      <span class=${classMap({ 'dash-pill': true, [`is-${statusTone[a.status]}`]: true })}>${a.status}</span>
    </td>
  </tr>
`;

export const agentsView = () => {
  const healthy = ALL_AGENTS.filter((a) => a.status === 'healthy').length;
  const warning = ALL_AGENTS.filter((a) => a.status === 'warning').length;
  const maintenance = ALL_AGENTS.filter((a) => a.status === 'maintenance').length;

  const filtered = filterAndSort(ALL_AGENTS);
  const pageCount = Math.max(1, Math.ceil(filtered.length / tableState.pageSize));
  tableState.page = Math.min(tableState.page, pageCount - 1);
  const pageRows = filtered.slice(
    tableState.page * tableState.pageSize,
    (tableState.page + 1) * tableState.pageSize,
  );

  const filterBtn = (key, label) => html`
    <button
      class=${classMap({ 'is-active': tableState.statusFilter === key })}
      type="button"
      @click=${() => { tableState.statusFilter = key; tableState.page = 0; rerender(); }}
    >
      ${label}
    </button>
  `;

  return html`
    <section class="dash-section">
      <div class="dash-page-header">
        <p class="dash-page-header-sub">
          Agents running the local ClawGuard middleware. Each one intercepts
          tool calls before they fire and streams verdicts back to this console.
        </p>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          @click=${() => store.toast('ok', 'Install token generated. Paste into your agent env (mocked).')}
        >
          Add agent
        </button>
      </div>

      <div class="dash-summary-grid">
        <div class="dash-summary-stat is-ok">
          <span class="dash-summary-label">Healthy</span>
          <span class="dash-summary-value">${healthy}</span>
        </div>
        <div class="dash-summary-stat is-warn">
          <span class="dash-summary-label">Warning</span>
          <span class="dash-summary-value">${warning}</span>
        </div>
        <div class="dash-summary-stat is-info">
          <span class="dash-summary-label">Maintenance</span>
          <span class="dash-summary-value">${maintenance}</span>
        </div>
        <div class="dash-summary-stat is-neutral">
          <span class="dash-summary-label">Total</span>
          <span class="dash-summary-value">${ALL_AGENTS.length}</span>
        </div>
      </div>

      <div class="agents-toolbar">
        <label class="agents-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            type="search"
            placeholder="Search by id, role, owner, or region…"
            .value=${tableState.q}
            @input=${(e) => { tableState.q = e.target.value; tableState.page = 0; rerender(); }}
            aria-label="Filter agents"
          />
        </label>
        <div class="agents-filter" role="tablist" aria-label="Status filter">
          ${filterBtn('all', 'All')}
          ${filterBtn('healthy', 'Healthy')}
          ${filterBtn('warning', 'Warning')}
          ${filterBtn('maintenance', 'Maintenance')}
        </div>
      </div>

      <div class="agents-table-wrap">
        <table class="agents-table">
          <thead>
            <tr>
              ${sortHeader('id', 'Agent', tableState.sortBy === 'id')}
              ${sortHeader('role', 'Role', tableState.sortBy === 'role')}
              ${sortHeader('owner', 'Owner', tableState.sortBy === 'owner')}
              ${sortHeader('model', 'Model', tableState.sortBy === 'model')}
              ${sortHeader('region', 'Region', tableState.sortBy === 'region')}
              ${sortHeader('blocked24h', 'Blocked 24h', tableState.sortBy === 'blocked24h')}
              ${sortHeader('lastSeen', 'Last seen', tableState.sortBy === 'lastSeen')}
              ${sortHeader('status', 'Status', tableState.sortBy === 'status')}
            </tr>
          </thead>
          <tbody>
            ${pageRows.length === 0
              ? html`<tr><td colspan="8" style="text-align:center; padding:24px; color: var(--color-muted);">No agents match your filter.</td></tr>`
              : pageRows.map(row)}
          </tbody>
        </table>
        <div class="agents-footer">
          <span>
            Showing ${pageRows.length ? tableState.page * tableState.pageSize + 1 : 0}–${tableState.page * tableState.pageSize + pageRows.length} of ${filtered.length}
          </span>
          <div class="agents-pager">
            <button
              type="button"
              ?disabled=${tableState.page === 0}
              @click=${() => { tableState.page = Math.max(0, tableState.page - 1); rerender(); }}
            >
              ← Prev
            </button>
            <button
              type="button"
              ?disabled=${tableState.page >= pageCount - 1}
              @click=${() => { tableState.page = Math.min(pageCount - 1, tableState.page + 1); rerender(); }}
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
};
