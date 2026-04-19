import { html } from 'lit-html';

// Final section — walk the judge through the build in three beats.
// HOOK → SCAN → SHARE. Nothing else below; the CTA in the nav/hero sends
// judges into the live dashboard for the rest of the story.

const BEATS = [
  {
    n: '01',
    tag: 'HOOK',
    title: 'We sit in front of the agent.',
    body: 'An OpenClaw pre-tool hook routes every inbound payload — email, PDF, image, audio, web — through ClawGuard before a single tool can fire.',
    code: 'skill.intercept(payload)',
  },
  {
    n: '02',
    tag: 'SCAN',
    title: 'We hash, then scan.',
    body: 'Base Sepolia knows the known attacks. Anything new meets three local layers: regex, a small transformer, and a Claude Haiku judge that fails closed.',
    code: 'rules → deberta → haiku',
  },
  {
    n: '03',
    tag: 'SHARE',
    title: 'One of us blocks it, all of us do.',
    body: 'When something new gets blocked, its hash is published to the on-chain registry. The next agent, on any node, blocks it in microseconds — for free.',
    code: 'registry.publish(hash)',
  },
];

const beat = (b, i) => html`
  <div
    class="reveal-prep from-bottom"
    data-beat="${i}"
    style="
      --stagger: ${i};
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 22px 22px 20px;
      background: var(--color-paper);
      border: 1.5px solid var(--color-line);
      border-radius: 12px;
      box-shadow: 6px 6px 0 rgba(20,18,16,0.08);
    "
  >
    <div class="flex items-baseline justify-between">
      <span
        style="font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.18em; color: var(--color-accent);"
      >
        ${b.tag}
      </span>
      <span
        style="font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.16em; color: var(--color-muted);"
      >
        ${b.n} / 03
      </span>
    </div>
    <h3
      class="display"
      style="font-size: clamp(18px, 1.8vw, 22px); line-height: 1.18; margin: 0; text-wrap: balance;"
    >
      ${b.title}
    </h3>
    <p
      style="margin: 0; font-family: var(--font-sans); font-size: 13px; line-height: 1.5; color: var(--color-ink-2);"
    >
      ${b.body}
    </p>
    <code
      style="
        align-self: flex-start;
        margin-top: 4px;
        font-family: var(--font-mono);
        font-size: 11px;
        padding: 5px 10px;
        background: var(--color-bone);
        border: 1px solid var(--color-line);
        border-radius: 5px;
        color: var(--color-ink-2);
      "
    >
      ${b.code}
    </code>
  </div>
`;

const connector = () => html`
  <div
    aria-hidden="true"
    style="
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--color-accent);
      font-family: var(--font-mono);
      font-size: 18px;
      font-weight: 600;
      letter-spacing: 0.08em;
    "
  >
    →
  </div>
`;

export const demo = () => html`
  <section id="demo" class="section-vh rule-dashed bg-paper3">
    <div class="container-wide w-full">
      <!-- Header -->
      <div class="max-w-[760px] mb-10 reveal-prep from-bottom">
        <div
          style="font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--color-muted); margin-bottom: 10px;"
        >
          THE HACKATHON BUILD · THREE BEATS
        </div>
        <h2 class="display display-lg mb-2" style="text-wrap: balance;">
          A shared memory for agents under attack.
        </h2>
        <p class="lede" style="margin: 0; max-width: 62ch;">
          One agent meets a new payload. Every agent learns it. That's the
          whole build, in three moves.
        </p>
      </div>

      <!-- 3-beat narrative -->
      <div
        style="
          display: grid;
          grid-template-columns: 1fr 32px 1fr 32px 1fr;
          gap: 0;
          align-items: stretch;
        "
      >
        ${beat(BEATS[0], 0)}
        ${connector()}
        ${beat(BEATS[1], 1)}
        ${connector()}
        ${beat(BEATS[2], 2)}
      </div>

      <!-- CTA below beats -->
      <div
        class="flex justify-center mt-10 reveal-prep from-bottom"
        style="--stagger: 3;"
      >
        <a class="pill pill-accent" href="/dashboard.html">Open the dashboard →</a>
      </div>
    </div>
  </section>
`;
