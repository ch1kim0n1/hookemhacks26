import { html, svg } from 'lit-html';
import { HOURLY } from './mock-data.js';
import { resolveHourly } from '../../lib/adapters.js';
import { store } from './state.js';

const buildPath = (points, w, h, pad) => {
  const max = Math.max(...points) * 1.15;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const step = innerW / (points.length - 1);
  const pts = points.map((v, i) => ({
    x: pad.l + i * step,
    y: pad.t + innerH - (v / max) * innerH,
  }));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const midX = (p0.x + p1.x) / 2;
    d += ` C ${midX} ${p0.y}, ${midX} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  const area = `${d} L ${pts[pts.length - 1].x} ${pad.t + innerH} L ${pts[0].x} ${pad.t + innerH} Z`;
  return { line: d, area, pts, innerH };
};

export const hourlyChart = () => {
  const w = 620;
  const h = 200;
  const pad = { t: 16, r: 10, b: 26, l: 10 };
  const { live } = store.getState();
  const points = (() => {
    const pts = resolveHourly(live);
    const max = Math.max(...pts);
    // If live data is all zeros, keep mock so the chart never looks flat-line
    // dead during the demo.
    return max === 0 ? HOURLY : pts;
  })();
  const { line, area, pts, innerH } = buildPath(points, w, h, pad);
  const gridLines = [0.25, 0.5, 0.75].map((p) => pad.t + innerH * p);
  const labels = [
    { x: pts[0].x, t: '00:00' },
    { x: pts[6].x, t: '06:00' },
    { x: pts[12].x, t: '12:00' },
    { x: pts[18].x, t: '18:00' },
    { x: pts[pts.length - 1].x, t: 'now' },
  ];
  return html`
    <div class="dash-chart-wrap">
      <svg
        viewBox="0 0 ${w} ${h}"
        preserveAspectRatio="none"
        role="img"
        aria-label="Hourly blocked attacks over the last 24 hours"
      >
        <defs>
          <linearGradient id="dash-chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(27,122,148,0.28)" />
            <stop offset="100%" stop-color="rgba(27,122,148,0)" />
          </linearGradient>
        </defs>
        ${gridLines.map(
          (y) => svg`
            <line
              x1="${pad.l}" x2="${w - pad.r}"
              y1="${y}" y2="${y}"
              stroke="var(--color-line)" stroke-dasharray="3 5" stroke-width="1"
            />
          `,
        )}
        <path d=${area} fill="url(#dash-chart-fill)" />
        <path
          d=${line}
          fill="none"
          stroke="var(--color-ocean-800)"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        ${pts.map(
          (p, i) => svg`
            <circle
              cx="${p.x}" cy="${p.y}"
              r="${i === pts.length - 1 ? 3 : 2}"
              fill="var(--color-ocean-800)"
              opacity="${i === pts.length - 1 ? 1 : 0}"
            />
          `,
        )}
        ${labels.map(
          (l) => svg`
            <text
              class="dash-chart-axis"
              x="${l.x}" y="${h - 8}" text-anchor="middle"
            >${l.t}</text>
          `,
        )}
      </svg>
    </div>
  `;
};
