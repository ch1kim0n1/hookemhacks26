import { html } from 'lit-html';
import { KPIS, MODALITY_BARS, TABLE_ROWS } from '../lib/data.js';

const kpiCard = (k) => html`
  <div
    class="px-3 py-2 flex flex-col gap-0.5 rounded-md"
    style="border: 1.5px solid var(--color-line); background: var(--color-paper-3);"
  >
    <span
      style="font-family: var(--font-mono); font-size: 10px; color: var(--color-muted); letter-spacing: 0.1em; text-transform: uppercase;"
    >
      ${k.label}
    </span>
    <span class="display display-md" style="line-height: 1;">${k.num}</span>
    <span
      style="font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.04em; color: ${k.deltaClass === 'up'
        ? 'var(--color-success)'
        : k.deltaClass === 'down'
          ? 'var(--color-accent)'
          : 'var(--color-muted)'};"
    >
      ${k.delta}
    </span>
  </div>
`;

const modalityBar = (m) => html`
  <div
    class="grid gap-2.5 items-center py-1"
    style="grid-template-columns: 48px 1fr 44px; font-family: var(--font-mono); font-size: 11px;"
  >
    <span style="color: var(--color-muted); letter-spacing: 0.08em; text-transform: uppercase;">
      ${m.label}
    </span>
    <span
      class="h-[10px] rounded-[2px] relative overflow-hidden"
      style="background: var(--color-paper-2); border: 1px solid var(--color-line);"
      data-bar-pct="${m.pct}"
    >
      <em class="block h-full not-italic" style="width: 0%; background: ${m.color};"></em>
    </span>
    <span class="text-right" style="color: var(--color-ink); font-weight: 600;">${m.val}</span>
  </div>
`;

const verdictRow = (r) => html`
  <div
    class="grid gap-2.5 py-1 px-1 items-center"
    style="grid-template-columns: 72px 92px 54px 1fr 60px; font-family: var(--font-mono); font-size: 11px; border-bottom: 1px dashed rgba(20,18,16,0.13);"
  >
    <span style="color: var(--color-muted);">${r.t}</span>
    <span style="color: var(--color-ink);">${r.agent}</span>
    <span style="color: var(--color-muted);">${r.mod}</span>
    <span style="color: var(--color-accent); font-weight: 600;">${r.hash}</span>
    <span
      class="text-[9.5px] px-1.5 py-0.5 text-center uppercase tracking-[0.08em]"
      style="border: 1px solid var(--color-line); background: ${r.verdict === 'block'
        ? '#fecaca'
        : '#fde68a'};"
    >
      ${r.verdict}
    </span>
  </div>
`;

const onStartClick = (e) => {
  const btn = e.currentTarget;
  const hint = btn.parentElement?.querySelector('[data-demo-hint]');
  if (hint) hint.hidden = false;
  btn.setAttribute('disabled', 'true');
  btn.style.opacity = '0.7';
  btn.style.cursor = 'default';
};

export const demo = () => html`
  <section id="demo" class="section-vh rule-dashed bg-paper3">
    <div class="container-wide w-full">
      <div class="max-w-[760px] mx-auto text-center mb-5 reveal-prep from-bottom">
        <h2 class="display display-lg mb-2.5" style="text-wrap: balance;">
          Operator view once the mesh is on.
        </h2>
        <p class="lede" style="margin: 0 auto; max-width: 54ch;">
          Every verdict local. Every cache hit free.
        </p>
      </div>

      <div
        class="reveal-prep from-bottom mx-auto max-w-[1040px] overflow-hidden"
        style="
          border: 1.5px solid var(--color-line);
          border-radius: 10px;
          background: var(--color-paper-3);
          box-shadow: 6px 6px 0 rgba(20,18,16,0.08);
        "
      >
        <div
          class="flex items-center gap-2 py-2 px-3.5 rule-dashed"
          style="background: var(--color-paper-2);"
        >
          <span
            class="w-2.5 h-2.5 rounded-full"
            style="border: 1.5px solid var(--color-line); background: #fff;"
          ></span>
          <span
            class="w-2.5 h-2.5 rounded-full"
            style="border: 1.5px solid var(--color-line); background: #fff;"
          ></span>
          <span
            class="w-2.5 h-2.5 rounded-full"
            style="border: 1.5px solid var(--color-line); background: #fff;"
          ></span>
          <span
            class="flex-1 mx-3.5 px-3 py-1 rounded-md"
            style="font-family: var(--font-mono); font-size: 11px; color: var(--color-muted); background: var(--color-paper-3); border: 1px dashed var(--color-line);"
          >
            app.clawguardian.xyz/fleet
          </span>
        </div>

        <div class="grid" style="grid-template-columns: 180px 1fr;">
          <aside
            class="p-3.5 flex flex-col"
            style="border-right: 1.5px dashed var(--color-line); background: var(--color-paper-2);"
          >
            <div
              style="font-family: var(--font-hand); font-size: 15px; font-weight: 600; padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1.5px dashed var(--color-line);"
            >
              ClawGuardian
            </div>
            <nav class="flex flex-col gap-0.5">
              ${[
                { l: 'Overview', active: true },
                { l: 'Peers' },
                { l: 'Registry' },
                { l: 'Attacks' },
                { l: 'Audit log' },
                { l: 'Settings' },
              ].map(
                (a) => html`
                  <a
                    class="px-2 py-1.5 rounded-md no-underline"
                    style="font-family: var(--font-sans); font-size: 13px; ${a.active
                      ? 'background: var(--color-ink); color: var(--color-paper);'
                      : 'color: var(--color-ink-2);'}"
                  >
                    ${a.l}
                  </a>
                `,
              )}
            </nav>
          </aside>

          <main class="p-3 flex flex-col gap-2">
            <div class="grid gap-2" style="grid-template-columns: repeat(4, minmax(0,1fr));">
              ${KPIS.map(kpiCard)}
            </div>

            <div class="grid gap-2.5" style="grid-template-columns: 1.4fr 1fr;">
              <div
                class="p-3 rounded-md"
                style="border: 1.5px solid var(--color-line); background: var(--color-paper-3);"
              >
                <h5 class="display display-md m-0 mb-2">Attacks blocked · 24h</h5>
                <svg class="w-full h-[72px] block" viewBox="0 0 400 120" preserveAspectRatio="none">
                  <g stroke="#1a1a1a" stroke-width=".5" stroke-dasharray="2 3" opacity=".2">
                    <line x1="0" y1="30" x2="400" y2="30" />
                    <line x1="0" y1="60" x2="400" y2="60" />
                    <line x1="0" y1="90" x2="400" y2="90" />
                  </g>
                  <path
                    d="M0 95 L20 82 L40 86 L60 68 L80 72 L100 50 L120 58 L140 42 L160 54 L180 32 L200 46 L220 24 L240 38 L260 28 L280 42 L300 20 L320 32 L340 24 L360 16 L380 28 L400 20"
                    fill="none"
                    stroke="var(--color-crab)"
                    stroke-width="1.8"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M0 95 L20 82 L40 86 L60 68 L80 72 L100 50 L120 58 L140 42 L160 54 L180 32 L200 46 L220 24 L240 38 L260 28 L280 42 L300 20 L320 32 L340 24 L360 16 L380 28 L400 20 L400 120 L0 120 Z"
                    fill="var(--color-crab)"
                    opacity="0.12"
                  />
                </svg>
              </div>

              <div
                class="p-3 rounded-md"
                style="border: 1.5px solid var(--color-line); background: var(--color-paper-3);"
              >
                <h5 class="display display-md m-0 mb-2">By modality</h5>
                ${MODALITY_BARS.map(modalityBar)}
              </div>
            </div>

            <div
              class="p-3 rounded-md"
              style="border: 1.5px solid var(--color-line); background: var(--color-paper-3);"
            >
              <h5 class="display display-md m-0 mb-2">Recent verdicts</h5>
              <div
                class="grid gap-2.5 py-1 px-1"
                style="grid-template-columns: 72px 92px 54px 1fr 60px; font-family: var(--font-mono); font-size: 10px; color: var(--color-muted); letter-spacing: 0.1em; text-transform: uppercase; border-bottom: 1.5px dashed var(--color-line);"
              >
                <span>time</span>
                <span>peer</span>
                <span>mod</span>
                <span>fingerprint</span>
                <span>verdict</span>
              </div>
              ${TABLE_ROWS.map(verdictRow)}
            </div>
          </main>
        </div>
      </div>

      <div class="mt-5 text-center reveal-prep from-bottom">
        <button
          type="button"
          class="pill pill-accent text-[15px]"
          @click=${onStartClick}
        >
          Start the live demo →
        </button>
        <div
          data-demo-hint
          hidden
          class="mt-3"
          style="font-family: var(--font-mono); font-size: 12px; color: var(--color-success); letter-spacing: 0.06em;"
        >
          demo coming online at the presentation — we'll walk judges through it live
        </div>
      </div>
    </div>
  </section>
`;
