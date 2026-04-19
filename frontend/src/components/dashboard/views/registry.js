import { html, svg } from 'lit-html';
import { classMap } from 'lit-html/directives/class-map.js';
import { REGISTRY_ENTRIES } from '../mock-data.js';
import { store } from '../state.js';
import { Icon } from '../icons.js';

const severityToTone = {
  critical: 'danger',
  high: 'warn',
  medium: 'info',
  low: 'neutral',
};

const CONTRACT_ADDRESS = '0x7fa19ccb2e4b8d9f3e2c1a7b84d3f1e29d1ac3a2';
const basescanTx = (hash) => `https://sepolia.basescan.org/tx/${hash}`;
const basescanAddr = (addr) => `https://sepolia.basescan.org/address/${addr}`;

// Fully realized tx hashes so the Basescan link resolves to something plausible
// (we're in demo mode, but the URL format is real and the prefix matches the
// short hashes shown in the UI).
const REALISTIC_TX = {
  '0x9a3bcd…e112': '0x9a3bcdf14e7c9a621b83a2d11f9e29cfc47a83ad1b7d25f392e7cf81a9e1e112',
  '0x41aa21…bb8e': '0x41aa21c8e7f9a4b611cc2f8d3e9a7b1c4d2e5f6a7890abcdef1234567890bb8e',
  '0xdd7c19…2f91': '0xdd7c19a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a098765432109876542f91',
  '0x55eabb…1103': '0x55eabbaaccee1234567890abcdef1234567890abcdef1234567890abcdef1103',
  '0x77113c…44ab': '0x77113c9e8d7c6b5a4938271605a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e344ab',
  '0x0ab8c2…77fe': '0x0ab8c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f977fe',
  '0xf3312a…b0ee': '0xf3312ab4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0b0ee',
  '0x61b0cc…7799': '0x61b0cc1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f7799',
};

const openTx = (short) => {
  const full = REALISTIC_TX[short] || `0x${short.replace(/…|\.|\s/g, '')}`;
  window.open(basescanTx(full), '_blank', 'noopener,noreferrer');
};

// Graph geometry is deterministic; node metadata is also deterministic so the
// detail panel shows the same thing each refresh.
const REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1'];

const buildGraph = () => {
  const width = 880;
  const height = 320;
  const cx = width / 2;
  const cy = height / 2;

  const self = {
    id: 'you',
    label: 'You · acme.co',
    x: cx,
    y: cy,
    type: 'self',
    meta: {
      region: 'eu-central-1',
      uptimePct: 99.98,
      lastIntelAgo: '2m',
      intelPublished: 147,
      stake: null,
      role: 'Operator console',
    },
  };
  const peerCount = 8;
  const peers = Array.from({ length: peerCount }).map((_, i) => {
    const angle = (Math.PI * 2 * i) / peerCount - Math.PI / 2;
    const r = 118;
    const hex = (0xa1 + i * 3).toString(16).slice(-2);
    return {
      id: `peer-${i}`,
      label: `peer-${hex}`,
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      type: 'peer',
      meta: {
        region: REGIONS[i % REGIONS.length],
        uptimePct: 99.5 + ((i * 7) % 40) / 100,
        lastIntelAgo: i === 0 ? '32s' : i === 3 ? '4m' : `${1 + ((i * 2) % 12)}m`,
        intelPublished: 80 + ((i * 47) % 220),
        stake: null,
        role: `anon tenant #${(i + 1).toString().padStart(2, '0')}`,
      },
    };
  });

  const validators = [
    {
      id: 'val-1',
      label: 'validator-north',
      x: 80,
      y: 70,
      type: 'validator',
      meta: {
        region: 'us-east-1',
        uptimePct: 99.99,
        lastIntelAgo: '18s',
        intelPublished: 2104,
        stake: '32 ETH',
        role: 'Consensus validator',
      },
    },
    {
      id: 'val-2',
      label: 'validator-south',
      x: width - 80,
      y: height - 50,
      type: 'validator',
      meta: {
        region: 'ap-southeast-1',
        uptimePct: 99.96,
        lastIntelAgo: '11s',
        intelPublished: 1987,
        stake: '32 ETH',
        role: 'Consensus validator',
      },
    },
  ];

  const nodes = [self, ...peers, ...validators];

  const edges = [];
  const addEdge = (a, b, active) => {
    const key = [a.id, b.id].sort().join('|');
    if (edges.some((e) => [e.a.id, e.b.id].sort().join('|') === key)) return;
    edges.push({ a, b, active, id: key });
  };
  // Self → 3 nearest peers (first one is the currently propagating edge).
  [0, 2, 5].forEach((i, k) => addEdge(self, peers[i], k === 0));
  // Each peer → up to 3 outbound.
  peers.forEach((p, i) => {
    const targets = [
      peers[(i + 1) % peerCount],
      peers[(i + 3) % peerCount],
      i % 2 === 0 ? validators[0] : validators[1],
    ];
    targets.forEach((t, k) => {
      if (t.id === p.id) return;
      addEdge(p, t, i === 0 && k === 2);
    });
  });

  return { width, height, nodes, edges };
};

// Module-scoped graph — geometry is deterministic so we build once.
const GRAPH = buildGraph();

// Local view state for the interactive graph. Not part of the root store so
// rerenders stay confined to the registry view.
const graphState = {
  selectedId: null,
  hoverId: null,
  playing: true,
  tooltip: null, // { x, y, label } in SVG coordinates
};

const rerender = () => store.goto('registry');

// Fast lookup: which edges touch a node?
const edgesTouching = (id) => GRAPH.edges.filter((e) => e.a.id === id || e.b.id === id);
const neighborsOf = (id) =>
  edgesTouching(id).map((e) => (e.a.id === id ? e.b : e.a));

const nodeRadius = (n) => (n.type === 'self' ? 11 : n.type === 'validator' ? 9 : 7);

const nodeTypeLabel = { self: 'This console', peer: 'Peer node', validator: 'Validator' };

const detailPanel = () => {
  const id = graphState.selectedId;
  if (!id) {
    return html`
      <div class="registry-network-detail is-empty">
        <div class="registry-network-detail-title">Click any node</div>
        <p>
          Hover to see a quick label. Click a node to pin its detail — uptime,
          region, intel count, and the peers it gossips with.
        </p>
        <ul class="registry-network-detail-hints">
          <li><span class="registry-dot is-self"></span>You — this console</li>
          <li><span class="registry-dot is-peer"></span>Peer node — another operator running ClawGuard</li>
          <li><span class="registry-dot is-validator"></span>Validator — publishes consensus on Base Sepolia</li>
        </ul>
      </div>
    `;
  }
  const node = GRAPH.nodes.find((n) => n.id === id);
  if (!node) return '';
  const { meta } = node;
  const neighbors = neighborsOf(id);
  return html`
    <div class=${'registry-network-detail is-' + node.type}>
      <div class="registry-network-detail-head">
        <div>
          <span class="registry-network-detail-kicker">${nodeTypeLabel[node.type]}</span>
          <div class="registry-network-detail-title">${node.label}</div>
        </div>
        <button
          class="icon-btn"
          type="button"
          aria-label="Close detail"
          @click=${() => { graphState.selectedId = null; rerender(); }}
        >
          ${Icon.close}
        </button>
      </div>
      <dl class="registry-network-detail-dl">
        <div><dt>Role</dt><dd>${meta.role}</dd></div>
        <div><dt>Region</dt><dd>${meta.region}</dd></div>
        <div><dt>Uptime</dt><dd>${meta.uptimePct.toFixed(2)}%</dd></div>
        <div><dt>Last intel</dt><dd>${meta.lastIntelAgo} ago</dd></div>
        <div><dt>Intel published</dt><dd>${meta.intelPublished.toLocaleString()}</dd></div>
        ${meta.stake ? html`<div><dt>Stake</dt><dd>${meta.stake}</dd></div>` : ''}
      </dl>
      <div class="registry-network-detail-neighbors">
        <div class="registry-network-detail-label">Gossips with ${neighbors.length}</div>
        <div class="registry-network-detail-chips">
          ${neighbors.map(
            (n) => html`
              <button
                class=${'registry-neighbor-chip is-' + n.type}
                type="button"
                @click=${() => { graphState.selectedId = n.id; rerender(); }}
              >
                ${n.label}
              </button>
            `,
          )}
        </div>
      </div>
    </div>
  `;
};

const handleNodeEnter = (n) => {
  graphState.hoverId = n.id;
  graphState.tooltip = {
    x: n.x,
    y: n.y - nodeRadius(n) - 12,
    label: n.label,
    sub: `${nodeTypeLabel[n.type]} · ${n.meta.region}`,
  };
  rerender();
};
const handleNodeLeave = () => {
  graphState.hoverId = null;
  graphState.tooltip = null;
  rerender();
};
const handleNodeClick = (n) => {
  graphState.selectedId = graphState.selectedId === n.id ? null : n.id;
  rerender();
};

const networkGraph = () => {
  const selected = graphState.selectedId;
  const hover = graphState.hoverId;
  const activeId = selected || hover;
  const activeEdgeIds = activeId
    ? new Set(edgesTouching(activeId).map((e) => e.id))
    : null;

  return html`
    <div class=${'registry-network' + (graphState.playing ? ' is-playing' : ' is-paused')}>
      <div class="registry-network-head">
        <div>
          <div class="registry-network-title">Peer intel propagation</div>
          <div class="registry-network-sub">live · max 3 outbound links per node</div>
        </div>
        <div class="registry-network-head-right">
          <span class="dash-chip is-ghost">
            <span class="dash-dot"></span>
            <span>${GRAPH.nodes.length} nodes · ${GRAPH.edges.length} links</span>
          </span>
          <button
            class="btn btn-ghost btn-sm"
            type="button"
            aria-pressed=${graphState.playing ? 'true' : 'false'}
            @click=${() => { graphState.playing = !graphState.playing; rerender(); }}
          >
            ${graphState.playing ? '⏸ Pause' : '▶ Play'}
          </button>
        </div>
      </div>
      <div class="registry-network-body">
        <svg
          class="registry-network-svg"
          viewBox="0 0 ${GRAPH.width} ${GRAPH.height}"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="ClawGuard peer network propagation graph"
        >
          ${GRAPH.edges.map((e) => {
            const isActive = e.active;
            const isHighlighted = activeEdgeIds?.has(e.id) ?? false;
            const cls = [
              'registry-network-edge',
              isActive ? 'is-active' : '',
              isHighlighted ? 'is-highlighted' : '',
              activeId && !isHighlighted ? 'is-dim' : '',
            ].filter(Boolean).join(' ');
            return svg`
              <line
                class=${cls}
                x1=${e.a.x}
                y1=${e.a.y}
                x2=${e.b.x}
                y2=${e.b.y}
              />
              ${isActive && graphState.playing ? svg`
                <circle class="registry-network-packet" r="3.2">
                  <animate attributeName="cx" from=${e.a.x} to=${e.b.x} dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="cy" from=${e.a.y} to=${e.b.y} dur="1.8s" repeatCount="indefinite" />
                </circle>
              ` : ''}
            `;
          })}
          ${GRAPH.nodes.map((n) => {
            const r = nodeRadius(n);
            const isSelected = selected === n.id;
            const isHovered = hover === n.id;
            const isDim = activeId && !isSelected && !isHovered
              && !neighborsOf(activeId).some((nb) => nb.id === n.id);
            const cls = [
              'registry-network-node',
              'is-' + n.type,
              isSelected ? 'is-selected' : '',
              isHovered ? 'is-hovered' : '',
              isDim ? 'is-dim' : '',
            ].filter(Boolean).join(' ');
            return svg`
              <g
                class=${cls}
                tabindex="0"
                role="button"
                aria-label=${`${n.label} · ${nodeTypeLabel[n.type]}`}
                @mouseenter=${() => handleNodeEnter(n)}
                @mouseleave=${handleNodeLeave}
                @focus=${() => handleNodeEnter(n)}
                @blur=${handleNodeLeave}
                @click=${() => handleNodeClick(n)}
                @keydown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNodeClick(n); } }}
              >
                ${isSelected ? svg`<circle class="registry-network-ring" cx=${n.x} cy=${n.y} r=${r + 6} />` : ''}
                <circle cx=${n.x} cy=${n.y} r=${r} />
                <text x=${n.x} y=${n.y + r + 14} text-anchor="middle">${n.label}</text>
              </g>
            `;
          })}
          ${graphState.tooltip
            ? svg`
              <g class="registry-network-tooltip" transform=${`translate(${graphState.tooltip.x}, ${graphState.tooltip.y})`} pointer-events="none">
                <rect x="-78" y="-32" width="156" height="30" rx="4" ry="4" />
                <text class="registry-network-tooltip-label" x="0" y="-18" text-anchor="middle">${graphState.tooltip.label}</text>
                <text class="registry-network-tooltip-sub" x="0" y="-7" text-anchor="middle">${graphState.tooltip.sub}</text>
              </g>
            `
            : ''}
        </svg>
        ${detailPanel()}
      </div>
      <div class="registry-network-legend">
        <span><i style="background: var(--color-accent);"></i>You</span>
        <span><i style="background: var(--color-ocean-600);"></i>Peer node</span>
        <span><i style="background: var(--color-ocean-800);"></i>Validator</span>
        <span><i style="background: var(--color-accent); box-shadow: 0 0 0 1px var(--color-accent);"></i>active propagation</span>
      </div>
    </div>
  `;
};

const entryCard = (e) => html`
  <article class="registry-card">
    <header class="registry-card-head">
      <div class="registry-card-titleblock">
        <span class="dash-chip is-family">${e.family.replace(/_/g, ' ')}</span>
        <h3 class="registry-card-hash">${e.hash}</h3>
      </div>
      <span class=${classMap({ 'dash-pill': true, [`is-${severityToTone[e.severity]}`]: true })}>
        ${e.severity}
      </span>
    </header>
    <p class="registry-card-summary">${e.summary}</p>
    <dl class="registry-card-dl">
      <div><dt>First seen</dt><dd>${e.firstSeen}</dd></div>
      <div><dt>Reported by</dt><dd>${e.reportedBy}</dd></div>
      <div><dt>Confirmed by</dt><dd>${e.confirmedBy} peers</dd></div>
      <div><dt>Blocked (total)</dt><dd>${e.blockedCount.toLocaleString()}</dd></div>
      <div><dt>Tx hash</dt><dd class="hash">${e.txHash}</dd></div>
    </dl>
    <footer class="registry-card-foot">
      <button
        class="btn btn-ghost btn-sm"
        type="button"
        @click=${() => openTx(e.txHash)}
        aria-label="Open transaction ${e.txHash} on Basescan in a new tab"
      >
        View on Basescan ↗
      </button>
      <button
        class="btn btn-primary btn-sm"
        type="button"
        @click=${() => store.toast('ok', `Intel ${e.hash} re-published. Peers notified.`)}
      >
        Re-publish
      </button>
    </footer>
  </article>
`;

export const registryView = () => html`
  <section class="dash-section">
    <div class="dash-page-header">
      <p class="dash-page-header-sub">
        Threat intel confirmed by at least two peers and pinned on Base Sepolia.
        Once a hash is here, every participating agent blocks it with a ~5&nbsp;ms chain
        lookup before any rules or classifier run.
      </p>
      <button
        class="btn btn-primary btn-sm"
        type="button"
        @click=${() => store.toast('ok', 'Registry is live-synced from the chain. Forced refresh complete.')}
      >
        ${Icon.shield}
        <span>Refresh from chain</span>
      </button>
    </div>

    <div class="registry-hero">
      <div class="registry-hero-card">
        <span class="registry-hero-label">Total entries</span>
        <span class="registry-hero-value">${REGISTRY_ENTRIES.length}</span>
        <span class="registry-hero-sub">all confirmed by peer consensus</span>
      </div>
      <div class="registry-hero-card">
        <span class="registry-hero-label">Blocked via chain-cache</span>
        <span class="registry-hero-value">
          ${REGISTRY_ENTRIES.reduce((s, e) => s + e.blockedCount, 0).toLocaleString()}
        </span>
        <span class="registry-hero-sub">across all participating agents</span>
      </div>
      <a
        class="registry-hero-card is-link"
        href=${basescanAddr(CONTRACT_ADDRESS)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span class="registry-hero-label">Contract ↗</span>
        <span class="registry-hero-value hash">0x7fa1…c3a2</span>
        <span class="registry-hero-sub">ThreatRegistry · Base Sepolia</span>
      </a>
    </div>

    ${networkGraph()}

    <div class="registry-grid">
      ${REGISTRY_ENTRIES.map(entryCard)}
    </div>
  </section>
`;
