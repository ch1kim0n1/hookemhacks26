import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { BENCH_ATTACKS, BENCH_TOTAL_USD_M } from "../../data/bench-attacks";
import "./bench-page.css";

@customElement("bench-page")
export class BenchPage extends LitElement {
    override createRenderRoot() {
        return this;
    }

    override render() {
        return html`
      <div class="bench-page">
        <div class="bench-page__head">
          <a class="bench-page__back" href="#/" @click=${(e: Event) => {
              e.preventDefault();
              window.location.hash = "#/";
          }}>← BACK</a>
          <h1 class="bench-page__title">HISTORICAL ATTACK REPLAY</h1>
          <p class="bench-page__lead">
            Eight real DeFi exploit kill-chains reconstructed from public post-mortems, fed through the same
            detection operator (seed 1337). Full methodology:
            <a href="https://github.com/ch1kim0n1/hookemhacks26/blob/main/services/detection-engine/bench/results/historical_attacks.md" target="_blank" rel="noopener" style="color:#c8ff00">historical_attacks.md</a>
          </p>
        </div>
        <div class="bench-page__stats">
          <div class="bench-stat">
            <div class="bench-stat__k">ATTACKS CAUGHT</div>
            <div class="bench-stat__v">8 / 8</div>
          </div>
          <div class="bench-stat">
            <div class="bench-stat__k">$ IN SCOPE</div>
            <div class="bench-stat__v">$${BENCH_TOTAL_USD_M.toFixed(1)}M</div>
          </div>
          <div class="bench-stat">
            <div class="bench-stat__k">P50 LATENCY</div>
            <div class="bench-stat__v">2.40 ms</div>
          </div>
          <div class="bench-stat">
            <div class="bench-stat__k">FALSE POSITIVES</div>
            <div class="bench-stat__v">0 / 500</div>
          </div>
        </div>
        <div class="bench-table-wrap">
          <table class="bench-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Attack</th>
                <th>Year</th>
                <th>Loss ($M)</th>
                <th>Caught</th>
                <th>Conf</th>
                <th>Latency</th>
              </tr>
            </thead>
            <tbody>
              ${BENCH_ATTACKS.map(
                  (r) => html`
                <tr>
                  <td>${r.n}</td>
                  <td>${r.name}</td>
                  <td>${r.year}</td>
                  <td>${r.lossUsdM.toFixed(2)}</td>
                  <td>${r.caught ? "✅" : "—"}</td>
                  <td>${r.confidencePct}%</td>
                  <td class="bench-lat">${r.latencyMs.toFixed(2)} ms</td>
                </tr>
              `,
              )}
            </tbody>
          </table>
        </div>
      </div>
    `;
    }
}
