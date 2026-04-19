import { html } from 'lit-html';
import { classMap } from 'lit-html/directives/class-map.js';
import { ref } from 'lit-html/directives/ref.js';
import { AWS_SERVICES } from '../mock-data.js';
import { store } from '../state.js';
import { Icon, AwsIcon } from '../icons.js';

// Local view state — which service is "active" in the sticky tab strip,
// which card has its Q&A drawer open, and which sections have been revealed
// by the IntersectionObserver reveal pass.
const viewState = {
  activeId: AWS_SERVICES[0]?.id ?? null,
  openQa: new Set(), // `${serviceId}:${qaIndex}`
  revealed: new Set(), // service ids that have entered the viewport at least once
};

const rerender = () => store.goto('aws');

// Two observers. `spy` promotes the most visible card to the active tab.
// `reveal` fires once per card to add the .is-revealed class — drives the
// stagger-in entrance animation without re-triggering on scroll-back.
let spyObserver = null;
let revealObserver = null;
const sectionRefs = new Map();

const attachObservers = () => {
  if (!('IntersectionObserver' in window)) return;

  if (spyObserver) spyObserver.disconnect();
  spyObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (!visible.length) return;
      const topId = visible[0].target.dataset.awsId;
      if (topId && topId !== viewState.activeId) {
        viewState.activeId = topId;
        rerender();
      }
    },
    { rootMargin: '-35% 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
  );

  if (revealObserver) revealObserver.disconnect();
  revealObserver = new IntersectionObserver(
    (entries) => {
      let changed = false;
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.dataset.awsId;
          if (id && !viewState.revealed.has(id)) {
            viewState.revealed.add(id);
            changed = true;
          }
        }
      });
      if (changed) rerender();
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );

  sectionRefs.forEach((node) => {
    if (!node) return;
    spyObserver.observe(node);
    revealObserver.observe(node);
  });
};

const jumpTo = (id) => {
  viewState.activeId = id;
  const node = sectionRefs.get(id);
  if (node?.scrollIntoView) {
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  rerender();
};

const toggleQa = (serviceId, idx) => {
  const k = `${serviceId}:${idx}`;
  if (viewState.openQa.has(k)) viewState.openQa.delete(k);
  else viewState.openQa.add(k);
  rerender();
};

// Maps each AWS service card to the key in /api/aws/status.services
// so the "live" chip reflects actual runtime wiring.
const STATUS_KEY_BY_ID = {
  cognito: 'cognito',
  bedrock: 'bedrock',
  kms_signer: 'kms_signer',
  kms_envelope: 'kms_envelope',
  secrets_manager: 'secrets_manager',
  api_gateway: 'api_gateway',
  ecs_fargate: 'ecs_fargate',
};

const liveChip = (svc, awsStatus) => {
  const key = STATUS_KEY_BY_ID[svc.id];
  if (!key || !awsStatus?.services) {
    return html`<span class="aws-chip is-idle" title="Live status unavailable">—</span>`;
  }
  const entry = awsStatus.services[key];
  if (!entry) {
    return html`<span class="aws-chip is-idle">not wired</span>`;
  }
  if (entry.configured) {
    return html`<span class="aws-chip is-ok" title="Configured and reporting from /api/aws/status"><span class="aws-chip-dot"></span>live</span>`;
  }
  return html`<span class="aws-chip is-warn" title="Not configured in this environment"><span class="aws-chip-dot"></span>demo</span>`;
};

const serviceTile = (svc) => html`
  <span
    class="aws-service-tile"
    style=${`--aws-color:${svc.awsColor}`}
    aria-hidden="true"
  >
    ${AwsIcon[svc.icon] ?? AwsIcon.cognito}
  </span>
`;

const serviceCard = (svc, awsStatus, idx) => {
  const isRevealed = viewState.revealed.has(svc.id);
  return html`
    <section
      class=${classMap({
        'aws-card': true,
        'is-revealed': isRevealed,
        'is-active': svc.id === viewState.activeId,
      })}
      id=${`aws-${svc.id}`}
      data-aws-id=${svc.id}
      style=${`--aws-color:${svc.awsColor}; --aws-reveal-delay:${Math.min(idx, 6) * 40}ms`}
      ${ref((node) => {
        if (node) {
          sectionRefs.set(svc.id, node);
          if (spyObserver) spyObserver.observe(node);
          if (revealObserver) revealObserver.observe(node);
        } else {
          sectionRefs.delete(svc.id);
        }
      })}
    >
      <header class="aws-card-head">
        ${serviceTile(svc)}
        <div class="aws-card-titles">
          <div class="aws-card-meta">
            <span class="aws-card-category">${svc.category}</span>
            <span class="aws-card-sep" aria-hidden="true">·</span>
            <span class="aws-card-tag">${svc.tag}</span>
            ${liveChip(svc, awsStatus)}
          </div>
          <h2 class="aws-card-name">${svc.name}</h2>
        </div>
      </header>

      <div class="aws-card-story">
        <article class="aws-story-cell">
          <div class="aws-story-label">
            <span class="aws-story-num">01</span>
            <span>What it does</span>
          </div>
          <p>${svc.purpose}</p>
        </article>
        <article class="aws-story-cell is-why">
          <div class="aws-story-label">
            <span class="aws-story-num">02</span>
            <span>Why this service</span>
          </div>
          <p>${svc.why}</p>
        </article>
        <article class="aws-story-cell is-cost">
          <div class="aws-story-label">
            <span class="aws-story-num">03</span>
            <span>Cost edge</span>
          </div>
          <p>${svc.cost}</p>
        </article>
      </div>

      <footer class="aws-card-foot">
        <div class="aws-foot-where">
          <div class="aws-foot-label">In the repo</div>
          <ul>
            ${svc.where.map(
              (w) => html`
                <li>
                  <code>${w.path}</code>
                  <span>${w.note}</span>
                </li>
              `,
            )}
          </ul>
        </div>
        <div class="aws-foot-qa">
          <div class="aws-foot-label">Demo Q&amp;A</div>
          ${svc.qa.map((item, qIdx) => {
            const k = `${svc.id}:${qIdx}`;
            const open = viewState.openQa.has(k);
            return html`
              <button
                class=${classMap({ 'aws-qa-item': true, 'is-open': open })}
                type="button"
                aria-expanded=${open ? 'true' : 'false'}
                @click=${() => toggleQa(svc.id, qIdx)}
              >
                <span class="aws-qa-q">
                  <span class="aws-qa-q-text">${item.q}</span>
                  <span class="aws-qa-chev" aria-hidden="true">+</span>
                </span>
                ${open
                  ? html`<span class="aws-qa-a">${item.a}</span>`
                  : ''}
              </button>
            `;
          })}
        </div>
      </footer>
    </section>
  `;
};

const intro = (awsStatus) => {
  const account = awsStatus?.account || '—';
  const region = awsStatus?.region || '—';
  const services = awsStatus?.services || {};
  const configured = Object.values(services).filter((s) => s?.configured).length;
  return html`
    <section class="aws-intro">
      <div class="aws-intro-body">
        <span class="aws-intro-eyebrow">Pillar 2 · AWS control plane</span>
        <h2 class="aws-intro-title">13 services. One blast radius.</h2>
        <p>
          Every card answers three questions: <em>what does this service do</em>,
          <em>why pick it over the obvious alternative</em>, and
          <em>how do we keep the bill small</em>. If a judge asks something
          not in the story, the Q&amp;A drawer under each card has the
          drill-down.
        </p>
      </div>
      <div class="aws-intro-stats">
        <div class="aws-intro-stat">
          <span class="aws-intro-num">${AWS_SERVICES.length}</span>
          <span class="aws-intro-cap">services wired</span>
        </div>
        <div class="aws-intro-stat is-live">
          <span class="aws-intro-num">${configured}</span>
          <span class="aws-intro-cap">
            live · ${account} / ${region}
          </span>
        </div>
        <div class="aws-intro-stat is-iam">
          <span class="aws-intro-num">0</span>
          <span class="aws-intro-cap">wildcard IAM grants</span>
        </div>
      </div>
    </section>
  `;
};

const stickyTabs = () => html`
  <nav class="aws-tabs" role="tablist" aria-label="AWS services">
    ${AWS_SERVICES.map(
      (svc) => html`
        <button
          class=${classMap({ 'aws-tab': true, 'is-active': svc.id === viewState.activeId })}
          style=${`--aws-color:${svc.awsColor}`}
          type="button"
          role="tab"
          aria-selected=${svc.id === viewState.activeId ? 'true' : 'false'}
          @click=${() => jumpTo(svc.id)}
        >
          <span class="aws-tab-dot" aria-hidden="true"></span>
          <span class="aws-tab-label">${svc.short}</span>
        </button>
      `,
    )}
  </nav>
`;

export const awsView = () => {
  requestAnimationFrame(() => attachObservers());
  const { live } = store.getState();
  const awsStatus = live?.awsStatus;

  return html`
    <section class="dash-section aws-view">
      <div class="dash-page-header">
        <p class="dash-page-header-sub">
          Demo cheat sheet — one card per AWS service. Click a tab to jump;
          the strip auto-promotes the card you are reading. Live chips on
          each card come from <code>/api/aws/status</code>.
        </p>
        <div class="aws-badge" aria-hidden="true">
          ${Icon.cloud}
          <span>${AWS_SERVICES.length} services · grounded in infrastructure/</span>
        </div>
      </div>

      ${intro(awsStatus)}
      ${stickyTabs()}

      <div class="aws-cards">
        ${AWS_SERVICES.map((svc, idx) => serviceCard(svc, awsStatus, idx))}
      </div>
    </section>
  `;
};
