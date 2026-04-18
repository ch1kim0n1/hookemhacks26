import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import "./rwa-demo-page.css";

/** Thin “second vertical” — same ZK + policy primitive, different narrative (Q&A / vision). */
@customElement("rwa-demo-page")
export class RwaDemoPage extends LitElement {
    override createRenderRoot() {
        return this;
    }

    override render() {
        return html`
      <div class="rwa-demo">
        <div class="rwa-demo__inner">
          <a class="rwa-demo__back" href="#/demo" @click=${(e: Event) => {
              e.preventDefault();
              window.location.hash = "#/demo";
          }}>← WAR DEMO ROOM</a>
          <h1 class="rwa-demo__title">RWA SETTLEMENT · SAME PRIMITIVE</h1>
          <p class="rwa-demo__p">
            The hackathon build targets DeFi mempool threats because the data is public and the dollars are easy to
            measure. The underlying product is <strong style="color:#e8e8e8">policy-bound autonomous agents</strong>:
            every consequential action requires a Groth16-ready policy proof — the same <code>PolicyRegistry</code> gate
            you saw in Moment&nbsp;2.
          </p>
          <p class="rwa-demo__p">
            Imagine an agent that releases warehouse attestation funds: the <em>inference</em> runs off-chain, but the
            <em>authorization to move money</em> is the only step the chain trusts — and that step is zk-verified
            against a committed model hash.
          </p>
          <span class="rwa-demo__stamp">VISION SLICE · NOT A SECOND LIVE PIPELINE</span>
        </div>
      </div>
    `;
    }
}
