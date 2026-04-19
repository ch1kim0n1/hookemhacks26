import { html } from 'lit-html';
import { classMap } from 'lit-html/directives/class-map.js';
import { Icon } from './icons.js';
import { store } from './state.js';

// Which nav entry is active + what the topbar shows for each route.
const ROUTES = {
  overview: { label: 'Overview', sub: 'threat pipeline · last 24h' },
  attacks: { label: 'Attacks', sub: 'detections · filter and inspect' },
  registry: { label: 'Registry', sub: 'on-chain intel · base sepolia' },
  agents: { label: 'Agents', sub: 'fleet health · middleware builds' },
  audit: { label: 'Audit log', sub: 'actor · action · outcome' },
  settings: { label: 'Settings', sub: 'profile · keys · notifications' },
  aws: { label: 'AWS', sub: 'cheat sheet · services & where they\u2019re used' },
};

const NAV_SECTIONS = [
  {
    label: 'Monitor',
    items: [
      { key: 'overview', label: 'Overview', icon: Icon.overview, count: null },
      { key: 'attacks', label: 'Attacks', icon: Icon.attacks, count: '1.8k' },
      { key: 'registry', label: 'Registry', icon: Icon.registry, count: '8' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { key: 'agents', label: 'Agents', icon: Icon.agents, count: '149' },
      { key: 'audit', label: 'Audit log', icon: Icon.audit, count: null },
      { key: 'settings', label: 'Settings', icon: Icon.settings, count: null },
    ],
  },
  {
    label: 'Reference',
    items: [
      { key: 'aws', label: 'AWS services', icon: Icon.cloud, count: '6' },
    ],
  },
];

const navButton = (item, activeKey) => {
  const classes = classMap({
    'dash-nav-item': true,
    'is-active': item.key === activeKey,
  });
  return html`
    <button
      class=${classes}
      type="button"
      aria-current=${item.key === activeKey ? 'page' : 'false'}
      @click=${() => store.goto(item.key)}
    >
      ${item.icon}
      <span>${item.label}</span>
      ${item.count ? html`<span class="dash-nav-count">${item.count}</span>` : ''}
    </button>
  `;
};

const sidebar = (activeKey) => html`
  <aside class="dash-side" aria-label="Primary navigation">
    ${NAV_SECTIONS.map(
      (section) => html`
        <div class="dash-side-section">${section.label}</div>
        <nav class="dash-nav">
          ${section.items.map((item) => navButton(item, activeKey))}
        </nav>
      `,
    )}
    <div class="dash-side-footer">
      <div class="dash-side-footer-row">
        <span class="dash-side-footer-label">Build</span>
        <code class="dash-side-footer-value">cg-0.4.1</code>
      </div>
      <div class="dash-side-footer-row">
        <span class="dash-side-footer-label">Commit</span>
        <code class="dash-side-footer-value">a7f20e4</code>
      </div>
      <div class="dash-side-footer-row">
        <span class="dash-side-footer-label">Registry</span>
        <code class="dash-side-footer-value" title="ThreatRegistry on Base Sepolia · chain id 84532">0x7fa2…c3a2</code>
      </div>
    </div>
  </aside>
`;

const userMenu = (session) => html`
  <div class="dash-user-menu" role="menu" aria-label="User menu">
    <div class="dash-user-menu-head">
      <span class="dash-avatar" aria-hidden="true">${session.initials}</span>
      <div class="dash-user-menu-meta">
        <span class="dash-user-menu-name">${session.name}</span>
        <span class="dash-user-menu-email">${session.email}</span>
      </div>
    </div>
    <button
      class="dash-user-menu-item"
      type="button"
      role="menuitem"
      @click=${() => store.goto('settings', { section: 'profile' })}
    >
      ${Icon.user}
      <span>Profile &amp; security</span>
    </button>
    <button
      class="dash-user-menu-item"
      type="button"
      role="menuitem"
      @click=${() => store.goto('settings', { section: 'api-keys' })}
    >
      ${Icon.key}
      <span>Personal API keys</span>
    </button>
    <button
      class="dash-user-menu-item"
      type="button"
      role="menuitem"
      @click=${() => store.goto('settings', { section: 'notifications' })}
    >
      ${Icon.bell}
      <span>Notifications</span>
    </button>
    <div class="dash-user-menu-divider"></div>
    <button
      class="dash-user-menu-item is-danger"
      type="button"
      role="menuitem"
      @click=${() => store.signOut()}
    >
      ${Icon.signOut}
      <span>Sign out</span>
    </button>
  </div>
`;

const topbar = (routeKey, session, userMenuOpen) => {
  const meta = ROUTES[routeKey] ?? ROUTES.overview;
  return html`
    <header class="dash-top">
      <a class="dash-top-brand" href="/" aria-label="Back to the ClawGuardian landing page">
        <img class="dash-top-logo-img" src="/logo.png" alt="" width="26" height="26" />
        <span class="dash-top-brand-name">ClawGuardian</span>
      </a>
      <div class="dash-top-title">
        <h1>${meta.label}</h1>
        <span class="dash-top-sub">${meta.sub}</span>
      </div>
      <div class="dash-top-right">
        <div class="dash-user-wrap">
          <button
            class=${classMap({ 'dash-user-btn': true, 'is-open': userMenuOpen })}
            type="button"
            aria-haspopup="menu"
            aria-expanded=${userMenuOpen ? 'true' : 'false'}
            @click=${(e) => { e.stopPropagation(); store.toggleUserMenu(); }}
          >
            <span class="dash-avatar" aria-hidden="true">${session.initials}</span>
            <span class="dash-user-meta">
              <span class="dash-user-name">${session.name}</span>
              <span class="dash-user-role">${session.role} · ${session.org}</span>
            </span>
            <span class="dash-user-chevron" aria-hidden="true">${Icon.chevron}</span>
          </button>
          ${userMenuOpen ? userMenu(session) : ''}
        </div>
      </div>
    </header>
  `;
};

// Severity → pill tone for rule chips.
const severityTone = { critical: 'danger', high: 'warn', medium: 'info', low: 'ok' };

const scoreBar = (label, value, tone = 'info') => {
  const pct = Math.round((value ?? 0) * 100);
  return html`
    <div class=${'dash-score is-' + tone}>
      <div class="dash-score-head">
        <span>${label}</span>
        <span class="dash-score-value">${pct}%</span>
      </div>
      <div class="dash-score-track"><div class="dash-score-fill" style="width: ${pct}%"></div></div>
    </div>
  `;
};

// Drawer: verdict detail panel, slides in from the right. Packed with
// forensic detail — payload preview, matched rules, classifier + judge scores,
// peer confirmations, sanitized diff, remediation.
const verdictDrawer = (verdict) => {
  const verdictToneMap = { block: 'danger', quar: 'warn', pass: 'ok' };
  const tone = verdictToneMap[verdict.verdict] || 'info';
  const rules = verdict.rulesMatched || [];
  const txShort = verdict.txHash || '—';
  return html`
    <div
      class="dash-drawer-scrim"
      @click=${() => store.closeDrawer()}
    ></div>
    <aside class="dash-drawer is-wide" role="dialog" aria-label="Verdict detail">
      <header class="dash-drawer-head">
        <div>
          <span class="dash-drawer-kicker">
            Verdict ·
            <span class=${'dash-badge is-' + verdict.verdict}>${verdict.verdict}</span>
          </span>
          <h2 class="dash-drawer-title">${verdict.hash}…</h2>
          <div class="dash-drawer-subtitle">
            ${verdict.family?.replace(/_/g, ' ') ?? '—'} · caught at
            <strong>${verdict.layer ?? '—'}</strong> layer
          </div>
        </div>
        <button
          class="icon-btn"
          type="button"
          aria-label="Close"
          @click=${() => store.closeDrawer()}
        >
          ${Icon.close}
        </button>
      </header>

      <dl class="dash-drawer-dl">
        <div><dt>Agent</dt><dd>${verdict.agent}</dd></div>
        <div><dt>Modality</dt><dd>${verdict.mod}</dd></div>
        <div><dt>Window</dt><dd>${verdict.time ?? '—'}</dd></div>
        <div><dt>Region</dt><dd>${verdict.region ?? '—'}</dd></div>
        <div><dt>Latency</dt><dd>${verdict.latencyMs ?? '—'} ms</dd></div>
        <div><dt>Confidence</dt><dd>${verdict.confidence ?? '—'}</dd></div>
      </dl>

      <section class="dash-drawer-section">
        <h3>Payload · what the attacker sent</h3>
        <pre class="dash-drawer-pre">${verdict.payload || '[no payload captured — verdict from cache hit]'}</pre>
      </section>

      <section class="dash-drawer-section">
        <h3>Matched rules</h3>
        ${rules.length
          ? html`<div class="dash-rules">
              ${rules.map(
                (r) => html`
                  <div class="dash-rule">
                    <div class="dash-rule-head">
                      <span class=${'dash-pill is-' + (severityTone[r.severity] || 'info')}>
                        ${r.id} · ${r.severity}
                      </span>
                      <span class="dash-rule-name">${r.name}</span>
                    </div>
                    <code class="dash-rule-regex">${r.regex}</code>
                  </div>
                `,
              )}
            </div>`
          : html`<p>No rules fired — this verdict was driven by the classifier or judge layer.</p>`}
      </section>

      <section class="dash-drawer-section">
        <h3>Detector scores</h3>
        <div class="dash-scores">
          ${scoreBar('Classifier · deberta-v3', verdict.classifierScore ?? 0, tone)}
          ${scoreBar('Judge · claude-haiku-4-5', verdict.judgeScore ?? 0, tone)}
        </div>
        <p class="dash-drawer-meta">
          The pipeline short-circuits on the first layer that crosses its threshold.
          This verdict reached the <strong>${verdict.layer ?? 'unknown'}</strong> layer before a decision.
        </p>
      </section>

      ${verdict.sanitized
        ? html`
            <section class="dash-drawer-section">
              <h3>Sanitized output · what the agent actually saw</h3>
              <pre class="dash-drawer-pre dash-drawer-pre-ok">${verdict.sanitized}</pre>
            </section>
          `
        : ''}

      <section class="dash-drawer-section">
        <h3>Peer consensus &amp; chain intel</h3>
        <div class="dash-peer-stack">
          <div class="dash-peer-row">
            <span class="dash-peer-dot"></span>
            <span class="dash-peer-label">Confirmed by peers</span>
            <strong>${verdict.peerConfirmations ?? 0}</strong>
          </div>
          <div class="dash-peer-row">
            <span class="dash-peer-dot is-chain"></span>
            <span class="dash-peer-label">Published to Base Sepolia</span>
            <code class="dash-peer-tx">${txShort}</code>
          </div>
        </div>
      </section>

      ${verdict.remediation
        ? html`
            <section class="dash-drawer-section dash-drawer-remed">
              <h3>Suggested remediation</h3>
              <p>${verdict.remediation}</p>
            </section>
          `
        : ''}

      <footer class="dash-drawer-foot">
        <button
          class="btn btn-ghost"
          type="button"
          @click=${() => { store.closeDrawer(); store.goto('registry'); }}
        >
          Open in registry
        </button>
        <button
          class="btn btn-primary"
          type="button"
          @click=${() => { store.toast('ok', `Intel for ${verdict.hash}… re-published.`); store.closeDrawer(); }}
        >
          Re-publish intel
        </button>
      </footer>
    </aside>
  `;
};

const toastView = (toast) => html`
  <div class=${classMap({ 'dash-toast': true, [`is-${toast.tone}`]: true })} role="status">
    ${toast.tone === 'ok' ? html`<span class="dash-toast-icon">${Icon.check}</span>` : ''}
    <span>${toast.text}</span>
    <button class="dash-toast-close" type="button" aria-label="Dismiss" @click=${() => store.clearToast()}>
      ${Icon.close}
    </button>
  </div>
`;

export const shell = (main) => {
  const state = store.getState();
  if (!state.session) return main;
  return html`
    <div class="dash">
      ${topbar(state.route, state.session, state.userMenuOpen)}
      ${sidebar(state.route)}
      <main class="dash-main" @click=${() => store.closeUserMenu()}>${main}</main>
      ${state.drawer?.type === 'verdict' ? verdictDrawer(state.drawer.payload) : ''}
      ${state.toast ? toastView(state.toast) : ''}
    </div>
  `;
};
