import { html } from 'lit-html';
import { FEED_ROWS, VITALIK } from '../lib/data.js';

const statusBg = (s) => (s === 'block' ? '#fecaca' : '#fde68a');

const feedRow = (row) => html`
  <div
    class="feed-row grid gap-3 py-[9px] px-1 items-center"
    style="grid-template-columns: auto 1fr auto; border-bottom: 1px dashed rgba(20,18,16,0.15); font-family: var(--font-mono); font-size: 11px;"
  >
    <span class="text-accent font-semibold">${row.hash}</span>
    <span style="font-family: var(--font-sans); font-size: 13px; color: var(--color-ink);">
      ${row.desc}
    </span>
    <span
      class="text-[9.5px] px-1.5 py-0.5 uppercase tracking-[0.08em]"
      style="border: 1px solid var(--color-line); background: ${statusBg(row.status)};"
    >
      ${row.status}
    </span>
  </div>
`;

// Hero — one viewport, two columns. The left column tells the reader what
// this is. The right column shows it running. No badges, no meta row.
export const hero = () => html`
  <section id="top" class="section-vh rule-dashed">
    <div class="container-wide w-full">
      <div
        class="grid gap-10 lg:gap-14 items-center"
        style="grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.95fr);"
      >
        <div class="reveal-prep from-left">
          <h1 class="display display-xl mb-5" style="max-width: 15ch; text-wrap: balance;">
            A decentralized immune system for
            <span class="hw-marker">OpenClaw</span> agents.
          </h1>
          <p class="lede mb-7" style="max-width: 54ch;">
            Every external input is an attack surface — a website, a PDF, a
            screenshot can hijack an agent that trusts what it reads. ClawGuardian
            runs on each user's own machine, catches injections locally, and
            gossips signed fingerprints to peers so one catch protects everyone.
          </p>

          <div class="flex gap-3 flex-wrap">
            <a class="pill pill-accent" href="#demo">Try the demo →</a>
            <a class="pill pill-ghost" href="#problem">See the attack surface</a>
          </div>
        </div>

        <div
          class="paper-box reveal-prep from-right p-4"
          style="
            border-radius: 10px;
            box-shadow: 6px 6px 0 rgba(20,18,16,0.06), 0 24px 48px -28px rgba(20,18,16,0.22);
          "
          data-hero-feed
        >
          <div class="flex items-center gap-2 pb-2 mb-2 rule-dashed">
            <span class="live-dot"></span>
            <span
              style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--color-ink);"
            >
              attack registry · live
            </span>
          </div>

          <div
            class="overflow-hidden"
            style="max-height: 300px; mask-image: linear-gradient(#000 0 85%, transparent 100%);"
          >
            ${FEED_ROWS.map(feedRow)}
          </div>
        </div>
      </div>
    </div>
  </section>
`;
