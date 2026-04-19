import { html } from 'lit-html';
import { classMap } from 'lit-html/directives/class-map.js';
import { ref } from 'lit-html/directives/ref.js';
import { AWS_SERVICES } from '../mock-data.js';
import { store } from '../state.js';
import { Icon } from '../icons.js';

// Local view state — which service is "active" in the sticky tab strip,
// and which Q&A items are open per service.
const viewState = {
  activeId: AWS_SERVICES[0]?.id ?? null,
  openQa: new Set(), // keys of the form `${serviceId}:${qaIndex}`
};

const rerender = () => store.goto('aws');

// Scrollspy — observe each service section, promote the most visible one to
// the active tab. Idempotent; we re-attach after every render.
let observer = null;
const sectionRefs = new Map();
const attachObserver = () => {
  if (!('IntersectionObserver' in window)) return;
  if (observer) observer.disconnect();
  observer = new IntersectionObserver(
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
    { rootMargin: '-40% 0px -50% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
  );
  sectionRefs.forEach((node) => node && observer.observe(node));
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

const serviceCard = (svc) => {
  return html`
    <section
      class=${classMap({ 'aws-service': true, [`is-${svc.accent}`]: true })}
      id=${`aws-${svc.id}`}
      data-aws-id=${svc.id}
      ${ref((node) => {
        if (node) {
          sectionRefs.set(svc.id, node);
          if (observer) observer.observe(node);
        } else {
          sectionRefs.delete(svc.id);
        }
      })}
    >
      <header class="aws-service-head">
        <span class=${classMap({ 'aws-service-logo': true, [`is-${svc.accent}`]: true })} aria-hidden="true">
          ${svc.short.slice(0, 3).toUpperCase()}
        </span>
        <div class="aws-service-titles">
          <div class="aws-service-eyebrow">${svc.tag}</div>
          <h2 class="aws-service-name">${svc.name}</h2>
          <p class="aws-service-blurb">${svc.blurb}</p>
        </div>
      </header>

      <div class="aws-service-body">
        <div class="aws-service-role">
          <div class="aws-service-label">What it does for ClawGuard</div>
          <p>${svc.role}</p>
        </div>

        <div class="aws-where">
          <div class="aws-service-label">Where it lives in the repo</div>
          <ul class="aws-where-list">
            ${svc.where.map(
              (w) => html`
                <li class="aws-where-item">
                  <code class="aws-where-path">${w.path}</code>
                  <span class="aws-where-note">${w.note}</span>
                </li>
              `,
            )}
          </ul>
        </div>

        <div class="aws-qa">
          <div class="aws-service-label">Quick Q&amp;A</div>
          ${svc.qa.map((item, idx) => {
            const k = `${svc.id}:${idx}`;
            const open = viewState.openQa.has(k);
            return html`
              <button
                class=${classMap({ 'aws-qa-item': true, 'is-open': open })}
                type="button"
                aria-expanded=${open ? 'true' : 'false'}
                @click=${() => toggleQa(svc.id, idx)}
              >
                <span class="aws-qa-q">
                  <span class="aws-qa-mark" aria-hidden="true">Q</span>
                  <span>${item.q}</span>
                  <span class="aws-qa-chev" aria-hidden="true">${open ? '▾' : '▸'}</span>
                </span>
                ${open
                  ? html`
                      <span class="aws-qa-a">
                        <span class="aws-qa-mark is-a" aria-hidden="true">A</span>
                        <span>${item.a}</span>
                      </span>
                    `
                  : ''}
              </button>
            `;
          })}
        </div>
      </div>
    </section>
  `;
};

const intro = () => html`
  <section class="aws-intro">
    <div class="aws-intro-body">
      <h2>AWS on this stack — in 60 seconds</h2>
      <p>
        ClawGuard's control plane runs on ${AWS_SERVICES.length} AWS services.
        Auth is <strong>Cognito</strong> with mandatory TOTP MFA. The dashboard
        SPA ships as static files to <strong>S3</strong> (public access
        blocked, SSE-S3, versioned) and is served through
        <strong>CloudFront</strong> via an Origin Access Control — the bucket
        never sees the public internet. The ops plane keeps
        <strong>Terraform state</strong> in a separate encrypted S3 bucket
        with a <strong>DynamoDB</strong> table for concurrent-apply locking.
        <strong>IAM</strong> policies are explicit — no wildcards, named
        principals only. <strong>Bedrock</strong> is wired as a preflight
        check so the Claude-Haiku judge has a migration path when tenants
        want model traffic inside their own AWS account.
      </p>
      <p class="aws-intro-note">
        The threat cache is <em>not</em> on AWS — it lives on-chain in the
        <code>ThreatRegistry</code> contract on Base Sepolia (chain id
        84532) so any judge can verify intel independently. The audit log is
        Postgres (prod) / SQLite (local), behind SQLAlchemy + Alembic.
      </p>
    </div>
    <div class="aws-intro-stats">
      <div class="aws-intro-stat">
        <span class="aws-intro-stat-num">${AWS_SERVICES.length}</span>
        <span class="aws-intro-stat-label">services</span>
      </div>
      <div class="aws-intro-stat">
        <span class="aws-intro-stat-num">0</span>
        <span class="aws-intro-stat-label">wildcard IAM grants</span>
      </div>
      <div class="aws-intro-stat">
        <span class="aws-intro-stat-num">1</span>
        <span class="aws-intro-stat-label">region (us-east-1)</span>
      </div>
    </div>
  </section>
`;

const stickyTabs = () => html`
  <nav class="aws-sticky-tabs" role="tablist" aria-label="AWS services">
    ${AWS_SERVICES.map(
      (svc) => html`
        <button
          class=${classMap({ 'aws-tab': true, 'is-active': svc.id === viewState.activeId })}
          type="button"
          role="tab"
          aria-selected=${svc.id === viewState.activeId ? 'true' : 'false'}
          @click=${() => jumpTo(svc.id)}
        >
          <span class=${classMap({ 'aws-tab-dot': true, [`is-${svc.accent}`]: true })} aria-hidden="true"></span>
          <span class="aws-tab-label">${svc.short}</span>
        </button>
      `,
    )}
  </nav>
`;

export const awsView = () => {
  // Re-attach the observer after the render commits.
  requestAnimationFrame(() => attachObserver());

  return html`
    <section class="dash-section aws-view">
      <div class="dash-page-header">
        <p class="dash-page-header-sub">
          One card per AWS service, each with where it lives in the repo and a
          couple of Q&amp;A items a reviewer tends to ask. Click a tab to jump;
          the tab strip auto-promotes the card you're reading.
        </p>
        <div class="aws-badge" aria-hidden="true">
          ${Icon.cloud}
          <span>${AWS_SERVICES.length} services · grounded in infrastructure/</span>
        </div>
      </div>

      ${intro()}
      ${stickyTabs()}

      <div class="aws-services">
        ${AWS_SERVICES.map(serviceCard)}
      </div>
    </section>
  `;
};
