import { html } from 'lit-html';

// Sticky nav — brand lockup, anchor links with animated highlighter on
// hover, single CTA. No badges.
export const nav = () => html`
  <header
    class="sticky top-0 z-50 flex items-center gap-5 px-8 backdrop-blur-md rule-dashed"
    style="background: rgba(235,224,204,0.92); height: var(--nav-h);"
  >
    <a href="#top" class="flex items-center gap-2.5 no-underline text-ink">
      <img
        src="/logo.png"
        alt=""
        width="56"
        height="56"
        class="w-[56px] h-[56px] rounded-full object-cover"
      />
      <span style="font-family: var(--font-hand); font-size: 22px; font-weight: 600; letter-spacing: -0.01em;">
        ClawGuardian
      </span>
    </a>

    <nav class="ml-auto hidden md:flex gap-7 items-center">
      <a href="#problem" class="nav-link">Problem</a>
      <a href="#whynow" class="nav-link">Why now</a>
      <a href="#network" class="nav-link">How it works</a>
      <a href="#pipeline" class="nav-link">Pipeline</a>
    </nav>

    <a href="/dashboard.html" class="pill pill-accent text-[14px] py-[8px] px-4">
      Try the demo →
    </a>
  </header>
`;
