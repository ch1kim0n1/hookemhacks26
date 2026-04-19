import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { MESH, ANCHORS, WAVES_FROM_USER1, ACTS } from './data.js';

gsap.registerPlugin(ScrollTrigger);

const EASE = 'power3.out';
const DUR = 0.7;

const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// -----------------------------------------------------------------------------
// Reveal-on-scroll. Direction variants start from a different transform;
// `--stagger: N` adds 80ms * N delay for cascades.
// -----------------------------------------------------------------------------
const revealVariant = (el) => {
  if (el.classList.contains('from-left')) return { x: -36, y: 0, scale: 1 };
  if (el.classList.contains('from-right')) return { x: 36, y: 0, scale: 1 };
  if (el.classList.contains('scale-in')) return { x: 0, y: 14, scale: 0.96 };
  return { x: 0, y: 28, scale: 1 };
};

const stagger = (el) => {
  const raw = getComputedStyle(el).getPropertyValue('--stagger');
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n * 0.08 : 0;
};

const setupReveals = () => {
  document.querySelectorAll('.reveal-prep').forEach((el) => {
    if (reducedMotion()) {
      el.style.opacity = '1';
      el.style.transform = 'none';
      return;
    }
    const { x, y, scale } = revealVariant(el);
    gsap.set(el, { opacity: 0, x, y, scale });
    gsap.to(el, {
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      duration: DUR,
      ease: EASE,
      delay: stagger(el),
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    });
  });
};

// -----------------------------------------------------------------------------
// Modality bars fill from 0% → target.
// -----------------------------------------------------------------------------
const setupBars = () => {
  document.querySelectorAll('[data-bar-pct]').forEach((bar) => {
    const fill = bar.querySelector('em');
    if (!fill) return;
    const pct = parseFloat(bar.getAttribute('data-bar-pct'));
    if (!Number.isFinite(pct)) return;
    if (reducedMotion()) {
      fill.style.width = `${pct}%`;
      return;
    }
    gsap.fromTo(
      fill,
      { width: '0%' },
      {
        width: `${pct}%`,
        duration: 0.9,
        ease: EASE,
        scrollTrigger: { trigger: bar, start: 'top 92%', once: true },
      },
    );
  });
};

// -----------------------------------------------------------------------------
// Problem specimen — reveals the hidden white-on-white instruction and a
// short annotation beneath it when the section scrolls into view.
// -----------------------------------------------------------------------------
const setupProblemReveal = () => {
  const specimen = document.querySelector('[data-problem-specimen]');
  if (!specimen) return;
  const hidden = specimen.querySelector('[data-problem-hidden]');
  const annot = specimen.querySelector('[data-problem-annot]');
  if (!hidden || !annot) return;
  if (reducedMotion()) {
    hidden.classList.add('is-revealed');
    annot.classList.add('is-revealed');
    return;
  }
  ScrollTrigger.create({
    trigger: specimen,
    start: 'top 65%',
    once: true,
    onEnter: () => {
      hidden.classList.add('is-revealed');
      setTimeout(() => annot.classList.add('is-revealed'), 280);
    },
  });
};

// -----------------------------------------------------------------------------
// Hero feed ticker — subtle row cycling so it feels alive.
// -----------------------------------------------------------------------------
const setupFeedDrift = () => {
  if (reducedMotion()) return;
  const rows = document.querySelectorAll('[data-hero-feed] .feed-row');
  if (rows.length === 0) return;
  rows.forEach((row, i) => {
    gsap.fromTo(
      row,
      { backgroundColor: 'rgba(242,215,196,0)' },
      {
        backgroundColor: 'rgba(242,215,196,0.35)',
        duration: 0.8,
        delay: i * 0.9 + 1,
        repeat: -1,
        repeatDelay: rows.length * 0.9,
        yoyo: true,
        ease: 'sine.inOut',
      },
    );
  });
};

// -----------------------------------------------------------------------------
// Network scrollytelling — decentralized peer mesh, six acts driven by
// scroll progress across the pinned outer wrapper.
//
// Acts:
//   0 intro     — all nodes idle
//   1 attack    — user1 highlighted, fakenews.net label on
//   2 detect    — user1 turns hit (red)
//   3 gossip    — BFS wave of immune neighbors radiates outward
//   4 twin      — whole mesh immune, user2 highlighted, fakenewsnetwork.site
//   5 blocked   — user2 blocks instantly (cache hit)
// -----------------------------------------------------------------------------
const setupNetworkScrollytelling = () => {
  const pin = document.querySelector('[data-network-pin]');
  if (!pin) return;
  const svgEl = document.querySelector('[data-network-svg]');
  if (!svgEl) return;
  const panels = Array.from(document.querySelectorAll('[data-network-panels] .scrolly-panel'));
  const dots = Array.from(document.querySelectorAll('[data-act-dots] .act-dot'));
  const siteUser1 = document.querySelector('[data-site="user1"]');
  const siteUser2 = document.querySelector('[data-site="user2"]');

  // Per-act scroll distance so the section height scales with act count.
  pin.style.setProperty('--act-count', ACTS.length);

  const nodeById = (id) =>
    svgEl.querySelector(`[data-node="${CSS.escape(id)}"]`);

  const allNodes = Array.from(svgEl.querySelectorAll('.net-node'));
  const allEdges = Array.from(svgEl.querySelectorAll('.net-link'));

  // Map a pair of node ids → the <line> that connects them, for edge-by-edge
  // propagation animations. Edges are undirected so we index both orders.
  const edgeMap = new Map();
  for (const e of allEdges) {
    const a = e.getAttribute('data-from');
    const b = e.getAttribute('data-to');
    edgeMap.set(`${a}|${b}`, e);
    edgeMap.set(`${b}|${a}`, e);
  }

  // Pending setTimeouts for the gossip wave, so switching acts cancels them.
  let gossipTimers = [];
  const cancelGossip = () => {
    gossipTimers.forEach((t) => clearTimeout(t));
    gossipTimers = [];
  };

  const clearNode = (el) =>
    el.classList.remove('is-you', 'is-hit', 'is-immune', 'is-blocked');

  const clearAll = () => {
    cancelGossip();
    allNodes.forEach(clearNode);
    allEdges.forEach((e) => e.classList.remove('is-active', 'is-immune'));
  };

  const setSite = (el, show) => {
    if (!el) return;
    gsap.to(el, {
      opacity: show ? 1 : 0,
      duration: reducedMotion() ? 0 : 0.35,
      ease: EASE,
    });
  };

  const applyAct = (idx) => {
    clearAll();
    panels.forEach((p, i) => p.classList.toggle('is-active', i === idx));
    dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));

    const u1 = nodeById(ANCHORS.user1);
    const u2 = nodeById(ANCHORS.user2);

    const hideBoth = () => {
      setSite(siteUser1, false);
      setSite(siteUser2, false);
    };

    if (idx === 0) {
      hideBoth();
      return;
    }

    if (idx === 1) {
      // attack — user 1 highlighted, site label on
      u1?.classList.add('is-you');
      setSite(siteUser1, true);
      setSite(siteUser2, false);
      return;
    }

    if (idx === 2) {
      // detect — user 1 flips to hit
      u1?.classList.add('is-hit');
      setSite(siteUser1, true);
      setSite(siteUser2, false);
      return;
    }

    if (idx === 3) {
      // gossip — wave radiates outward from user1, propagating edge-by-edge
      // so you can see each neighbor receiving the signed fingerprint from
      // the previous ring.
      u1?.classList.add('is-hit');
      setSite(siteUser1, true);
      setSite(siteUser2, false);

      if (reducedMotion()) {
        MESH.nodes.forEach((n) => {
          if (n.id === ANCHORS.user1) return;
          nodeById(n.id)?.classList.add('is-immune');
        });
        return;
      }

      // For each node (other than source), remember which immune neighbor
      // gossiped to it — that's the edge we'll flash.
      const parent = new Map();
      const reached = new Set([ANCHORS.user1]);
      for (let w = 1; w < WAVES_FROM_USER1.length; w++) {
        for (const id of WAVES_FROM_USER1[w]) {
          // Any neighbor already reached in a previous wave can be the source.
          for (const nb of MESH.adjacency.get(id)) {
            if (reached.has(nb)) {
              parent.set(id, nb);
              break;
            }
          }
          reached.add(id);
        }
      }

      const waveGap = 360; // ms between BFS rings
      const intraGap = 40; // ms between peers within the same ring
      const edgeHold = 260; // edge stays highlighted until destination lights up
      WAVES_FROM_USER1.slice(1).forEach((wave, w) => {
        wave.forEach((id, k) => {
          const base = w * waveGap + k * intraGap;
          const src = parent.get(id);
          const edge = src ? edgeMap.get(`${src}|${id}`) : null;
          // Flash the edge first — signed fingerprint traveling on the wire.
          if (edge) {
            gossipTimers.push(
              setTimeout(() => edge.classList.add('is-active'), base),
            );
          }
          // Then the destination peer becomes immune (cache hit ready).
          gossipTimers.push(
            setTimeout(() => {
              const n = nodeById(id);
              if (n && !n.classList.contains('is-hit')) {
                n.classList.add('is-immune');
              }
              if (edge) edge.classList.add('is-immune');
            }, base + edgeHold),
          );
        });
      });
      return;
    }

    if (idx === 4) {
      // twin — whole mesh already immune, user2 highlighted
      MESH.nodes.forEach((n) => {
        const el = nodeById(n.id);
        if (!el) return;
        if (n.id === ANCHORS.user1) el.classList.add('is-hit');
        else el.classList.add('is-immune');
      });
      u2?.classList.remove('is-immune');
      u2?.classList.add('is-you');
      setSite(siteUser1, false);
      setSite(siteUser2, true);
      return;
    }

    if (idx === 5) {
      // blocked — user2 is blocked on cache hit
      MESH.nodes.forEach((n) => {
        const el = nodeById(n.id);
        if (!el) return;
        if (n.id === ANCHORS.user1) el.classList.add('is-hit');
        else el.classList.add('is-immune');
      });
      u2?.classList.remove('is-immune');
      u2?.classList.add('is-blocked');
      setSite(siteUser1, false);
      setSite(siteUser2, true);
      return;
    }
  };

  applyAct(0);

  ScrollTrigger.create({
    trigger: pin,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => {
      const idx = Math.min(
        ACTS.length - 1,
        Math.floor(self.progress * ACTS.length),
      );
      if (pin.dataset.act !== String(idx)) {
        pin.dataset.act = String(idx);
        applyAct(idx);
      }
    },
  });
};

// -----------------------------------------------------------------------------
// "Why now" — a 6-act story that stages a $500k OpenClaw heist against the
// shape of Vitalik's April 2026 post. Scroll progresses acts, not the page.
// Acts: 0 intro · 1 parse · 2 reveal hidden HTML comment · 3 tool call ·
//       4 drain confirmed · 5 Vitalik quote.
// -----------------------------------------------------------------------------
const setupStoryScrollytelling = () => {
  const pin = document.querySelector('[data-story-pin]');
  if (!pin) return;
  const panels = Array.from(document.querySelectorAll('[data-story-panels] .scrolly-panel'));
  if (panels.length === 0) return;
  const dots = Array.from(document.querySelectorAll('[data-story-dots] .act-dot'));
  const hiddenLine = document.querySelector('[data-story-hidden]');
  const toolEl = document.querySelector('[data-story-tool] > div');
  const drainEl = document.querySelector('[data-story-drain] > div');

  pin.style.setProperty('--story-count', panels.length);

  const setHidden = (reveal) => {
    if (!hiddenLine) return;
    hiddenLine.style.background = reveal ? 'rgba(217,90,43,0.14)' : 'transparent';
    hiddenLine.style.opacity = reveal ? '1' : '0.12';
  };

  const setTool = (on) => {
    if (!toolEl) return;
    toolEl.style.opacity = on ? '1' : '0.45';
    toolEl.style.borderColor = on ? 'var(--color-accent)' : 'var(--color-line)';
    toolEl.style.background = on ? 'var(--color-paper-2)' : 'var(--color-paper-3)';
  };

  const setDrain = (on) => {
    if (!drainEl) return;
    drainEl.style.opacity = on ? '1' : '0.35';
    drainEl.style.background = on ? '#fecaca' : 'var(--color-paper-3)';
    drainEl.style.borderColor = on ? 'var(--color-accent-2)' : 'var(--color-line)';
  };

  const applyAct = (idx) => {
    panels.forEach((p, i) => p.classList.toggle('is-active', i === idx));
    dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));

    // Stage state machine — each act accumulates.
    setHidden(idx >= 2);
    setTool(idx >= 3);
    setDrain(idx >= 4);
  };

  applyAct(0);

  ScrollTrigger.create({
    trigger: pin,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => {
      const idx = Math.min(
        panels.length - 1,
        Math.floor(self.progress * panels.length),
      );
      if (pin.dataset.act !== String(idx)) {
        pin.dataset.act = String(idx);
        applyAct(idx);
      }
    },
  });
};

// -----------------------------------------------------------------------------
// Entry point.
// -----------------------------------------------------------------------------
export const initAnimations = () => {
  setupReveals();
  setupBars();
  setupProblemReveal();
  setupFeedDrift();
  setupNetworkScrollytelling();
  setupStoryScrollytelling();
  ScrollTrigger.refresh();
};
