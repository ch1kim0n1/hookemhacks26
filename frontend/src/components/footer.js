import { html } from 'lit-html';

export const footer = () => html`
  <footer
    class="px-8 py-6 flex justify-between items-center gap-4 flex-wrap rule-dashed"
    style="font-family: var(--font-mono); font-size: 11px; color: var(--color-muted); letter-spacing: 0.1em; text-transform: uppercase;"
  >
    <span>© 2026 ClawGuardian · base sepolia</span>
    <nav class="flex gap-5">
      ${[
        { l: 'Problem', href: '#problem' },
        { l: 'Why now', href: '#whynow' },
        { l: 'Network', href: '#network' },
        { l: 'Demo', href: '#demo' },
      ].map(
        (a) => html`
          <a
            href="${a.href}"
            class="no-underline"
            style="color: var(--color-ink-2); border-bottom: 1px dashed var(--color-muted); padding-bottom: 1px;"
            >${a.l}</a
          >
        `,
      )}
    </nav>
  </footer>
`;
