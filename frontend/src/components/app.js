import { html } from 'lit-html';
import { nav } from './nav.js';
import { hero } from './hero.js';
import { problem } from './problem.js';
import { whynow } from './whynow.js';
import { network } from './network.js';
import { defense } from './defense.js';
import { demo } from './demo.js';
import { footer } from './footer.js';

// Page composition — judge-oriented narrative order:
//   hero        → the hook ($500k loss, one hidden sentence)
//   problem     → what prompt injection actually is
//   why now     → OWASP LLM01 + incident timeline
//   network     → interactive immunity network (the solution)
//   pipeline    → 3-layer defense running on each peer
//   demo        → dashboard preview + "Try it" CTA
export const app = () => html`
  ${nav()} ${hero()} ${problem()} ${whynow()} ${network()} ${defense()} ${demo()}
  ${footer()}
`;
