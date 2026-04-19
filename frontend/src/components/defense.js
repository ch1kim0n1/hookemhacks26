import { html } from 'lit-html';

// Pipeline — three-up framing (Issue · Why · How) + an interactive
// detection rail. The payload chip glides across four inspection stations
// as the reader scrolls; each station shows its method signature and
// lights up when the chip arrives. Final stamp: BLOCKED.

const STATIONS = [
  {
    n: '00',
    time: '~5ms',
    title: 'Chain lookup',
    call: 'registry.seen(hash)',
    body: 'Hash the payload, ask Base Sepolia. Known attacks die here.',
  },
  {
    n: '01',
    time: '~40µs',
    title: 'Rules',
    call: 'rules.match(text)',
    body: 'Thirty regex patterns on injection shapes. Deterministic, free.',
  },
  {
    n: '02',
    time: '~8ms',
    title: 'Classifier',
    call: 'deberta.predict()',
    body: 'Local transformer. Catches novel shapes that rules miss.',
  },
  {
    n: '03',
    time: '~400ms',
    title: 'LLM judge',
    call: 'claude.haiku.judge()',
    body: 'Structured verdict on the ambiguous rest. Fails closed.',
  },
];

const station = (s, i) => html`
  <div
    class="rail-stage"
    data-rail-stage="${i}"
    style="
      position: relative;
      flex: 1 1 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 20px 16px 18px;
      background: var(--color-paper);
      border-right: ${i === STATIONS.length - 1 ? 'none' : '1.5px dashed var(--color-line)'};
      opacity: 0.55;
      transition: opacity 340ms cubic-bezier(0.16,1,0.3,1), background 340ms ease;
    "
  >
    <!-- Row 1: stage chip alone. The time label and check badge share
         the right column (below the chip) so they never collide. -->
    <div class="flex items-center" style="gap: 8px; padding-right: 32px;">
      <div
        class="rail-chip"
        style="
          font-family: var(--font-mono);
          font-size: 11px;
          letter-spacing: 0.14em;
          color: var(--color-muted);
          padding: 4px 10px;
          border: 1.5px solid var(--color-line);
          border-radius: 9999px;
          background: var(--color-paper-3);
          transition: all 340ms cubic-bezier(0.16,1,0.3,1);
        "
      >
        ${s.n}
      </div>
      <span
        style="font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-muted);"
      >
        ${s.time}
      </span>
    </div>
    <div class="display" style="font-size: 18px; line-height: 1.15;">
      ${s.title}
    </div>
    <code
      class="rail-call"
      style="
        font-family: var(--font-mono);
        font-size: 11.5px;
        padding: 6px 10px;
        background: var(--color-bone);
        border: 1px solid var(--color-line);
        border-radius: 5px;
        color: var(--color-ink-2);
        align-self: flex-start;
        transition: all 340ms cubic-bezier(0.16,1,0.3,1);
      "
    >
      ${s.call}
    </code>
    <div
      style="font-family: var(--font-sans); font-size: 12.5px; line-height: 1.45; color: var(--color-ink-2);"
    >
      ${s.body}
    </div>
    <!-- Check mark badge — anchored to the safe 32px right gutter reserved
         on row 1. Never overlaps the time label. -->
    <div
      class="rail-check"
      style="
        position: absolute;
        top: 16px;
        right: 14px;
        width: 20px;
        height: 20px;
        border-radius: 9999px;
        background: var(--color-accent);
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transform: scale(0.4);
        transition: opacity 280ms ease, transform 280ms cubic-bezier(0.16,1,0.3,1);
        box-shadow: 0 0 0 3px rgba(217,90,43,0.2);
        z-index: 2;
      "
    >
      ✓
    </div>
  </div>
`;

const column = (eyebrow, title, body, extra) => html`
  <div class="flex flex-col gap-2.5 reveal-prep from-bottom" style="--stagger: ${extra.stagger};">
    <div
      style="font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: ${extra.accent || 'var(--color-muted)'};"
    >
      ${eyebrow}
    </div>
    <h3 class="display" style="font-size: clamp(20px, 2.1vw, 28px); line-height: 1.15; text-wrap: balance;">
      ${title}
    </h3>
    <p class="lede" style="margin: 0; font-size: 14.5px;">${body}</p>
  </div>
`;

export const defense = () => html`
  <section id="pipeline" class="section-vh-tall rule-dashed bg-soft">
    <div class="container-wide w-full">
      <!-- Pin wrapper — the 3-column intro and the inspection rail stay
           together while the payload scrubs across the rail, so the reader
           never loses the Issue / Why / How framing mid-animation. -->
      <div data-pipeline-pin>
        <div
          class="grid gap-8 py-16"
          style="grid-template-columns: repeat(3, minmax(0, 1fr));"
        >
          ${column(
            'THE ISSUE',
            'Agents read what humans cannot.',
            'Prompt injection hides in comments, zero-width chars, white-on-white OCR, PDF metadata, audio narration. The model sees it; you never do.',
            { stagger: 0, accent: 'var(--color-accent)' },
          )}
          ${column(
            'WHY IT MATTERS',
            'One string, one wallet transfer.',
            'OpenClaw agents can call tools without confirmation. A single injected directive can drain a treasury, leak keys, or rewrite the system prompt.',
            { stagger: 1 },
          )}
          ${column(
            'HOW WE STOP IT',
            'Ask the chain first. Then scan.',
            'Hash → chain lookup → rules → classifier → judge. Each layer only runs if the one above missed. Nothing slow runs unless it has to.',
            { stagger: 2 },
          )}
        </div>

        <!-- Inspection rail. Payload chip glides left-to-right on scroll. -->
      <div
        class="reveal-prep scale-in"
        data-pipeline-rail
        style="
          position: relative;
          background: var(--color-paper-3);
          border: 1.5px solid var(--color-line);
          border-radius: 14px;
          box-shadow: 8px 8px 0 rgba(20,18,16,0.08);
          overflow: hidden;
        "
      >
        <!-- Rail header: payload + verdict stamp. -->
        <div
          class="flex items-center justify-between gap-4"
          style="
            padding: 14px 20px;
            border-bottom: 1.5px dashed var(--color-line);
            background: var(--color-paper-2);
            position: relative;
            height: 64px;
          "
        >
          <span
            style="font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-muted);"
          >
            inspection rail · scroll to advance
          </span>

          <!-- The payload chip. Absolute-positioned so GSAP can translate it
               freely along the rail without perturbing layout. -->
          <div
            data-rail-payload
            style="
              position: absolute;
              top: 50%;
              left: 0;
              transform: translate(20px, -50%);
              font-family: var(--font-mono);
              font-size: 11px;
              letter-spacing: 0.04em;
              color: var(--color-paper);
              background: var(--color-ink);
              padding: 7px 12px;
              border-radius: 8px;
              box-shadow: 4px 4px 0 var(--color-accent), 0 0 16px rgba(217,90,43,0);
              will-change: transform, box-shadow;
              z-index: 5;
              display: inline-flex;
              align-items: center;
              gap: 8px;
              pointer-events: none;
            "
          >
            <span
              style="width: 6px; height: 6px; border-radius: 9999px; background: var(--color-accent); box-shadow: 0 0 8px var(--color-accent);"
            ></span>
            payload · 0x7f4a9c…
          </div>

          <div
            data-rail-verdict
            style="
              font-family: var(--font-mono);
              font-size: 11px;
              letter-spacing: 0.14em;
              text-transform: uppercase;
              color: var(--color-muted);
              background: var(--color-paper);
              border: 1.5px solid var(--color-line);
              padding: 5px 12px;
              border-radius: 9999px;
              transition: all 300ms ease;
              position: relative;
              z-index: 4;
            "
          >
            pending
          </div>
        </div>

        <!-- Stations row -->
        <div class="flex items-stretch" style="position: relative;">
          ${STATIONS.map(station)}
        </div>

        <!-- Progress rail under the stations. -->
        <div
          aria-hidden="true"
          style="
            height: 3px;
            background: var(--color-paper-2);
            border-top: 1.5px dashed var(--color-line);
            position: relative;
            overflow: hidden;
          "
        >
          <div
            data-rail-progress
            style="
              position: absolute;
              inset: 0 auto 0 0;
              width: 0%;
              background: linear-gradient(90deg, var(--color-accent), var(--color-crab-2));
              box-shadow: 0 0 12px rgba(217,90,43,0.6);
              will-change: width;
            "
          ></div>
        </div>
      </div>
      </div>
    </div>
  </section>
`;
