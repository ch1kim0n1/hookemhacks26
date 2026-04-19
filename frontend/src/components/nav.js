import { html } from 'lit-html';

// Sticky nav — brand lockup, anchor links with animated highlighter on
// hover, single CTA. No badges.
export const nav = () => html`
  <header
    class="sticky top-0 z-50 flex items-center gap-5 px-8 backdrop-blur-md rule-dashed"
    style="background: rgba(235,224,204,0.92); height: var(--nav-h);"
  >
    <a href="#top" class="flex items-center gap-2.5 no-underline text-ink">
      <svg viewBox="0 0 32 32" class="w-[26px] h-[26px]" aria-hidden="true">
        <path
          d="M16 3 L5 8 V16 C5 22 10 27 16 29 C22 27 27 22 27 16 V8 Z"
          stroke="var(--color-ink)"
          stroke-width="2"
          fill="var(--color-paper-2)"
          stroke-linejoin="round"
        />
        <path
          d="M10 12 C11 15 13 17 16 17 C19 17 21 15 22 12"
          stroke="var(--color-crab)"
          stroke-width="2"
          fill="none"
          stroke-linecap="round"
        />
        <circle cx="12" cy="20" r="1.6" fill="var(--color-crab)" />
        <circle cx="20" cy="20" r="1.6" fill="var(--color-crab)" />
      </svg>
      <span style="font-family: var(--font-hand); font-size: 18px; font-weight: 600; letter-spacing: -0.01em;">
        ClawGuardian
      </span>
    </a>

    <nav class="ml-auto hidden md:flex gap-7 items-center">
      <a href="#problem" class="nav-link">Problem</a>
      <a href="#whynow" class="nav-link">Why now</a>
      <a href="#network" class="nav-link">How it works</a>
      <a href="#pipeline" class="nav-link">Pipeline</a>
    </nav>

    <a href="#demo" class="pill pill-accent text-[14px] py-[8px] px-4">
      Try the demo →
    </a>
  </header>
`;
