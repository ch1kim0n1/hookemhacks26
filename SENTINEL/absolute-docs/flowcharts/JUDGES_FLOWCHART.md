# SENTINEL v2 — How It Works (Judges)

> **The blockchain that records not just what happened, but what *didn't* happen.**
>
> Autonomous DeFi defense, faster than any human, with cryptographic proof of prevented loss.

---

## 1. The 90-Second Demo — End-to-End Flow

This is exactly what you see on screen during the pitch. Every arrow is a real network hop, Redis message, or on-chain transaction.

```mermaid
flowchart TB
    classDef attacker fill:#3a1414,stroke:#ff5555,color:#ffdddd,stroke-width:2px
    classDef sentinel fill:#0f2744,stroke:#4a9eff,color:#dde8ff,stroke-width:2px
    classDef zk fill:#3d2f0a,stroke:#f5c542,color:#fff5d6,stroke-width:3px
    classDef chain fill:#1a1a1a,stroke:#888,color:#ddd,stroke-width:2px
    classDef win fill:#0f3a1e,stroke:#4ade80,color:#d6ffdb,stroke-width:2px
    classDef headline fill:#2a0f3a,stroke:#c084fc,color:#f5e6ff,stroke-width:3px

    %% ─── Attack ───
    A1["🦹 Attacker submits<br/><b>flash loan</b> tx<br/><i>t = 0 ms</i>"]:::attacker
    A2["🦹 Attacker submits<br/><b>oracle manipulation</b> tx<br/><i>t = 120 ms</i>"]:::attacker

    %% ─── Detection pipeline ───
    M["👁 <b>Mempool Monitor</b><br/>(ethers.js, TS)<br/>sees pending tx before it mines"]:::sentinel
    DE["🧠 <b>Detection Engine</b> (Python)<br/>pattern: FLASH_LOAN_ORACLE_MANIP<br/>confidence crosses 0.85<br/><i>t = 180 ms → CONFIRMED</i>"]:::sentinel
    DA["🤖 <b>Defense Agent</b> (Python)<br/>constructs <code>pause()</code> action<br/>evaluates against on-chain policy"]:::sentinel

    %% ─── ZK gate #1 ───
    Z1{{"🔐 <b>ZK POLICY PROOF</b><br/>PolicyCompliance circuit (RISC Zero)<br/>proves the action matches a rule<br/>that the policy contract authorizes"}}:::zk

    %% ─── On-chain defense ───
    PV["⛓ <b>PolicyVerifier.verify(proof)</b><br/>returns <code>true</code>"]:::chain
    PC["⛓ <b>PauseController.pause()</b><br/><i>t ≈ 2.9 s</i> — same block as the attack"]:::chain
    REV["💥 <b>Attacker's exploit tx REVERTS</b><br/>fails <code>sentinelProtected</code> modifier<br/><b>Funds never move.</b>"]:::win

    %% ─── Parallel: shadow timeline ───
    CF1["🪞 <b>Counterfactual Simulator</b><br/>forks Anvil at block N−1<br/>(spawn time ≈ 10 ms)"]:::sentinel
    CF2["🪞 <b>Shadow Timeline</b><br/>replays attacker's txs<br/>with defense REMOVED"]:::sentinel
    CF3["📐 <b>Compute δ</b><br/>δ = balance[shadow] − balance[real]<br/><b>δ = $2,400,000</b>"]:::sentinel

    %% ─── ZK gate #2 ───
    Z2{{"🔐 <b>ZK COUNTERFACTUAL PROOF</b><br/>CounterfactualCorrectness<br/>(BLS threshold attestation, RISC Zero)<br/>proves the shadow run was genuine"}}:::zk

    %% ─── Chain record ───
    L["🏛 <b>CounterfactualLedger.record(δ, proof)</b><br/>'What didn't happen' written on-chain<br/><i>t ≈ 3.8 s total</i>"]:::headline

    %% ─── Network effect ───
    SP["📡 <b>SignaturePublished</b> event"]:::sentinel
    IM["🌐 <b>12 protocols</b> subscribe to ThreatRegistry<br/>receive the signature → <b>immune</b><br/>without ever being attacked"]:::win

    %% ─── Flow ───
    A1 --> M
    A2 --> M
    M -->|"Redis pub/sub"| DE
    DE -->|"ThreatConfirmedEvent"| DA
    DA --> Z1
    Z1 -->|"proof valid"| PV
    PV --> PC
    PC --> REV

    DE -.->|"parallel branch"| CF1
    CF1 --> CF2
    CF2 --> CF3
    CF3 --> Z2
    Z2 --> L

    L --> SP
    SP --> IM
```

**Read this as two tracks:**
- **Left spine:** real chain — attack is stopped in-block.
- **Right spine (dashed entry):** a forked chain replays what *would* have happened. The δ is what the attacker would have taken.

Both tracks close with a **ZK proof** so the on-chain record is unforgeable. Total wall-clock: **~3.8 s** from first malicious tx to "what didn't happen" committed to the ledger.

---

## 2. The Math That Stops the AI — Agent Constraint Failure

We demonstrate this live by **deliberately trying to make the defense agent misbehave**. The point of this branch: the agent is *structurally* incapable of acting outside its mandate. It's not a check — it's a load-bearing wall.

```mermaid
flowchart LR
    classDef op fill:#3a1414,stroke:#ff5555,color:#ffdddd,stroke-width:2px
    classDef sentinel fill:#0f2744,stroke:#4a9eff,color:#dde8ff,stroke-width:2px
    classDef zk fill:#3d2f0a,stroke:#f5c542,color:#fff5d6,stroke-width:3px
    classDef chain fill:#1a1a1a,stroke:#888,color:#ddd,stroke-width:2px
    classDef block fill:#3a0f0f,stroke:#ff4444,color:#ffcccc,stroke-width:3px

    I["🕴 Operator injects malicious instruction<br/><code>drainFunds(to=attacker)</code>"]:::op
    AG["🤖 Defense Agent<br/>builds tx, evidence.pattern = OPERATOR_OVERRIDE<br/><b>does NOT short-circuit</b>"]:::sentinel
    ZP["🔐 ZK Prover<br/>PolicyCompliance circuit runs<br/><code>policy.rules.find(OPERATOR_OVERRIDE)</code><br/><b>→ no such rule → proof FAILS</b>"]:::zk
    SUB["🤖 Agent submits anyway<br/>with empty proof bytes<br/>(to prove the on-chain guard)"]:::sentinel
    REJ["⛓ PolicyVerifier.verify() → <code>false</code><br/>PolicyRegistry reverts<br/><code>INVALID_PROOF</code>"]:::chain
    STOP["🛑 <b>Math stopped it.</b><br/>Action cannot be proven → cannot land."]:::block

    I --> AG --> ZP --> SUB --> REJ --> STOP
```

> This is the only demo moment where **failing is winning**. A defense that reverts on a forged proof is the security property we ship.

---

## 3. System Architecture — The Six Layers

For judges who ask "what's actually running?" (doc 01).

```mermaid
flowchart TB
    classDef ui fill:#2a0f3a,stroke:#c084fc,color:#f5e6ff,stroke-width:2px
    classDef gw fill:#1a2a3a,stroke:#60a5fa,color:#dde8ff,stroke-width:2px
    classDef svc fill:#0f2744,stroke:#4a9eff,color:#dde8ff,stroke-width:2px
    classDef bus fill:#2a2a1a,stroke:#eab308,color:#fef9c3,stroke-width:2px
    classDef chain fill:#1a1a1a,stroke:#888,color:#ddd,stroke-width:2px

    UI["<b>Layer 4 + 5 — Frontend (React + D3)</b><br/>Trust Interface · Attack Graph · Dual Timeline<br/>Time-Scroll Audit · Immunity Map · Proof Viewer"]:::ui

    GW["<b>API Gateway</b> (Fastify + WebSocket)<br/>REST <code>/api/v1/*</code> · <code>ws://events</code>"]:::gw

    subgraph L1["Layer 1 — Detection and Response (less than 800 ms SLA)"]
        MM["mempool-monitor<br/>(TypeScript, ethers.js)"]:::svc
        DET["detection-engine<br/>(Python)"]:::svc
        DEF["defense-agent<br/>(Python)"]:::svc
    end

    subgraph L2["Layer 2 — Dual-Timeline Execution"]
        CFS["counterfactual-sim<br/>(Anvil fork driver)"]:::svc
    end

    subgraph L3["Layer 3 — ZK Recursive Learning"]
        RB["red/blue learning loop<br/>(viz-only for MVP)"]:::svc
    end

    ZK["<b>zk-prover</b> — RISC Zero<br/>PolicyCompliance · CounterfactualCorrectness"]:::svc

    BUS[("<b>Redis Event Bus</b><br/>pub/sub")]:::bus

    subgraph CHAIN["Layer 6 — On-Chain  (Foundry / Anvil · Base Sepolia)"]
        PR["PolicyRegistry"]:::chain
        CL["CounterfactualLedger"]:::chain
        PAC["PauseController"]:::chain
        SG["SentinelGuard"]:::chain
        VLP["VictimLendingPool"]:::chain
    end

    PG[("Postgres<br/>event store")]:::bus

    UI <--> GW
    GW --> BUS
    MM --> DET --> DEF
    DEF --> CFS
    DEF <--> ZK
    CFS <--> ZK
    DEF --> CHAIN
    CFS --> CHAIN
    MM --> BUS
    DET --> BUS
    DEF --> BUS
    CFS --> BUS
    ZK --> BUS
    RB --> BUS
    BUS --> PG
```

---

## 4. Why This Is Different From Any Bot

| A normal ethers.js defense bot | SENTINEL v2 |
|---|---|
| Watches events, calls `pause()` | **ZK-bounded agent** — architecturally incapable of unauthorized action |
| Logs that "an attack happened" | **Counterfactual proof** — quantifies prevented loss *on-chain* |
| Single-protocol reactive | **Dual-timeline simulation** — an alternate-history state root |
| Isolated to one deployment | **Compounding network immunity** via threat registry |

---

## 5. One-Sentence Pitch

> **"SENTINEL defends protocols autonomously faster than any human can — and cryptographically proves what would have happened without it."**
