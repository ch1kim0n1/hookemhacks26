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
// Modality ticker — cycles the "same pattern in …" line under the problem
// specimen. One example on screen at a time. Pauses when the section is
// offscreen so it's not burning cycles for a non-visible animation.
// -----------------------------------------------------------------------------
const setupModalityTicker = () => {
  const root = document.querySelector('[data-modality-ticker]');
  if (!root) return;
  const slides = Array.from(root.querySelectorAll('[data-modality-slide]'));
  const dots = Array.from(root.querySelectorAll('[data-modality-dot]'));
  if (slides.length === 0) return;
  if (reducedMotion()) {
    slides[0].style.opacity = '1';
    return;
  }

  let i = 0;
  let visible = true;
  const show = (idx) => {
    slides.forEach((el, k) => {
      el.style.opacity = k === idx ? '1' : '0';
      el.style.transform = `translateY(${k === idx ? 0 : 12}px)`;
    });
    dots.forEach((d, k) => {
      d.style.background = k === idx ? 'var(--color-accent)' : 'var(--color-line)';
    });
  };

  setInterval(() => {
    if (!visible) return;
    i = (i + 1) % slides.length;
    show(i);
  }, 2800);

  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => (visible = e.isIntersecting)),
    { threshold: 0.2 },
  );
  io.observe(root);
};

// -----------------------------------------------------------------------------
// Hero canvas backdrop — a microscope field of soft "white blood cells"
// drifting far behind the hero copy. No grid, no waves, no labels. Cells
// have an organic wobbling membrane and a faint nucleus so the biology
// metaphor reads. Alphas sit under 0.15 so the page type always wins.
// Pauses offscreen; draws one static frame on prefers-reduced-motion.
// -----------------------------------------------------------------------------
const setupHeroCanvas = () => {
  const canvas = document.querySelector('[data-hero-canvas]');
  if (!canvas) return;
  const section = canvas.closest('section');
  if (!section) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  // White blood cells distributed around the edges so the middle of the
  // hero (where the copy sits) is empty. Radii vary for natural scatter.
  const cells = [
    { cx: 0.06, cy: 0.22, r: 140, phase: 0.0, drift: 12 },
    { cx: 0.94, cy: 0.12, r: 88, phase: 1.7, drift: 9 },
    { cx: 0.72, cy: 0.90, r: 120, phase: 3.2, drift: 14 },
    { cx: 0.04, cy: 0.92, r: 74, phase: 4.5, drift: 8 },
    { cx: 0.86, cy: 0.62, r: 62, phase: 2.4, drift: 10 },
    { cx: 0.18, cy: 0.58, r: 48, phase: 5.1, drift: 7 },
  ];

  // Each cell has its own organic membrane — 22 points jittered with
  // layered sines so it breathes gently without drifting into noise.
  const membranePhases = cells.map((_, i) =>
    Array.from({ length: 22 }, (_, k) => (i * 1.1 + k * 0.37) % (Math.PI * 2)),
  );

  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0;
  let H = 0;
  let running = true;
  let visible = true;
  let startedAt = performance.now();

  const resize = () => {
    const rect = section.getBoundingClientRect();
    W = Math.max(1, Math.floor(rect.width));
    H = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  // One-pixel noise-ish perturbation derived from layered sines — cheap and
  // deterministic so the coastline shape is stable across frames.
  const wobble = (phase, t, k) =>
    Math.sin(phase + t * 0.00035 + k * 0.9) * 6 +
    Math.sin(phase * 1.7 + t * 0.00022) * 4 +
    Math.cos(phase * 0.6 + t * 0.0005) * 3;

  const drawCell = (cell, idx, t) => {
    const driftX = Math.sin(t * 0.00012 + cell.phase) * cell.drift;
    const driftY = Math.cos(t * 0.00009 + cell.phase * 1.3) * cell.drift * 0.6;
    const cx = cell.cx * W + driftX;
    const cy = cell.cy * H + driftY;
    const phases = membranePhases[idx];

    // Soft cytoplasm — diffuse radial, no hard edge. This is what gives the
    // cell its "white blood cell under microscope" quality.
    const halo = ctx.createRadialGradient(cx, cy, cell.r * 0.2, cx, cy, cell.r * 1.15);
    halo.addColorStop(0, 'rgba(250,244,232,0.32)');
    halo.addColorStop(0.6, 'rgba(250,244,232,0.18)');
    halo.addColorStop(1, 'rgba(250,244,232,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, cell.r * 1.15, 0, Math.PI * 2);
    ctx.fill();

    // Membrane polygon — 22 organic points.
    const pts = [];
    for (let k = 0; k < phases.length; k++) {
      const angle = (k / phases.length) * Math.PI * 2;
      const r = cell.r + wobble(phases[k], t, k);
      pts.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
    }

    ctx.strokeStyle = 'rgba(20,18,16,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let k = 1; k <= pts.length; k++) {
      const p0 = pts[k - 1];
      const p1 = pts[k % pts.length];
      const mx = (p0.x + p1.x) / 2;
      const my = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(p0.x, p0.y, mx, my);
    }
    ctx.closePath();
    ctx.stroke();

    // Nucleus — slightly offset so it looks natural, very faint.
    const nx = cx + Math.cos(cell.phase + t * 0.00015) * cell.r * 0.18;
    const ny = cy + Math.sin(cell.phase * 1.2 + t * 0.00012) * cell.r * 0.14;
    const nucleus = ctx.createRadialGradient(nx, ny, 0, nx, ny, cell.r * 0.42);
    nucleus.addColorStop(0, 'rgba(111,176,194,0.18)');
    nucleus.addColorStop(1, 'rgba(111,176,194,0)');
    ctx.fillStyle = nucleus;
    ctx.beginPath();
    ctx.arc(nx, ny, cell.r * 0.42, 0, Math.PI * 2);
    ctx.fill();
  };

  const render = (now) => {
    if (!running) return;
    if (visible) {
      const t = now - startedAt;
      ctx.clearRect(0, 0, W, H);
      cells.forEach((cell, i) => drawCell(cell, i, t));
    }
    requestAnimationFrame(render);
  };

  resize();
  window.addEventListener('resize', resize);

  if (reducedMotion()) {
    // Draw one static frame and stop.
    const t = 0;
    ctx.clearRect(0, 0, W, H);
    cells.forEach((cell, i) => drawCell(cell, i, t));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => (visible = e.isIntersecting)),
    { threshold: 0 },
  );
  io.observe(section);

  requestAnimationFrame(render);
};

// -----------------------------------------------------------------------------
// Hero email mockup — periodically flashes the hidden injection line so a
// scanning reader spots it. The line has real text so the flash reads as
// "look, this is the attack" rather than decoration. No-op when reduced
// motion is set; the line still shows its base highlight in that case.
// -----------------------------------------------------------------------------
const setupEmailInjectionFlash = () => {
  const line = document.querySelector('[data-email-injection]');
  if (!line) return;
  if (reducedMotion()) {
    line.classList.add('is-flash');
    return;
  }

  let visible = true;
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => (visible = e.isIntersecting)),
    { threshold: 0 },
  );
  io.observe(line);

  const cycle = () => {
    if (!visible) {
      setTimeout(cycle, 1400);
      return;
    }
    // Flash is short (~900ms visible) and rest is long (~2.6s invisible) so
    // the overall rhythm feels like you caught something out of the corner
    // of your eye that then disappears again.
    line.classList.add('is-flash');
    setTimeout(() => {
      line.classList.remove('is-flash');
      setTimeout(cycle, 2600);
    }, 900);
  };
  setTimeout(cycle, 1100);
};

// -----------------------------------------------------------------------------
// Network scrollytelling — decentralized peer mesh, four acts driven by
// scroll progress across the pinned outer wrapper.
//
// Acts:
//   0 attack    — user1 highlighted + turns hit, fakenews.net label on
//   1 detect    — user1 confirmed hit, fingerprint minted
//   2 gossip    — BFS wave of immune neighbors radiates outward
//   3 twin      — whole mesh immune, user2 blocked on cache hit
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
      // attack — user 1 highlighted, site label on, marked as hit
      u1?.classList.add('is-hit');
      setSite(siteUser1, true);
      setSite(siteUser2, false);
      return;
    }

    if (idx === 1) {
      // detect — user 1 confirmed hit, fingerprint minted (still isolated)
      u1?.classList.add('is-hit');
      setSite(siteUser1, true);
      setSite(siteUser2, false);
      return;
    }

    if (idx === 2) {
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

    if (idx === 3) {
      // twin — whole mesh already immune, user2 hits a near-identical
      // domain and is blocked on cache hit.
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
// "Why now" — a 4-act story that stages a $500k OpenClaw heist. Both columns
// swap exactly one panel per act with a fade: left shows the narrative card,
// right shows the corresponding visual stage.
// Acts: 0 parse · 1 reveal hidden HTML comment · 2 tool call · 3 drain.
// -----------------------------------------------------------------------------
const setupStoryScrollytelling = () => {
  const pin = document.querySelector('[data-story-pin]');
  if (!pin) return;
  const textPanels = Array.from(
    document.querySelectorAll('[data-story-panels] .scrolly-panel'),
  );
  const stagePanels = Array.from(
    document.querySelectorAll('[data-story-stage-panels] .scrolly-panel'),
  );
  if (textPanels.length === 0) return;
  const dots = Array.from(document.querySelectorAll('[data-story-dots] .act-dot'));

  const count = textPanels.length;
  pin.style.setProperty('--story-count', count);

  const applyAct = (idx) => {
    textPanels.forEach((p, i) => p.classList.toggle('is-active', i === idx));
    stagePanels.forEach((p, i) => p.classList.toggle('is-active', i === idx));
    dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
  };

  applyAct(0);

  ScrollTrigger.create({
    trigger: pin,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => {
      const idx = Math.min(count - 1, Math.floor(self.progress * count));
      if (pin.dataset.act !== String(idx)) {
        pin.dataset.act = String(idx);
        applyAct(idx);
      }
    },
  });
};

// -----------------------------------------------------------------------------
// Pipeline rail — a payload chip scrubs left-to-right as the reader scrolls
// past, lighting each stage (chain → rules → classifier → judge) when the
// chip arrives. No pin: scroll distance is whatever the section naturally
// occupies, so the page stays short.
// -----------------------------------------------------------------------------
const setupPipelineRail = () => {
  const pin = document.querySelector('[data-pipeline-pin]');
  const rail = document.querySelector('[data-pipeline-rail]');
  if (!rail || !pin) return;
  const payload = rail.querySelector('[data-rail-payload]');
  const progress = rail.querySelector('[data-rail-progress]');
  const verdict = rail.querySelector('[data-rail-verdict]');
  const stages = Array.from(rail.querySelectorAll('[data-rail-stage]'));
  if (!payload || !progress || stages.length === 0) return;

  const activate = (i) => {
    stages.forEach((stage, j) => {
      const chip = stage.querySelector('.rail-chip');
      const call = stage.querySelector('.rail-call');
      const check = stage.querySelector('.rail-check');
      const active = j <= i;
      stage.style.opacity = active ? '1' : '0.55';
      stage.style.background = active ? 'var(--color-paper-3)' : 'var(--color-paper)';
      if (chip) {
        chip.style.background = active ? 'var(--color-accent)' : 'var(--color-paper-3)';
        chip.style.color = active ? '#fff' : 'var(--color-muted)';
        chip.style.borderColor = active ? 'var(--color-accent)' : 'var(--color-line)';
      }
      if (call) {
        call.style.background = active ? 'var(--color-highlight)' : 'var(--color-bone)';
        call.style.borderColor = active ? 'var(--color-accent)' : 'var(--color-line)';
        call.style.color = active ? 'var(--color-ink)' : 'var(--color-ink-2)';
      }
      if (check) {
        check.style.opacity = active ? '1' : '0';
        check.style.transform = active ? 'scale(1)' : 'scale(0.4)';
      }
    });
    if (verdict) {
      if (i >= stages.length - 1) {
        verdict.textContent = '✓ BLOCKED';
        verdict.style.color = '#fff';
        verdict.style.borderColor = 'var(--color-accent)';
        verdict.style.background = 'var(--color-accent)';
        verdict.style.boxShadow = '0 0 0 4px rgba(217,90,43,0.2)';
      } else if (i >= 0) {
        verdict.textContent = `scanning · ${String(i + 1).padStart(2, '0')}/0${stages.length}`;
        verdict.style.color = 'var(--color-accent)';
        verdict.style.borderColor = 'var(--color-accent)';
        verdict.style.background = 'var(--color-paper)';
        verdict.style.boxShadow = 'none';
      } else {
        verdict.textContent = 'pending';
        verdict.style.color = 'var(--color-muted)';
        verdict.style.borderColor = 'var(--color-line)';
        verdict.style.background = 'var(--color-paper)';
        verdict.style.boxShadow = 'none';
      }
    }
  };

  if (reducedMotion()) {
    activate(stages.length - 1);
    progress.style.width = '100%';
    payload.style.transform = 'translate(calc(100vw - 300px), -50%)';
    return;
  }

  activate(-1);

  const compute = (self) => {
    const p = self.progress;
    const header = rail.querySelector('[data-rail-payload]')?.parentElement;
    const railW = header?.clientWidth || rail.clientWidth;
    // Payload rides the header. Leave room at both ends for the
    // "inspection rail ·" label on the left and the verdict pill on the right.
    const startX = 20;
    const verdictEl = rail.querySelector('[data-rail-verdict]');
    const verdictW = verdictEl ? verdictEl.offsetWidth : 120;
    const endX = railW - verdictW - 36 - payload.offsetWidth;
    const x = startX + Math.max(0, endX - startX) * p;
    // Glow intensifies as it travels — fingerprint being inspected.
    const glow = Math.round(20 * p);
    payload.style.transform = `translate(${x}px, -50%)`;
    payload.style.boxShadow = `4px 4px 0 var(--color-accent), 0 0 ${glow}px rgba(217,90,43,${0.2 + 0.5 * p})`;
    progress.style.width = `${p * 100}%`;
    const i = Math.min(stages.length - 1, Math.floor(p * stages.length + 0.0001));
    if (rail.dataset.stage !== String(i)) {
      rail.dataset.stage = String(i);
      activate(i);
    }
  };

  // Pin the whole intro-plus-rail block so the 3-column framing stays on
  // screen while the payload scrubs across the rail. `end: '+=1000'` consumes
  // 1000px of scroll while pinned; scrub smooths wheel input into the
  // animation so fast scrolls don't skip stages.
  ScrollTrigger.create({
    trigger: pin,
    pin: true,
    pinSpacing: true,
    start: 'top top+=80',
    end: '+=1000',
    scrub: 0.45,
    anticipatePin: 1,
    onUpdate: compute,
    onRefresh: compute,
  });
};

// -----------------------------------------------------------------------------
// Entry point.
// -----------------------------------------------------------------------------
export const initAnimations = () => {
  setupReveals();
  setupBars();
  setupProblemReveal();
  setupModalityTicker();
  setupHeroCanvas();
  setupEmailInjectionFlash();
  setupNetworkScrollytelling();
  setupStoryScrollytelling();
  setupPipelineRail();
  ScrollTrigger.refresh();
};
