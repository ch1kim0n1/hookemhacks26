import { html } from 'lit-html';
import { classMap } from 'lit-html/directives/class-map.js';
import { ref, createRef } from 'lit-html/directives/ref.js';
import { store } from '../state.js';
import { Icon } from '../icons.js';

// Local-only toggle state for the demo.
const uiState = {
  notifyEmail: true,
  notifySlack: false,
  notifyWebhook: true,
  failClosed: true,
  publishToChain: true,
};

const toggleRow = (label, description, key) => html`
  <div class="settings-row">
    <div class="settings-row-text">
      <span class="settings-row-label">${label}</span>
      <span class="settings-row-sub">${description}</span>
    </div>
    <button
      class=${classMap({ 'toggle': true, 'is-on': uiState[key] })}
      type="button"
      role="switch"
      aria-checked=${uiState[key] ? 'true' : 'false'}
      @click=${() => {
        uiState[key] = !uiState[key];
        store.toast(uiState[key] ? 'ok' : 'info', `${label} ${uiState[key] ? 'enabled' : 'disabled'}.`);
        store.goto('settings');
      }}
    >
      <span class="toggle-thumb"></span>
    </button>
  </div>
`;

const apiKey = (name, token, created, last) => html`
  <div class="settings-key">
    <div class="settings-key-meta">
      <span class="settings-key-name">${name}</span>
      <span class="settings-key-sub">Created ${created} · Last used ${last}</span>
    </div>
    <code class="settings-key-token">${token}</code>
    <div class="settings-key-actions">
      <button
        class="btn btn-ghost btn-sm"
        type="button"
        @click=${() => {
          navigator.clipboard?.writeText(token).catch(() => {});
          store.toast('ok', `Token ${name} copied.`);
        }}
      >
        Copy
      </button>
      <button
        class="btn btn-ghost btn-sm is-danger"
        type="button"
        @click=${() => store.toast('info', `Token ${name} revoked (mocked).`)}
      >
        Revoke
      </button>
    </div>
  </div>
`;

const profileCard = (anchorRef) => {
  const session = store.getState().session;
  return html`
    <div class="dash-card" id="settings-profile" ${ref(anchorRef)}>
      <div class="dash-card-header">
        <div>
          <div class="dash-card-title">Profile</div>
          <div class="dash-card-sub">signed in as ${session.email}</div>
        </div>
      </div>
      <div class="settings-profile">
        <span class="dash-avatar dash-avatar-lg" aria-hidden="true">${session.initials}</span>
        <div class="settings-profile-body">
          <label class="login-field">
            <span class="login-field-label">Full name</span>
            <input class="login-input" type="text" .value=${session.name} />
          </label>
          <label class="login-field">
            <span class="login-field-label">Work email</span>
            <input class="login-input" type="email" .value=${session.email} />
          </label>
          <div class="settings-profile-actions">
            <button
              class="btn btn-primary btn-sm"
              type="button"
              @click=${() => store.toast('ok', 'Profile saved.')}
            >
              Save changes
            </button>
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              @click=${() => store.toast('info', 'Password change link sent to your email.')}
            >
              Change password
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
};

const securityCard = (anchorRef) => html`
  <div class="dash-card" id="settings-security" ${ref(anchorRef)}>
    <div class="dash-card-header">
      <div>
        <div class="dash-card-title">Security</div>
        <div class="dash-card-sub">two-factor · pipeline defaults</div>
      </div>
      <span class="dash-pill is-ok">2FA enabled</span>
    </div>
    <div class="settings-list">
      <div class="settings-row">
        <div class="settings-row-text">
          <span class="settings-row-label">Authenticator app (TOTP)</span>
          <span class="settings-row-sub">Configured · added on 2026-04-18</span>
        </div>
        <button
          class="btn btn-ghost btn-sm"
          type="button"
          @click=${() => store.toast('info', 'Regenerating TOTP — scan the QR on the next screen (mocked).')}
        >
          Regenerate
        </button>
      </div>
      ${toggleRow(
        'Fail closed',
        'If the LLM judge errors, sanitize instead of passing the payload.',
        'failClosed',
      )}
      ${toggleRow(
        'Publish confirmed attacks to chain',
        'Confirmed attacks are hashed and written to Base Sepolia so peers block them.',
        'publishToChain',
      )}
    </div>
  </div>
`;

const notificationsCard = (anchorRef) => {
  const enabled = ['notifyEmail', 'notifySlack', 'notifyWebhook'].filter((k) => uiState[k]).length;
  return html`
  <div class="dash-card" id="settings-notifications" ${ref(anchorRef)}>
    <div class="dash-card-header">
      <div>
        <div class="dash-card-title">Notifications</div>
        <div class="dash-card-sub">where should the console page you?</div>
      </div>
      <span class="dash-chip is-ghost">${enabled} of 3 channels on</span>
    </div>
    <div class="settings-list">
      ${toggleRow('Email alerts', 'Critical attacks and weekly digest to your inbox.', 'notifyEmail')}
      ${toggleRow('Slack webhook', 'Stream verdicts into #alerts.', 'notifySlack')}
      ${toggleRow(
        'Custom webhook',
        'POST verdicts to your SIEM. Endpoint: https://siem.acme.co/ingest',
        'notifyWebhook',
      )}
    </div>
  </div>
  `;
};

const apiKeysCard = (anchorRef) => html`
  <div class="dash-card" id="settings-api-keys" ${ref(anchorRef)}>
    <div class="dash-card-header">
      <div>
        <div class="dash-card-title">API keys</div>
        <div class="dash-card-sub">used by agents to report verdicts upstream</div>
      </div>
      <button
        class="btn btn-primary btn-sm"
        type="button"
        @click=${() => store.toast('ok', 'New API key generated. Copy it before you leave this page.')}
      >
        ${Icon.key}
        <span>New key</span>
      </button>
    </div>
    <div class="settings-keys">
      ${apiKey('key-prod-01', 'cg_live_sk_7f4a•••9c22', '2026-04-01', '32s ago')}
      ${apiKey('key-staging', 'cg_test_sk_9aa2•••b133', '2026-04-11', '4h ago')}
    </div>
  </div>
`;

const dangerZone = () => html`
  <div class="dash-card dash-card-danger">
    <div class="dash-card-header">
      <div>
        <div class="dash-card-title">Session</div>
        <div class="dash-card-sub">sign out of this console</div>
      </div>
    </div>
    <div class="settings-danger">
      <p>
        Signing out clears the local session immediately. All agents keep
        running; only this browser session ends.
      </p>
      <button
        class="btn btn-danger btn-sm"
        type="button"
        @click=${() => store.signOut()}
      >
        ${Icon.signOut}
        <span>Sign out</span>
      </button>
    </div>
  </div>
`;

const anchorTargets = {};

export const settingsView = () => {
  anchorTargets.profile = createRef();
  anchorTargets.security = createRef();
  anchorTargets.notifications = createRef();
  anchorTargets['api-keys'] = createRef();

  const section = store.getState().settingsSection;
  if (section && anchorTargets[section]) {
    queueMicrotask(() => {
      const el = anchorTargets[section]?.value;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('is-highlighted');
        setTimeout(() => el.classList.remove('is-highlighted'), 1400);
      }
      store.clearSettingsSection();
    });
  }

  return html`
    <section class="dash-section">
      <div class="dash-page-header">
        <p class="dash-page-header-sub">
          Profile, two-factor, notifications, API keys and session controls.
          Changes here only apply to your operator account — global rule
          changes are gated by a second reviewer.
        </p>
        <nav class="settings-jump" aria-label="Jump to section">
          <button type="button" class="settings-jump-link" @click=${() => store.goto('settings', { section: 'profile' })}>Profile</button>
          <button type="button" class="settings-jump-link" @click=${() => store.goto('settings', { section: 'security' })}>Security</button>
          <button type="button" class="settings-jump-link" @click=${() => store.goto('settings', { section: 'notifications' })}>Notifications</button>
          <button type="button" class="settings-jump-link" @click=${() => store.goto('settings', { section: 'api-keys' })}>API keys</button>
        </nav>
      </div>
      <div class="settings-grid">
        <div class="settings-col">
          ${profileCard(anchorTargets.profile)}
          ${securityCard(anchorTargets.security)}
        </div>
        <div class="settings-col">
          ${notificationsCard(anchorTargets.notifications)}
          ${apiKeysCard(anchorTargets['api-keys'])}
          ${dangerZone()}
        </div>
      </div>
    </section>
  `;
};
