import { html } from 'lit-html';
import { PIPELINE_STEPS } from '../lib/data.js';

const stepCard = (step, i) => html`
  <div
    class="paper-box p-5 relative flex flex-col reveal-prep from-bottom"
    style="
      --stagger: ${i};
      border-radius: 8px;
      min-height: 220px;
      ${i === 0 ? 'background: var(--color-paper-2); border-color: var(--color-accent);' : ''}
    "
  >
    <div
      style="font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--color-accent); letter-spacing: 0.14em;"
    >
      ${step.n}
    </div>
    <h4 class="display display-md mt-2.5 mb-1">${step.title}</h4>
    <span
      style="font-family: var(--font-mono); font-size: 11px; color: var(--color-muted); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 10px;"
    >
      ${step.time}
    </span>
    <p
      style="font-family: var(--font-sans); font-size: 14px; line-height: 1.5; color: var(--color-ink-2); margin: 0;"
    >
      ${step.body}
    </p>
  </div>
`;

// Pipeline — three layers run locally on each peer's machine (local-first
// matches Vitalik's principle). Output is the signed fingerprint that gets
// gossiped to neighbors.
export const defense = () => html`
  <section id="pipeline" class="section-vh rule-dashed bg-soft">
    <div class="container-wide w-full">
      <div class="max-w-[720px] mx-auto text-center mb-8 reveal-prep from-bottom">
        <h2 class="display display-lg mb-3" style="text-wrap: balance;">
          Ask the chain first. Then scan.
        </h2>
        <p class="lede" style="margin: 0 auto; max-width: 48ch;">
          Four steps. Each one only runs if the one above missed.
        </p>
      </div>

      <div
        class="relative grid gap-4 items-stretch"
        style="grid-template-columns: repeat(4, minmax(0, 1fr));"
      >
        <div
          aria-hidden="true"
          class="hidden md:block absolute left-[8%] right-[8%] top-[42px] h-[1.5px] opacity-25 z-0"
          style="
            background: repeating-linear-gradient(
              90deg,
              var(--color-ink) 0 6px,
              transparent 6px 12px
            );
          "
        ></div>

        ${PIPELINE_STEPS.map(stepCard)}
      </div>
    </div>
  </section>
`;
