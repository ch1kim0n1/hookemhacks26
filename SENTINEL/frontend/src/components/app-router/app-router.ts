import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";

type Route = "landing" | "dashboard" | "demo" | "attacker" | "bench" | "rwa";

@customElement("app-router")
export class AppRouter extends LitElement {
    override createRenderRoot() {
        return this;
    }

    @state() private route: Route = "landing";

    override connectedCallback() {
        super.connectedCallback();
        window.addEventListener("hashchange", this.onHash);
        this.onHash();
    }

    override disconnectedCallback() {
        super.disconnectedCallback();
        window.removeEventListener("hashchange", this.onHash);
    }

    private readonly onHash = () => {
        const hash = window.location.hash;
        let newRoute: Route = "landing";
        if (hash === "#/dashboard") newRoute = "dashboard";
        else if (hash === "#/demo") newRoute = "demo";
        else if (hash === "#/demo/rwa") newRoute = "rwa";
        else if (hash === "#/attacker") newRoute = "attacker";
        else if (hash === "#/bench") newRoute = "bench";
        if (newRoute !== this.route) {
            this.route = newRoute;
            window.scrollTo(0, 0);
        }
        document.body.classList.toggle("in-app", newRoute !== "landing");
    };

    override render() {
        if (this.route === "dashboard") {
            return html`<war-room></war-room>`;
        }
        if (this.route === "demo") {
            return html`<war-demo-room></war-demo-room>`;
        }
        if (this.route === "rwa") {
            return html`<rwa-demo-page></rwa-demo-page>`;
        }
        if (this.route === "attacker") {
            return html`<attacker-brief></attacker-brief>`;
        }
        if (this.route === "bench") {
            return html`<bench-page></bench-page>`;
        }
        return html`<landing-page></landing-page>`;
    }
}
