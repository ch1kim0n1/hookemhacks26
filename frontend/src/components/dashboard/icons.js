import { html } from 'lit-html';

// Heroicons-outline style, 1.4 stroke. Sized by the consuming CSS.
export const Icon = {
  overview: html`
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2.8" y="2.8" width="5.8" height="5.8" rx="1" />
      <rect x="11.4" y="2.8" width="5.8" height="5.8" rx="1" />
      <rect x="2.8" y="11.4" width="5.8" height="5.8" rx="1" />
      <rect x="11.4" y="11.4" width="5.8" height="5.8" rx="1" />
    </svg>
  `,
  agents: html`
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="7" cy="7.5" r="2.8" />
      <circle cx="13.5" cy="6.5" r="2.2" />
      <path d="M2.5 16c.5-2.6 2.4-4.2 4.5-4.2s4 1.6 4.5 4.2" />
      <path d="M12 15.5c.2-1.6 1.3-2.8 2.7-2.8s2.5 1.2 2.7 2.8" />
    </svg>
  `,
  registry: html`
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <ellipse cx="10" cy="4.2" rx="6" ry="1.8" />
      <path d="M4 4.2v11.6c0 1 2.7 1.8 6 1.8s6-.8 6-1.8V4.2" />
      <path d="M4 9.5c0 1 2.7 1.8 6 1.8s6-.8 6-1.8" />
    </svg>
  `,
  attacks: html`
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10 2.5l6 2v5.2c0 3.5-2.5 6.4-6 7.8-3.5-1.4-6-4.3-6-7.8V4.5l6-2z" />
      <path d="M10 7v3.5" />
      <circle cx="10" cy="13" r="0.6" fill="currentColor" />
    </svg>
  `,
  audit: html`
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 2.5h7l3 3v12H5z" />
      <path d="M12 2.5v3h3" />
      <path d="M7.5 9.5h6M7.5 12h6M7.5 14.5h4" />
    </svg>
  `,
  settings: html`
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="10" cy="10" r="2.2" />
      <path d="M10 2v2M10 16v2M16.4 10h1.6M2 10h1.6M14.5 5.5l1.1-1.1M4.4 15.6l1.1-1.1M14.5 14.5l1.1 1.1M4.4 4.4l1.1 1.1" />
    </svg>
  `,
  info: html`
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7v4" />
      <circle cx="8" cy="5" r="0.6" fill="currentColor" />
    </svg>
  `,
  chevron: html`
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  `,
  close: html`
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  `,
  arrowRight: html`
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  `,
  signOut: html`
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10 3.5V3a1.5 1.5 0 00-1.5-1.5h-4A1.5 1.5 0 003 3v10a1.5 1.5 0 001.5 1.5h4A1.5 1.5 0 0010 13v-.5" />
      <path d="M7 8h7M12 5l3 3-3 3" />
    </svg>
  `,
  shield: html`
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10 2.5l6 2v5.2c0 3.5-2.5 6.4-6 7.8-3.5-1.4-6-4.3-6-7.8V4.5l6-2z" />
      <path d="M7.5 10.5l2 2 3.5-4" />
    </svg>
  `,
  key: html`
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="7" cy="10" r="3.5" />
      <path d="M10.5 10h7M15 10v2.5M13 10v2" />
    </svg>
  `,
  bell: html`
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 8.5a5 5 0 1110 0v3l1.5 2h-13L5 11.5v-3z" />
      <path d="M8.5 15.5a1.5 1.5 0 003 0" />
    </svg>
  `,
  user: html`
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="10" cy="7" r="3.2" />
      <path d="M3.5 17c.8-3.2 3.4-4.8 6.5-4.8s5.7 1.6 6.5 4.8" />
    </svg>
  `,
  search: html`
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2L13.5 13.5" />
    </svg>
  `,
  check: html`
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  `,
  copy: html`
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="5" y="5" width="8" height="8" rx="1.2" />
      <path d="M3 10.5V3.5A1 1 0 014 2.5h7" />
    </svg>
  `,
  cloud: html`
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6.2 14.5h8a3 3 0 00.5-5.96 4.5 4.5 0 00-8.85-.84A3.2 3.2 0 006.2 14.5z" />
    </svg>
  `,
};
