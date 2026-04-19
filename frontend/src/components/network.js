import { html, svg } from 'lit-html';
import { MESH, ANCHORS, SITES, ACTS, VIEWBOX } from '../lib/data.js';

const edge = (e) => {
  const a = MESH.nodes.find((n) => n.id === e.a);
  const b = MESH.nodes.find((n) => n.id === e.b);
  return svg`
    <line
      class="net-link"
      data-edge="${e.key}"
      data-from="${e.a}"
      data-to="${e.b}"
      x1="${a.x}" y1="${a.y}"
      x2="${b.x}" y2="${b.y}"
    />
  `;
};

const node = (n) => svg`
  <circle
    class="net-node"
    data-node="${n.id}"
    cx="${n.x}"
    cy="${n.y}"
    r="9"
  />
`;

const siteLabel = (anchorId, site, key) => {
  const n = MESH.nodes.find((m) => m.id === anchorId);
  if (!n) return svg``;
  const above = n.y > VIEWBOX.h / 2;
  // Roughly size the pill to fit the label text (~9px per char in IBM Plex Mono).
  const charW = 9;
  const padX = 18;
  const w = Math.max(160, Math.round(site.label.length * charW + padX * 2));
  const h = 28;
  // Anchor horizontally so the pill stays fully inside the viewBox.
  const maxX = VIEWBOX.w - w - 8;
  const minX = 8;
  let bx = Math.round(n.x - w / 2);
  if (bx < minX) bx = minX;
  if (bx > maxX) bx = maxX;
  const by = above ? n.y - 56 : n.y + 28;
  const textX = bx + w / 2;
  const textY = by + h / 2 + 4;
  const lineY1 = above ? n.y - 14 : n.y + 14;
  const lineY2 = above ? by + h : by;
  return svg`
    <g class="net-site" data-site="${key}" opacity="0">
      <rect
        class="net-site-box"
        x="${bx}"
        y="${by}"
        width="${w}"
        height="${h}"
        rx="6"
        ry="6"
      />
      <text class="net-site-label" x="${textX}" y="${textY}" text-anchor="middle">
        ${site.label}
      </text>
      <line
        x1="${n.x}"
        y1="${lineY1}"
        x2="${n.x}"
        y2="${lineY2}"
        stroke="var(--color-accent)"
        stroke-width="1.5"
        stroke-dasharray="2 2"
      />
    </g>
  `;
};

const actPanel = (a, i) => html`
  <div class="scrolly-panel ${i === 0 ? 'is-active' : ''}" data-act="${i}">
    <h3
      class="display mb-3"
      style="font-size: clamp(22px, 2.4vw, 32px); text-wrap: balance; word-break: break-word;"
    >
      ${a.title}
    </h3>
    <p class="lede" style="margin: 0; font-size: 15px;">${a.body}</p>
  </div>
`;

const actDot = (_, i) => html`
  <span class="act-dot ${i === 0 ? 'is-active' : ''}" data-act-dot="${i}"></span>
`;

// Network — tall scroll section. Outer wrapper sets scroll distance; inner
// is position:sticky so the visualization pins to the viewport. ScrollTrigger
// maps scroll progress to act transitions (see animations.js).
export const network = () => html`
  <section id="network" class="rule-dashed bg-warm">
    <div
      data-network-pin
      style="height: calc(var(--act-count, 6) * 100svh);"
    >
      <div
        class="sticky top-0 flex items-center overflow-hidden"
        style="height: 100svh;"
      >
        <div class="container-wide w-full">
          <div
            class="grid gap-10 items-center"
            style="grid-template-columns: minmax(340px, 400px) minmax(0, 1fr);"
          >
            <!-- Left: narrative panels -->
            <div class="flex flex-col gap-5">
              <div class="flex items-center gap-2">
                <span class="live-dot"></span>
                <span
                  style="font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--color-muted);"
                >
                  peer mesh · no central server
                </span>
              </div>

              <div class="relative" style="min-height: 260px;" data-network-panels>
                ${ACTS.map(actPanel)}
              </div>

              <div class="flex gap-2 items-center mt-1" data-act-dots>
                ${ACTS.map(actDot)}
                <span
                  style="font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-muted); margin-left: 8px;"
                >
                  scroll
                </span>
              </div>
            </div>

            <!-- Right: decentralized mesh SVG -->
            <div
              class="relative w-full"
              style="aspect-ratio: ${VIEWBOX.w} / ${VIEWBOX.h};"
            >
              <svg
                class="absolute inset-0 w-full h-full"
                viewBox="0 0 ${VIEWBOX.w} ${VIEWBOX.h}"
                data-network-svg
                data-user1="${ANCHORS.user1}"
                data-user2="${ANCHORS.user2}"
              >
                <g data-mesh-edges>${MESH.edges.map(edge)}</g>
                <g data-mesh-nodes>${MESH.nodes.map(node)}</g>
                ${siteLabel(ANCHORS.user1, SITES.user1, 'user1')}
                ${siteLabel(ANCHORS.user2, SITES.user2, 'user2')}
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
`;
