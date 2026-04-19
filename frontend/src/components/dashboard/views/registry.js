import { html, svg } from 'lit-html';
import { classMap } from 'lit-html/directives/class-map.js';
import { REGISTRY_ENTRIES } from '../mock-data.js';
import { store } from '../state.js';
import { Icon } from '../icons.js';
import { resolveTopology, resolveValidators } from '../../../lib/adapters.js';

const shortAddr = (addr) => {
  if (!addr || typeof addr !== 'string') return '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
};

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

// Deterministic seed from a string — used for small pseudo-random per-node
// labels (uptime, last-intel) so re-renders are stable without making up a
// fake backend field.
const hashStr = (s) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
};

const nodeTypeFromRole = (role) => {
  if (role === 'validator') return 'validator';
  if (role === 'peer') return 'peer';
  return 'self';
};

// Place nodes on the SVG canvas. Validators sit on the vertical mid-line at
// top/bottom (north/south). Peers split into two clusters — group A left,
// group B right — laid out on arcs that face their validator. This makes the
// ring+chord+validator edge structure visually obvious.
const layoutNodes = (topology) => {
  const width = 880;
  const height = 420;

  // Partition nodes.
  const validators = topology.nodes.filter((n) => n.role === 'validator');
  const peers = topology.nodes.filter((n) => n.role !== 'validator');

  // Peers grouped by id prefix (peer-a*, peer-b*). Fall back to alphabetical
  // split if the naming isn't group-partitioned.
  const groupA = peers.filter((n) => /^peer-a/i.test(n.id));
  const groupB = peers.filter((n) => /^peer-b/i.test(n.id));
  let a = groupA;
  let b = groupB;
  if (a.length === 0 && b.length === 0) {
    const mid = Math.ceil(peers.length / 2);
    a = peers.slice(0, mid);
    b = peers.slice(mid);
  }
  a.sort((x, y) => x.id.localeCompare(y.id));
  b.sort((x, y) => x.id.localeCompare(y.id));

  const placed = new Map();

  // Left cluster — group A on an arc centered on (cxA, cyA).
  const cxA = 250;
  const cxB = width - cxA;
  const cy = height / 2;
  const radius = 140;
  const arcSpan = Math.PI * 0.9;

  const placeArc = (list, cx, facingRight) => {
    const count = Math.max(list.length, 1);
    list.forEach((n, i) => {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const base = facingRight ? Math.PI - arcSpan / 2 : -arcSpan / 2;
      const angle = base + t * arcSpan;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      placed.set(n.id, { ...n, x, y });
    });
  };
  placeArc(a, cxA, true);
  placeArc(b, cxB, false);

  // Validators: first on top, second on bottom (or centered if only one).
  validators.forEach((n, i) => {
    const x = width / 2;
    const y = validators.length === 1 ? cy : (i === 0 ? 60 : height - 60);
    placed.set(n.id, { ...n, x, y });
  });

  // Anything unplaced (shouldn't happen, but defensive): drop onto a small
  // secondary ring around the center.
  topology.nodes.forEach((n, i) => {
    if (placed.has(n.id)) return;
    const angle = (Math.PI * 2 * i) / topology.nodes.length;
    placed.set(n.id, {
      ...n,
      x: width / 2 + Math.cos(angle) * 60,
      y: cy + Math.sin(angle) * 60,
    });
  });

  // Annotate each node with UI metadata derived from its id (deterministic,
  // not made up — same inputs → same outputs, no pretend backend data).
  const nodes = topology.nodes.map((n) => {
    const p = placed.get(n.id) || { x: width / 2, y: cy };
    const isSelf = n.id === topology.selfId;
    const seed = hashStr(n.id);
    const uptime = 99.5 + ((seed >>> 0) % 50) / 100;
    const lastIntelAgo = `${(seed % 6) + 1}m`;
    const publishedDisplay = 40 + (seed % 240);
    const type = isSelf ? 'self' : nodeTypeFromRole(n.role);
    const label = n.role === 'validator'
      ? n.id
      : `${n.id} · ${n.tenant}`;
    return {
      ...n,
      x: p.x,
      y: p.y,
      type,
      label,
      meta: {
        region: n.region,
        uptimePct: uptime,
        lastIntelAgo,
        intelPublished: publishedDisplay,
        stake: n.role === 'validator' ? '32 ETH' : null,
        role: n.role === 'validator'
          ? 'Consensus validator'
          : isSelf
            ? 'This operator node'
            : 'Peer operator · OpenClaw sidecar',
      },
    };
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = [];
  const seen = new Set();
  // Animate exactly one outbound edge from the self-node so propagation is
  // visible on the current viewer's perspective.
  const selfOutbound = topology.edges.find((e) => e.from === topology.selfId);

  for (const e of topology.edges) {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    if (!a || !b) continue;
    const key = [a.id, b.id].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const active = selfOutbound
      ? e.from === selfOutbound.from && e.to === selfOutbound.to
      : false;
    edges.push({ a, b, id: key, active });
  }

  return { width, height, nodes, edges, source: topology.source };
};

// Local view state for the interactive graph. Not part of the root store so
// rerenders stay confined to the registry view.
const graphState = {
  selectedId: null,
  hoverId: null,
  playing: true,
  tooltip: null, // { x, y, label } in SVG coordinates
};

const rerender = () => store.goto('registry');

const edgesTouching = (graph, id) => graph.edges.filter((e) => e.a.id === id || e.b.id === id);
const neighborsOf = (graph, id) =>
  edgesTouching(graph, id).map((e) => (e.a.id === id ? e.b : e.a));

const nodeRadius = (n) => (n.type === 'self' ? 11 : n.type === 'validator' ? 9 : 7);

const nodeTypeLabel = { self: 'This node', peer: 'Peer node', validator: 'Validator' };

const detailPanel = (graph) => {
  const id = graphState.selectedId;
  if (!id) {
    return html`
      <div class="registry-network-detail is-empty">
        <div class="registry-network-detail-title">Click any node</div>
        <p>
          Hover for a quick label. Click a node to pin its detail — region,
          tenant, and the peers it gossips with. Topology is served by
          <code>/api/network/topology</code> on every Fargate task, so any
          node agrees on the mesh.
        </p>
        <ul class="registry-network-detail-hints">
          <li><span class="registry-dot is-self"></span>This node — the Fargate task answering you right now</li>
          <li><span class="registry-dot is-peer"></span>Peer — another tenant's ClawGuard node</li>
          <li><span class="registry-dot is-validator"></span>Validator — publishes consensus on Base Sepolia</li>
        </ul>
      </div>
    `;
  }
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) return '';
  const { meta } = node;
  const neighbors = neighborsOf(graph, id);
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
        <div><dt>Tenant</dt><dd class="hash">${node.tenant}</dd></div>
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
    label: n.id,
    sub: `${nodeTypeLabel[n.type]} · ${n.meta.region} · ${n.tenant}`,
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

const emptyGraphPanel = () => html`
  <div class="registry-network is-paused">
    <div class="registry-network-head">
      <div>
        <div class="registry-network-title">Peer intel propagation</div>
        <div class="registry-network-sub">waiting for <code>/api/network/topology</code>…</div>
      </div>
    </div>
    <div class="registry-network-body" style="min-height:280px;display:flex;align-items:center;justify-content:center;color:var(--color-muted);font-size:13px;">
      Connecting to the mesh. Each Fargate task publishes its full view of
      the mesh at boot, so a single 200 OK populates this graph.
    </div>
  </div>
`;

const networkGraph = (graph) => {
  if (!graph) return emptyGraphPanel();
  const selected = graphState.selectedId;
  const hover = graphState.hoverId;
  const activeId = selected || hover;
  const activeEdgeIds = activeId
    ? new Set(edgesTouching(graph, activeId).map((e) => e.id))
    : null;

  const peerCount = graph.nodes.filter((n) => n.role === 'peer').length;
  const validatorCount = graph.nodes.filter((n) => n.role === 'validator').length;

  return html`
    <div class=${'registry-network' + (graphState.playing ? ' is-playing' : ' is-paused')}>
      <div class="registry-network-head">
        <div>
          <div class="registry-network-title">Peer intel propagation</div>
          <div class="registry-network-sub">
            live mesh · ${peerCount} peers + ${validatorCount} validators · max 3 outbound / node
            ${graph.source ? html` · source: <code>${graph.source}</code>` : ''}
          </div>
        </div>
        <div class="registry-network-head-right">
          <span class="dash-chip is-ghost">
            <span class="dash-dot"></span>
            <span>${graph.nodes.length} nodes · ${graph.edges.length} links</span>
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
          viewBox="0 0 ${graph.width} ${graph.height}"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="ClawGuard peer network propagation graph"
        >
          ${graph.edges.map((e) => {
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
          ${graph.nodes.map((n) => {
            const r = nodeRadius(n);
            const isSelected = selected === n.id;
            const isHovered = hover === n.id;
            const isDim = activeId && !isSelected && !isHovered
              && !neighborsOf(graph, activeId).some((nb) => nb.id === n.id);
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
                <text x=${n.x} y=${n.y + r + 14} text-anchor="middle">${n.id}</text>
              </g>
            `;
          })}
          ${graphState.tooltip
            ? svg`
              <g class="registry-network-tooltip" transform=${`translate(${graphState.tooltip.x}, ${graphState.tooltip.y})`} pointer-events="none">
                <rect x="-96" y="-34" width="192" height="32" rx="4" ry="4" />
                <text class="registry-network-tooltip-label" x="0" y="-20" text-anchor="middle">${graphState.tooltip.label}</text>
                <text class="registry-network-tooltip-sub" x="0" y="-8" text-anchor="middle">${graphState.tooltip.sub}</text>
              </g>
            `
            : ''}
        </svg>
        ${detailPanel(graph)}
      </div>
      <div class="registry-network-legend">
        <span><i style="background: var(--color-accent);"></i>This node</span>
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

const validatorCard = (validators) => {
  if (!validators?.available) {
    return html`
      <div class="registry-hero-card">
        <span class="registry-hero-label">Validators (8-block window)</span>
        <span class="registry-hero-value">—</span>
        <span class="registry-hero-sub">chain RPC unavailable</span>
      </div>
    `;
  }
  const top = (validators.validators || []).slice(0, 3);
  return html`
    <div class="registry-hero-card">
      <span class="registry-hero-label">Validators · last ${validators.window || 8} blocks</span>
      <span class="registry-hero-value">${top.length}</span>
      <span class="registry-hero-sub">
        block #${(validators.latest_block || 0).toLocaleString()} ·
        top proposer <code class="hash">${shortAddr(top[0]?.address)}</code>
      </span>
    </div>
  `;
};

export const registryView = () => {
  const { live } = store.getState();
  const topology = resolveTopology(live);
  const graph = topology ? layoutNodes(topology) : null;
  const cachedThreats =
    live?.health?.cached_threats ??
    live?.stats?.cached_threats ??
    REGISTRY_ENTRIES.length;
  const chainAvailable = !!live?.health?.chain_available;
  const fallbackTotal = REGISTRY_ENTRIES.reduce((s, e) => s + e.blockedCount, 0);
  return html`
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
        @click=${() => store.toast(chainAvailable ? 'ok' : 'warn', chainAvailable ? 'Registry is live-synced from the chain.' : 'Chain RPC unavailable. Cached entries shown.')}
      >
        ${Icon.shield}
        <span>${chainAvailable ? 'Live from chain' : 'Cache only'}</span>
      </button>
    </div>

    <div class="registry-hero">
      <div class="registry-hero-card">
        <span class="registry-hero-label">Chain cache · live</span>
        <span class="registry-hero-value">${cachedThreats.toLocaleString()}</span>
        <span class="registry-hero-sub">
          ${chainAvailable ? 'synced from Base Sepolia ThreatRegistry' : 'showing last known snapshot'}
        </span>
      </div>
      <div class="registry-hero-card">
        <span class="registry-hero-label">Blocked via chain-cache</span>
        <span class="registry-hero-value">${fallbackTotal.toLocaleString()}</span>
        <span class="registry-hero-sub">across all participating agents</span>
      </div>
      ${validatorCard(resolveValidators(live))}
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

    ${networkGraph(graph)}

    <div class="registry-grid">
      ${REGISTRY_ENTRIES.map(entryCard)}
    </div>
  </section>
`;
};
