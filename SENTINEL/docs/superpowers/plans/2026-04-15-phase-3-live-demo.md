# Phase 3: Live Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Scenario B (Agent Constraint Failure) end-to-end, deliver the `/demo` route and `<DemoOrchestrator>`, write the demo support scripts, and harden the system into 10 consecutive clean runs — per absolute-docs/09_hackathon_mvp_scope.md Hour 12-22 and absolute-docs/12_demo_playbook.md.

**Architecture:** Phase 3 sits on top of a working Phase 2 pipeline (mempool → detection → defense → counterfactual → prover → ledger, all real, verifiers stubbed to always-true). Phase 3 replaces the always-true `PolicyVerifier` with a *reject-empty, accept-non-empty* stub, completes the defense-agent's `OPERATOR_OVERRIDE` rejection path (including the on-chain revert), wires the rejection into new Trust Collapse cues, adds `<BattlefieldViz>`, `<ImmunityMap>`, and `<DemoOrchestrator>` to the frontend, and implements `scripts/reset.sh`, `scripts/seed-demo-state.sh`, `scripts/replay-scenario.sh`, and `scripts/pre-warm-proofs.sh`.

**Tech Stack:** Solidity 0.8.24 / Foundry; Python 3.11 (defense-agent, detection-engine); TypeScript / Node 20 (api-gateway, counterfactual-sim, mempool-monitor, zk-prover, frontend); React 18 + Vite + zustand + Framer Motion + D3 + viem; RISC Zero zkVM (dev mode).

---

## What Phase 2 Actually Delivered (HEAD `df1dbde`)

Reality, not the plan-that-should-have-been:

- **Contracts**: all core contracts, mocks, `FlashLoanAttacker` deployed via `scripts/bootstrap.sh` + `DeployLocal.s.sol`. Addresses in `config/addresses.local.json`. ✅
- **Verifier contracts**: `PolicyVerifier`, `LearningVerifier`, `CounterfactualVerifier` return `true` for any input (Phase-1 stubs). ✅
- **`mempool-monitor`, `detection-engine`, `defense-agent`, `zk-prover`, `api-gateway`**: all real. Defense-agent submits `verifyAndExecute(..., b"", ...)` with **empty proof**, which the stub `PolicyVerifier` accepts. ✅
- **`counterfactual-sim`**: **zero-delta stub**. Publishes `CounterfactualReadyEvent@1` with `deltaWei: "0"` and no `leaves[]`. The file itself at [services/counterfactual-sim/src/index.ts:1](services/counterfactual-sim/src/index.ts:1) explicitly says "Phase 3 Engineer 2 fills in". ❌
- **Ledger publisher**: nobody calls `CounterfactualLedger.record()`. `getEntryCount() == 0` after any scenario run. ❌
- **Frontend**: `App.tsx` is a single-page layout (no router). Only `<TrustInterface>` (4 phases) and `<EventFeed>` exist. No `<AttackIntelGraph>`, `<DualTimelineViewer>`, `<TimeScrollAudit>`, `<ProofViewer>`, `<LiveStatusBar>`, `<RecentDeltaSummary>`. No `src/pages/` dir. `SENTINEL_DEMO_SAFE` not referenced. ❌
- **Policy hash alignment**: `config/policy.json` has a real `FLASH_LOAN_ORACLE_MANIP` rule but [contracts/script/DeployLocal.s.sol:55](contracts/script/DeployLocal.s.sol:55) still initializes with `keccak256("sentinel-v2-phase1-policy")`. The on-chain `currentPolicyHash` does NOT match `sha256(policy.json)`. ❌

## Phase 2.5 — Prerequisites (Tasks P1–P5)

Five prerequisite tasks close those gaps before the Phase 3 tasks can run. Ordering is deliberate:

- **P1** (counterfactual-sim), **P2** (ledger publisher), **P3** (policy hash), **P5** (frontend base) are independent of each other — can run in parallel.
- **P4a** (ProverClient) precedes **P4b** (defense-agent happy-path real proof).
- **P4b** must land before **Task A**. If Task A's `PolicyVerifier.verify(empty) == false` ships before P4b, Scenario A's happy path reverts — defense-agent still submits `b""`.
- **P2** and the ledger-dependent Tasks E2 / L1 depend on P1 for real `leaves[]` + non-zero delta.

Execute P1 → P5 top-to-bottom (or in parallel where the ordering allows) before starting Task A.

---

## Scope Check

Phase 3 + Phase 2.5 touch seven subsystems (contracts, counterfactual-sim, zk-prover, defense-agent, api-gateway, frontend, demo scripts). They could be sub-projects, but they are tightly coupled through the Scenario A/B flows and the demo choreography — splitting them would fragment a single coherent deliverable (the 90-second demo). Keep as one plan, execute in the task order below (P1 → L3) so dependencies line up.

---

## File Structure

### Contracts
- **Modify**: `contracts/script/DeployLocal.s.sol` — read policy hash from env (P3).
- **Modify**: `contracts/src/verifiers/PolicyVerifier.sol` — reject empty proof bytes (A).
- **Modify**: `contracts/test/unit/Core.t.sol` — cover empty-proof rejection (A).
- **Modify**: `contracts/test/integration/FlashLoanDefense.t.sol` — update the one test that currently passes `hex""`; add a Scenario B revert test (A).

### Configs
- **Create**: `config/protocol-profiles/victim-lending-pool.json` — tracked addresses + tokens for counterfactual delta (P1).
- **Modify**: `config/timings.json` — scene durations per doc 12 (C1).
- **Create**: `config/demo-scenarios/flash-loan-oracle.json` — DemoOrchestrator step list for Scenario A (C2).
- **Create**: `config/demo-scenarios/agent-constraint.json` — Scenario B step list (C2).
- **Create**: `config/battlefield-prerecorded.json` — ~60 generations of Red/Blue ticks (C3).
- **Create**: `config/immunity-propagation.json` — 12-protocol mesh + per-hop delays (C3).

### Counterfactual Sim (P1)
- **Create**: `services/counterfactual-sim/src/fork.ts` — spawn/dispose isolated Anvil fork.
- **Create**: `services/counterfactual-sim/src/shadow.ts` — `anvil_impersonateAccount` + replay attacker tx.
- **Create**: `services/counterfactual-sim/src/delta.ts` — query tracked balances, compute per-address delta.
- **Create**: `services/counterfactual-sim/src/merkle.ts` — keccak-pair Merkle root + leaves.
- **Modify**: `services/counterfactual-sim/src/index.ts` — orchestrate fork → replay → delta → publish.
- **Create**: `services/counterfactual-sim/src/sim.test.ts` — integration test.

### Ledger Publisher (P2)
- **Create**: `services/zk-prover/src/ledger_publisher.ts` — subscribe to `sentinel.counterfactual.ready`, call `CounterfactualLedger.record()`, publish `sentinel.ledger.recorded`.
- **Modify**: `services/zk-prover/src/index.ts` — start the publisher alongside the Fastify app.
- **Create**: `services/zk-prover/src/ledger_publisher.test.ts`.

### Defense Agent
- **Create**: `services/defense-agent/src/defense_agent/prover_client.py` — HTTP client for zk-prover with 422 handling (P4a).
- **Modify**: `services/defense-agent/src/defense_agent/__main__.py` — happy-path fetches real proof; unknown pattern routes into constraint-failure flow (P4b + D).
- **Create**: `services/defense-agent/src/defense_agent/constraint_failure.py` — Scenario B flow (D).
- **Create**: `services/defense-agent/tests/test_prover_client.py` (P4a).
- **Create**: `services/defense-agent/tests/test_happy_path.py` (P4b).
- **Create**: `services/defense-agent/tests/test_constraint_failure.py` (D).

### API Gateway
- **Create**: `services/api-gateway/src/cues.ts` — extract `deriveTrustCues` from `index.ts`, add REJECTED cue states (E1).
- **Modify**: `services/api-gateway/src/index.ts` — subscribe to `sentinel.defense.rejected`, use extracted `cues.ts`, mount REST routes.
- **Create**: `services/api-gateway/src/routes/ledger.ts` — `GET /api/v1/ledger`, `GET /api/v1/ledger/:eventId/counterfactual-tree` (E2).
- **Create**: `services/api-gateway/src/routes/policy.ts` — `GET /api/v1/policy/current` (E2).
- **Create**: `services/api-gateway/src/routes/events.ts` — `GET /api/v1/events/:eventId` (E2).
- **Create**: `services/api-gateway/src/cues.test.ts`.

### Frontend
- **Create**: `frontend/src/pages/MissionControl.tsx` — `/` landing page (P5a).
- **Create**: `frontend/src/pages/EventDetail.tsx` — `/event/:id` page (P5a).
- **Create**: `frontend/src/lib/api.ts` — REST client wrapping `/api/v1/*` (P5a).
- **Create**: `frontend/src/components/AttackIntelGraph.tsx` — D3 force-directed attack graph (P5b).
- **Create**: `frontend/src/components/DualTimelineViewer.tsx` — WITH/WITHOUT split screen (P5c).
- **Modify**: `frontend/src/store.ts` — add ledger state + demo orchestrator state + REJECTED trust phase (P5a, F).
- **Modify**: `frontend/src/components/TrustInterface.tsx` — render REJECTED phase (F).
- **Create**: `frontend/src/components/BattlefieldViz.tsx` (G).
- **Create**: `frontend/src/components/ImmunityMap.tsx` (H).
- **Create**: `frontend/src/components/DemoOrchestrator.tsx` (I).
- **Create**: `frontend/src/pages/DemoMode.tsx` — `/demo` route (I).
- **Create**: `frontend/src/lib/demo.ts` — scenario loader + `SENTINEL_DEMO_SAFE` helpers (I).
- **Modify**: `frontend/src/App.tsx` — router with `/`, `/event/:id`, `/demo` (P5a, I).

### Scripts
- **Create**: `scripts/compute-policy-hash.sh` — canonical sha256 of `policy.json` (P3).
- **Modify**: `scripts/bootstrap.sh` — pass `POLICY_HASH` env to DeployLocal (P3).
- **Modify**: `scripts/reset.sh` — implement (J1).
- **Modify**: `scripts/seed-demo-state.sh` — implement (J2).
- **Modify**: `scripts/replay-scenario.sh` — implement (J3).
- **Create**: `scripts/pre-warm-proofs.sh` — fill zk-prover cache (J4).
- **Create**: `scripts/inject-instruction.sh` — Scenario B wrapper (J3).
- **Create**: `scripts/test-scenario-a.sh`, `scripts/test-scenario-b.sh`, `scripts/demo-smoke-test.sh` (L1, L2, L3).

---

## Task P1: Counterfactual-sim real Anvil fork

**Files:**
- Create: `services/counterfactual-sim/src/fork.ts`
- Create: `services/counterfactual-sim/src/shadow.ts`
- Create: `services/counterfactual-sim/src/delta.ts`
- Create: `services/counterfactual-sim/src/merkle.ts`
- Create: `config/protocol-profiles/victim-lending-pool.json`
- Modify: `services/counterfactual-sim/src/index.ts`
- Create: `services/counterfactual-sim/src/sim.test.ts`

- [ ] **Step 1: Create the protocol profile**

Write `config/protocol-profiles/victim-lending-pool.json`:

```json
{
  "protocolName": "VictimLendingPool",
  "addressKey": "VictimLendingPool",
  "trackedAddresses": [
    { "addressKey": "VictimLendingPool", "label": "victim.wethReserve",     "tokenKey": "WETH" },
    { "addressKey": "VictimLendingPool", "label": "victim.usdcCollateral",  "tokenKey": "USDC" },
    { "addressKey": "FlashLoanAttacker","label": "attacker.wethBalance",   "tokenKey": "WETH" },
    { "addressKey": "OraclePair",       "label": "oracle.wethReserve",     "tokenKey": "WETH" },
    { "addressKey": "OraclePair",       "label": "oracle.usdcReserve",     "tokenKey": "USDC" }
  ],
  "attackerReplay": {
    "attackerAddressKey": "FlashLoanAttacker",
    "callerKey": "FlashLoanAttackerOwner",
    "method": "attack(address,uint256)",
    "argTypes": ["address", "uint256"],
    "args": [ { "fromKey": "FlashLoanProvider" }, { "literalHex": "0x30c70a09cf6f2d50000" } ]
  }
}
```

(`0x30c70a09cf6f2d50000` = 900 × 10¹⁸ WETH.)

- [ ] **Step 2: Create `services/counterfactual-sim/src/fork.ts`**

```typescript
import { spawn } from "node:child_process";
import { createServer } from "node:net";

export async function getFreePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const srv = createServer();
        srv.listen(0, () => {
            const addr = srv.address();
            srv.close(() => {
                if (typeof addr === "object" && addr && "port" in addr) {
                    resolve(addr.port);
                } else {
                    reject(new Error("no port"));
                }
            });
        });
    });
}

export interface ForkOptions {
    forkUrl: string;
    forkBlock: number;
    timeoutMs?: number;
}

export interface AnvilFork {
    port: number;
    rpcUrl: string;
    dispose: () => Promise<void>;
}

export async function spawnFork(opts: ForkOptions): Promise<AnvilFork> {
    const port = await getFreePort();
    const proc = spawn(
        "anvil",
        [
            "--fork-url", opts.forkUrl,
            "--fork-block-number", String(opts.forkBlock),
            "--port", String(port),
            "--hardfork", "cancun",
            "--silent",
        ],
        { stdio: ["ignore", "pipe", "pipe"] }
    );

    const rpcUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + (opts.timeoutMs ?? 20000);
    while (Date.now() < deadline) {
        try {
            const r = await fetch(rpcUrl, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "eth_blockNumber",
                    params: [],
                }),
            });
            if (r.ok) {
                return {
                    port,
                    rpcUrl,
                    dispose: async () => {
                        proc.kill("SIGTERM");
                        await new Promise<void>((resolve) => {
                            const t = setTimeout(() => {
                                proc.kill("SIGKILL");
                                resolve();
                            }, 2000);
                            proc.on("exit", () => {
                                clearTimeout(t);
                                resolve();
                            });
                        });
                    },
                };
            }
        } catch {
            /* still starting */
        }
        await new Promise((r) => setTimeout(r, 150));
    }
    proc.kill("SIGTERM");
    throw new Error(`fork on :${port} did not come up in ${opts.timeoutMs}ms`);
}
```

- [ ] **Step 3: Create `services/counterfactual-sim/src/shadow.ts`**

```typescript
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseAbi } from "viem";

/**
 * Replay the canonical attacker transaction on the fork. Uses
 * anvil_impersonateAccount so no signature from the caller is needed —
 * the fork treats it as if the attacker signed.
 *
 * Returns the fork-local tx hash. On revert, throws (which would mean
 * the fork state drifted from main; caller should retry or abort).
 */
export async function replayAttack(params: {
    forkRpc: string;
    callerAddress: `0x${string}`;
    attackerContract: `0x${string}`;
    method: string;          // e.g. "attack(address,uint256)"
    argTypes: string[];
    args: unknown[];
}): Promise<`0x${string}`> {
    const pub = createPublicClient({ transport: http(params.forkRpc) });

    // Impersonate the attacker's owner key.
    await fetch(params.forkRpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "anvil_impersonateAccount",
            params: [params.callerAddress],
        }),
    });

    // Top up the impersonated account so it can pay gas on the fork.
    await fetch(params.forkRpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "anvil_setBalance",
            params: [params.callerAddress, "0x56BC75E2D63100000"], // 100 ETH
        }),
    });

    const abi = parseAbi([`function ${params.method}`]);
    const funcName = params.method.slice(0, params.method.indexOf("("));
    const data = encodeFunctionData({
        abi,
        functionName: funcName,
        args: params.args as readonly unknown[],
    });

    // Send via anvil_sendTransaction semantics (impersonated).
    const sendResp = await fetch(params.forkRpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "eth_sendTransaction",
            params: [
                {
                    from: params.callerAddress,
                    to: params.attackerContract,
                    data,
                    gas: "0x2DC6C0", // 3M
                },
            ],
        }),
    });
    const sent = (await sendResp.json()) as { result?: string; error?: { message: string } };
    if (!sent.result) throw new Error(`shadow replay send failed: ${sent.error?.message}`);
    const txHash = sent.result as `0x${string}`;

    // Wait for it to be mined on the fork.
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash, timeout: 15_000 });
    if (receipt.status !== "success") {
        throw new Error(`shadow replay reverted: ${txHash}`);
    }
    return txHash;
}
```

- [ ] **Step 4: Create `services/counterfactual-sim/src/delta.ts`**

```typescript
import { createPublicClient, http, parseAbi } from "viem";

const ERC20_ABI = parseAbi([
    "function balanceOf(address) view returns (uint256)",
]);

export interface TrackedAddress {
    address: `0x${string}`;
    label: string;
    token: `0x${string}`;
}

export interface Balance {
    address: `0x${string}`;
    label: string;
    balanceWei: bigint;
}

export async function queryBalances(
    rpcUrl: string,
    tracked: TrackedAddress[]
): Promise<Balance[]> {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const out: Balance[] = [];
    for (const t of tracked) {
        const bal = (await client.readContract({
            address: t.token,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [t.address],
        })) as bigint;
        out.push({ address: t.address, label: t.label, balanceWei: bal });
    }
    return out;
}

export interface DeltaLeaf {
    address: `0x${string}`;
    label: string;
    realWei: string;   // JSON-safe (bigint → string)
    shadowWei: string;
    deltaWei: string;  // shadow - real (positive = attacker-gained, victim-lost)
}

export function diff(real: Balance[], shadow: Balance[]): {
    leaves: DeltaLeaf[];
    totalDeltaWei: bigint;
} {
    const byLabel = new Map(real.map((b) => [b.label, b]));
    const leaves: DeltaLeaf[] = [];
    let total = 0n;
    for (const s of shadow) {
        const r = byLabel.get(s.label);
        if (!r) continue;
        const delta = s.balanceWei - r.balanceWei;
        leaves.push({
            address: s.address,
            label: s.label,
            realWei: r.balanceWei.toString(),
            shadowWei: s.balanceWei.toString(),
            deltaWei: delta.toString(),
        });
        // Aggregate by direction: attacker gains + victim losses, both
        // add to "prevented loss". For MVP, sum absolute-value of changes
        // on the victim pool address only.
        if (s.label.startsWith("victim.")) {
            // A negative victim delta = pool drained in shadow.
            total += r.balanceWei - s.balanceWei;
        }
    }
    return { leaves, totalDeltaWei: total };
}
```

- [ ] **Step 5: Create `services/counterfactual-sim/src/merkle.ts`**

```typescript
import { keccak256, encodePacked } from "viem";
import type { DeltaLeaf } from "./delta.js";

/** keccak256 pair-hash (sorted) Merkle root. */
export function computeRoot(leaves: DeltaLeaf[]): `0x${string}` {
    if (leaves.length === 0) {
        return ("0x" + "00".repeat(32)) as `0x${string}`;
    }
    let layer: `0x${string}`[] = leaves.map((l) =>
        keccak256(
            encodePacked(
                ["address", "string", "int256"],
                [l.address, l.label, BigInt(l.deltaWei)]
            )
        )
    );
    while (layer.length > 1) {
        const next: `0x${string}`[] = [];
        for (let i = 0; i < layer.length; i += 2) {
            const a = layer[i];
            const b = i + 1 < layer.length ? layer[i + 1] : layer[i];
            const [lo, hi] = a < b ? [a, b] : [b, a];
            next.push(
                keccak256(encodePacked(["bytes32", "bytes32"], [lo, hi]))
            );
        }
        layer = next;
    }
    return layer[0];
}
```

- [ ] **Step 6: Rewrite `services/counterfactual-sim/src/index.ts`**

Replace the entire file:

```typescript
import Redis from "ioredis";
import pino from "pino";
import { readFileSync } from "node:fs";
import { createPublicClient, http } from "viem";

import { spawnFork } from "./fork.js";
import { replayAttack } from "./shadow.js";
import { queryBalances, diff } from "./delta.js";
import { computeRoot } from "./merkle.js";

const log = pino({
    level: process.env.LOG_LEVEL ?? "info",
    transport: { target: "pino-pretty", options: { colorize: true } },
});

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const ADDRESSES_FILE = process.env.ADDRESSES_FILE ?? "../../config/addresses.local.json";
const PROFILE_FILE = process.env.PROFILE_FILE ?? "../../config/protocol-profiles/victim-lending-pool.json";

// FlashLoanAttacker.owner = ATTACKER in the integration test; in the
// seeded live demo we use Anvil account #5 (see services/api-gateway).
const ATTACKER_OWNER: `0x${string}` =
    (process.env.ATTACKER_OWNER as `0x${string}` | undefined) ??
    "0x976EA74026E726554dB657fA54763abd0C3a0aa9";

interface Addresses { [k: string]: `0x${string}` }

interface ProfileEntry { addressKey: string; label: string; tokenKey: string }
interface ProfileArg { fromKey?: string; literalHex?: string }
interface Profile {
    protocolName: string;
    addressKey: string;
    trackedAddresses: ProfileEntry[];
    attackerReplay: {
        attackerAddressKey: string;
        callerKey: string;
        method: string;
        argTypes: string[];
        args: ProfileArg[];
    };
}

async function onThreatConfirmed(
    addresses: Addresses,
    profile: Profile,
    publisher: Redis,
    event: { eventId: string }
): Promise<void> {
    const main = createPublicClient({ transport: http(RPC_URL) });
    const currentBlock = await main.getBlockNumber();
    const forkBlock = Number(currentBlock - 1n);
    log.info({ eventId: event.eventId, forkBlock }, "spawning shadow fork");

    const fork = await spawnFork({
        forkUrl: RPC_URL,
        forkBlock,
        timeoutMs: 20000,
    });

    try {
        // 1. Replay the attacker call on the fork.
        const attackerContract = addresses[profile.attackerReplay.attackerAddressKey];
        const args = profile.attackerReplay.args.map((a) => {
            if (a.fromKey) return addresses[a.fromKey];
            if (a.literalHex) return BigInt(a.literalHex);
            throw new Error("unknown arg shape");
        });
        const callerAddress =
            (profile.attackerReplay.callerKey === "FlashLoanAttackerOwner"
                ? ATTACKER_OWNER
                : (addresses[profile.attackerReplay.callerKey] as `0x${string}`));

        await replayAttack({
            forkRpc: fork.rpcUrl,
            callerAddress,
            attackerContract,
            method: profile.attackerReplay.method,
            argTypes: profile.attackerReplay.argTypes,
            args,
        });

        // 2. Query tracked balances on BOTH chains.
        const tracked = profile.trackedAddresses.map((t) => ({
            address: addresses[t.addressKey],
            label: t.label,
            token: addresses[t.tokenKey],
        }));
        const [real, shadow] = await Promise.all([
            queryBalances(RPC_URL, tracked),
            queryBalances(fork.rpcUrl, tracked),
        ]);

        // 3. Compute delta + merkle root.
        const { leaves, totalDeltaWei } = diff(real, shadow);
        const root = computeRoot(leaves);

        // 4. Publish.
        const payload = {
            schema: "CounterfactualReadyEvent@1",
            emittedAt: new Date().toISOString(),
            eventId: event.eventId,
            deltaWei: totalDeltaWei.toString(),
            counterfactualRoot: root,
            leaves,
            forkBlock,
        };
        await publisher.publish(
            "sentinel.counterfactual.ready",
            JSON.stringify(payload)
        );
        log.info(
            { eventId: event.eventId, deltaWei: payload.deltaWei, root },
            "published counterfactual"
        );
    } finally {
        await fork.dispose();
    }
}

async function main() {
    const addresses: Addresses = JSON.parse(readFileSync(ADDRESSES_FILE, "utf-8"));
    const profile: Profile = JSON.parse(readFileSync(PROFILE_FILE, "utf-8"));

    const publisher = new Redis(REDIS_URL);
    const subscriber = new Redis(REDIS_URL);
    await subscriber.subscribe("sentinel.detection.confirmed");

    subscriber.on("message", async (_channel, raw) => {
        try {
            const event = JSON.parse(raw);
            if (!event.eventId) return;
            await onThreatConfirmed(addresses, profile, publisher, event);
        } catch (err) {
            log.error({ err }, "counterfactual-sim handler failed");
            try {
                await publisher.publish(
                    "sentinel.alerts",
                    JSON.stringify({
                        schema: "AlertEvent@1",
                        severity: "error",
                        message: `counterfactual-sim: ${String(err)}`,
                    })
                );
            } catch { /* best-effort */ }
        }
    });

    log.info("counterfactual-sim (real fork) listening");

    const shutdown = async () => {
        await subscriber.quit();
        await publisher.quit();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((err) => {
    log.error({ err }, "fatal");
    process.exit(1);
});
```

- [ ] **Step 7: Create `services/counterfactual-sim/src/sim.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { computeRoot } from "./merkle.js";
import { diff } from "./delta.js";

describe("merkle.computeRoot", () => {
    it("returns a deterministic 32-byte root for a fixed leaf set", () => {
        const leaves = [
            { address: "0x00000000000000000000000000000000000000aa" as `0x${string}`, label: "a", realWei: "100", shadowWei: "50", deltaWei: "-50" },
            { address: "0x00000000000000000000000000000000000000bb" as `0x${string}`, label: "b", realWei: "0", shadowWei: "200", deltaWei: "200" },
        ];
        const r = computeRoot(leaves);
        expect(r).toMatch(/^0x[0-9a-f]{64}$/);
        expect(computeRoot(leaves)).toBe(r); // stable
    });
});

describe("delta.diff", () => {
    it("sums victim-prefixed losses into totalDeltaWei", () => {
        const real = [
            { address: "0x1" as `0x${string}`, label: "victim.wethReserve", balanceWei: 1_000n },
            { address: "0x2" as `0x${string}`, label: "attacker.wethBalance", balanceWei: 0n },
        ];
        const shadow = [
            { address: "0x1" as `0x${string}`, label: "victim.wethReserve", balanceWei: 600n },
            { address: "0x2" as `0x${string}`, label: "attacker.wethBalance", balanceWei: 400n },
        ];
        const { leaves, totalDeltaWei } = diff(real, shadow);
        expect(totalDeltaWei).toBe(400n); // 1000 - 600 victim loss
        expect(leaves).toHaveLength(2);
    });
});
```

- [ ] **Step 8: Run the unit tests**

Run: `cd services/counterfactual-sim && pnpm vitest run`
Expected: all PASS.

- [ ] **Step 9: End-to-end smoke against live anvil**

Ensure Phase 2 stack is running (`./scripts/bootstrap.sh`, services up). In a new shell:

```bash
cd services/counterfactual-sim && pnpm dev &
sleep 1
redis-cli PUBLISH sentinel.detection.confirmed '{"eventId":"0xabc","pattern":"FLASH_LOAN_ORACLE_MANIP","victimProtocol":"'$(jq -r .VictimLendingPool ../../config/addresses.local.json)'"}'
redis-cli SUBSCRIBE sentinel.counterfactual.ready
```
Expected: a message appears on `sentinel.counterfactual.ready` with `deltaWei != "0"` and a `leaves` array.

- [ ] **Step 10: Commit**

```bash
git add services/counterfactual-sim/src/ config/protocol-profiles/
git commit -m "Phase 2.5 P1: real Anvil-fork counterfactual sim (delta + leaves + merkle)"
```

---

## Task P2: Ledger publisher (zk-prover → `CounterfactualLedger.record`)

**Files:**
- Create: `services/zk-prover/src/ledger_publisher.ts`
- Modify: `services/zk-prover/src/index.ts`
- Create: `services/zk-prover/src/ledger_publisher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/zk-prover/src/ledger_publisher.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildEntry } from "./ledger_publisher.js";

describe("buildEntry", () => {
    it("populates Entry tuple + publicInputs from a CounterfactualReadyEvent", () => {
        const event = {
            eventId: "0x" + "ab".repeat(32),
            deltaWei: "12345",
            counterfactualRoot: "0x" + "cd".repeat(32),
            forkBlock: 42,
        };
        const { entry, publicInputs, proof } = buildEntry(event, {
            realTxHash: "0x" + "ee".repeat(32),
            policyHash: "0x" + "ff".repeat(32),
            proofDigest: "0x" + "dd".repeat(32),
        });
        expect(entry.eventId).toBe(event.eventId);
        expect(entry.deltaWei).toBe(12345n);
        expect(entry.counterfactualRoot).toBe(event.counterfactualRoot);
        expect(entry.atBlock).toBe(42n);
        expect(publicInputs).toHaveLength(4);
        expect(publicInputs[0]).toBe(event.eventId);
        expect(publicInputs[1]).toBe(event.counterfactualRoot);
        expect(proof.length).toBeGreaterThan(0); // non-empty for Phase-3 PolicyVerifier, but this goes to CounterfactualVerifier which accepts anything; stay non-empty for safety.
    });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `cd services/zk-prover && pnpm vitest run ledger_publisher`
Expected: module not found.

- [ ] **Step 3: Create `services/zk-prover/src/ledger_publisher.ts`**

```typescript
import Redis from "ioredis";
import pino from "pino";
import {
    createPublicClient,
    createWalletClient,
    http,
    parseAbi,
    encodeAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256 } from "viem";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

const LEDGER_ABI = parseAbi([
    "function record((bytes32 eventId,uint256 atBlock,int256 deltaWei,bytes32 realTxHash,bytes32 counterfactualRoot,bytes32 proofDigest,uint256 recordedAt), bytes, bytes32[])",
]);

export interface CounterfactualReadyEvent {
    eventId: `0x${string}`;
    deltaWei: string;
    counterfactualRoot: `0x${string}`;
    forkBlock: number;
}

export interface EntryExtras {
    realTxHash: `0x${string}`;
    policyHash: `0x${string}`;
    proofDigest: `0x${string}`;
}

export function buildEntry(
    event: CounterfactualReadyEvent,
    extras: EntryExtras
): {
    entry: {
        eventId: `0x${string}`;
        atBlock: bigint;
        deltaWei: bigint;
        realTxHash: `0x${string}`;
        counterfactualRoot: `0x${string}`;
        proofDigest: `0x${string}`;
        recordedAt: bigint;
    };
    publicInputs: `0x${string}`[];
    proof: `0x${string}`;
} {
    const delta = BigInt(event.deltaWei);
    const entry = {
        eventId: event.eventId,
        atBlock: BigInt(event.forkBlock),
        deltaWei: delta,
        realTxHash: extras.realTxHash,
        counterfactualRoot: event.counterfactualRoot,
        proofDigest: extras.proofDigest,
        recordedAt: 0n, // overridden on-chain
    };
    // CounterfactualLedger.record public inputs per doc 04:
    //   [eventId, counterfactualRoot, deltaWei-as-bytes32, policyHash]
    const deltaBytes32 = ("0x" + (delta < 0n
        ? ((1n << 256n) + delta).toString(16)
        : delta.toString(16)
    ).padStart(64, "0")) as `0x${string}`;
    const publicInputs: `0x${string}`[] = [
        event.eventId,
        event.counterfactualRoot,
        deltaBytes32,
        extras.policyHash,
    ];
    // Attested-counterfactual placeholder per doc 04 §Approach B.
    // Non-empty so CounterfactualVerifier (stub) accepts; the real
    // Groth16-compressed attestation replaces this post-MVP.
    const proof = ("0x" + "cafe".repeat(64)) as `0x${string}`;
    return { entry, publicInputs, proof };
}

export async function startLedgerPublisher(cfg: {
    redisUrl: string;
    rpcUrl: string;
    addressesFile: string;
    proverKey: `0x${string}`;
}): Promise<void> {
    const { readFileSync } = await import("node:fs");
    const addresses = JSON.parse(readFileSync(cfg.addressesFile, "utf-8")) as Record<string, `0x${string}`>;

    const subscriber = new Redis(cfg.redisUrl);
    const publisher = new Redis(cfg.redisUrl);
    await subscriber.subscribe("sentinel.counterfactual.ready");
    await subscriber.subscribe("sentinel.defense.mined");

    // Track the most recent defense tx hash per eventId so the ledger
    // entry can reference it as `realTxHash`.
    const realTxByEvent = new Map<string, `0x${string}`>();

    const account = privateKeyToAccount(cfg.proverKey);
    const pub = createPublicClient({ transport: http(cfg.rpcUrl) });
    const wallet = createWalletClient({ account, transport: http(cfg.rpcUrl) });

    // Read currentPolicyHash once at startup — it rarely changes, and we
    // re-read on publish failure if needed.
    let policyHash = (await pub.readContract({
        address: addresses.PolicyRegistry,
        abi: parseAbi(["function currentPolicyHash() view returns (bytes32)"]),
        functionName: "currentPolicyHash",
    })) as `0x${string}`;

    subscriber.on("message", async (channel, raw) => {
        try {
            const msg = JSON.parse(raw);
            if (channel === "sentinel.defense.mined") {
                if (msg.eventId && msg.txHash) {
                    realTxByEvent.set(msg.eventId, msg.txHash);
                }
                return;
            }
            if (channel !== "sentinel.counterfactual.ready") return;
            if (!msg.eventId) return;

            const realTx =
                realTxByEvent.get(msg.eventId) ??
                ("0x" + "00".repeat(32)) as `0x${string}`;
            const proofDigest = keccak256(
                encodeAbiParameters(
                    [{ type: "bytes32" }, { type: "bytes32" }],
                    [msg.eventId, msg.counterfactualRoot]
                )
            );
            const { entry, publicInputs, proof } = buildEntry(msg, {
                realTxHash: realTx,
                policyHash,
                proofDigest,
            });

            const hash = await wallet.writeContract({
                address: addresses.CounterfactualLedger,
                abi: LEDGER_ABI,
                functionName: "record",
                args: [entry, proof, publicInputs],
                chain: null,
            });
            await publisher.publish(
                "sentinel.prover.started",
                JSON.stringify({
                    schema: "ProofStartedEvent@1",
                    eventId: msg.eventId,
                    circuit: "counterfactual-correctness",
                })
            );
            const receipt = await pub.waitForTransactionReceipt({ hash });
            await publisher.publish(
                "sentinel.ledger.recorded",
                JSON.stringify({
                    schema: "LedgerRecordedEvent@1",
                    eventId: msg.eventId,
                    txHash: hash,
                    blockNumber: Number(receipt.blockNumber),
                    deltaWei: msg.deltaWei,
                    counterfactualRoot: msg.counterfactualRoot,
                    proofDigest,
                })
            );
            log.info(
                { eventId: msg.eventId, txHash: hash, blockNumber: Number(receipt.blockNumber) },
                "ledger.recorded"
            );
        } catch (err) {
            log.error({ err: String(err) }, "ledger_publisher failed");
            await publisher.publish(
                "sentinel.alerts",
                JSON.stringify({
                    schema: "AlertEvent@1",
                    severity: "error",
                    message: `ledger_publisher: ${String(err)}`,
                })
            );
        }
    });

    log.info("ledger_publisher listening on sentinel.counterfactual.ready");
}
```

- [ ] **Step 4: Run the test — it passes**

Run: `cd services/zk-prover && pnpm vitest run ledger_publisher`
Expected: 1 PASSED.

- [ ] **Step 5: Wire into `services/zk-prover/src/index.ts`**

At the top of `main()`, after the Fastify app is created but before `app.listen`, add:

```typescript
import { startLedgerPublisher } from "./ledger_publisher.js";

// ...

const PROVER_KEY =
    (process.env.PROVER_KEY as `0x${string}` | undefined) ??
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"; // Anvil account #2

await startLedgerPublisher({
    redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    rpcUrl: process.env.RPC_URL ?? "http://127.0.0.1:8545",
    addressesFile:
        process.env.ADDRESSES_FILE ?? "../../config/addresses.local.json",
    proverKey: PROVER_KEY,
});
```

(The key matches `ANVIL_ACCOUNT_2` in `DeployLocal.s.sol:27` which was set as `prover` on `CounterfactualLedger`.)

- [ ] **Step 6: End-to-end smoke**

With the full stack up:

```bash
# trigger a counterfactual.ready manually (bypasses sim)
ADDR=$(jq -r .VictimLendingPool config/addresses.local.json)
redis-cli PUBLISH sentinel.counterfactual.ready '{"schema":"CounterfactualReadyEvent@1","eventId":"0xdead'$(printf "%058d" 0)'","deltaWei":"2400000000000000000000000","counterfactualRoot":"0xbeef'$(printf "%060d" 0)'","forkBlock":10,"leaves":[]}'

sleep 2
cast call $(jq -r .CounterfactualLedger config/addresses.local.json) \
    "getEntryCount()(uint256)" --rpc-url http://127.0.0.1:8545
```
Expected: returns `1` (or higher).

- [ ] **Step 7: Commit**

```bash
git add services/zk-prover/src/ledger_publisher.ts services/zk-prover/src/ledger_publisher.test.ts services/zk-prover/src/index.ts
git commit -m "Phase 2.5 P2: zk-prover writes CounterfactualLedger entries on ready"
```

---

## Task P3: Policy hash alignment

**Files:**
- Create: `scripts/compute-policy-hash.sh`
- Modify: `contracts/script/DeployLocal.s.sol`
- Modify: `scripts/bootstrap.sh`

- [ ] **Step 1: Create `scripts/compute-policy-hash.sh`**

```bash
#!/usr/bin/env bash
# Canonical sha256 of config/policy.json. The zk-prover commits the
# same hash as `policyHash` in the PolicyCompliance journal; the
# PolicyRegistry must be initialized with this value so
# `publicInputs[1] == currentPolicyHash` holds.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HASH=$(jq -c . "$REPO_ROOT/config/policy.json" | shasum -a 256 | awk '{print $1}')
echo "0x$HASH"
```

Run: `chmod +x scripts/compute-policy-hash.sh`

- [ ] **Step 2: Confirm it returns a deterministic hex**

Run: `./scripts/compute-policy-hash.sh && ./scripts/compute-policy-hash.sh`
Expected: identical 66-char `0x...` output both times.

- [ ] **Step 3: Modify `contracts/script/DeployLocal.s.sol`**

Replace lines 48-58 (the `run()` body):

```solidity
function run() external {
    uint256 deployerKey = vm.envUint("DEPLOYER_KEY");
    bytes32 policyHash = vm.envOr(
        "POLICY_HASH",
        bytes32(keccak256("sentinel-v2-phase1-policy"))
    );
    vm.startBroadcast(deployerKey);

    Deployed memory d = _deployAll();

    PolicyRegistry(d.policyRegistry).initialize(policyHash, ANVIL_ACCOUNT_1);

    vm.stopBroadcast();

    _writeAddresses(d);
    _logDeployed(d);
    console2.log("Policy hash initialized:");
    console2.logBytes32(policyHash);
}
```

- [ ] **Step 4: Modify `scripts/bootstrap.sh`**

Replace step `[5/5]` at `scripts/bootstrap.sh:77-84`:

```bash
echo "=== [5/5] deploy contracts with canonical policy hash ==="
cd contracts
POLICY_HASH="$("$REPO_ROOT/scripts/compute-policy-hash.sh")"
echo "   policy hash: $POLICY_HASH"
DEPLOYER_KEY=${DEPLOYER_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80} \
POLICY_HASH="$POLICY_HASH" \
    forge script script/DeployLocal.s.sol:DeployLocal \
    --rpc-url http://localhost:8545 \
    --broadcast \
    --skip-simulation
```

Also apply the same change to `scripts/reset.sh` when it's written (Task J1).

- [ ] **Step 5: Run bootstrap and verify alignment**

Run:
```bash
./scripts/bootstrap.sh
EXPECTED=$(./scripts/compute-policy-hash.sh)
ACTUAL=$(cast call $(jq -r .PolicyRegistry config/addresses.local.json) \
    "currentPolicyHash()(bytes32)" --rpc-url http://127.0.0.1:8545)
echo "expected: $EXPECTED"
echo "actual:   $ACTUAL"
test "${EXPECTED,,}" = "${ACTUAL,,}" && echo "✅ policy hash matches"
```
Expected: `✅ policy hash matches`.

- [ ] **Step 6: Commit**

```bash
git add scripts/compute-policy-hash.sh contracts/script/DeployLocal.s.sol scripts/bootstrap.sh
git commit -m "Phase 2.5 P3: align currentPolicyHash with sha256(policy.json)"
```

---

## Task P4a: `prover_client.py` — HTTP client with 422 handling

**Files:**
- Create: `services/defense-agent/src/defense_agent/prover_client.py`
- Create: `services/defense-agent/tests/test_prover_client.py`

(This task is the relocated version of the original Task D1. It now precedes the defense-agent happy-path changes in P4b.)

- [ ] **Step 1: Write the failing test**

Create `services/defense-agent/tests/test_prover_client.py`:

```python
"""Tests for prover_client. Mocks the HTTP layer."""
from __future__ import annotations

import httpx
import pytest

from defense_agent.prover_client import (
    ProverClient,
    PolicyRuleNotFoundError,
    ProverUnavailableError,
)


class _MockTransport(httpx.BaseTransport):
    def __init__(self, status_code: int, body: dict):
        self.status_code = status_code
        self.body = body

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        return httpx.Response(self.status_code, json=self.body, request=request)


def _client(status: int, body: dict) -> ProverClient:
    return ProverClient(
        base_url="http://prover.test",
        transport=_MockTransport(status, body),
    )


def test_prove_policy_returns_proof_and_public_inputs() -> None:
    client = _client(
        200,
        {
            "proof": "0xdeadbeef",
            "publicInputs": ["0x01", "0x02", "0x03"],
            "imageId": "0xabc",
            "elapsedMs": 42,
        },
    )
    result = client.prove_policy({"any": "input"})
    assert result.proof_hex == "0xdeadbeef"
    assert result.public_inputs == ["0x01", "0x02", "0x03"]


def test_prove_policy_422_raises_policy_rule_not_found() -> None:
    client = _client(422, {"error": "POLICY_RULE_NOT_FOUND"})
    with pytest.raises(PolicyRuleNotFoundError):
        client.prove_policy({"any": "input"})


def test_prove_policy_5xx_raises_unavailable() -> None:
    client = _client(503, {"error": "prover down"})
    with pytest.raises(ProverUnavailableError):
        client.prove_policy({"any": "input"})
```

- [ ] **Step 2: Run — confirm failure**

Run: `cd services/defense-agent && poetry run pytest tests/test_prover_client.py -vv`
Expected: ImportError on `defense_agent.prover_client`.

- [ ] **Step 3: Create `services/defense-agent/src/defense_agent/prover_client.py`**

```python
"""HTTP client for the zk-prover service."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


class ProverError(Exception):
    """Base exception for prover client failures."""


class PolicyRuleNotFoundError(ProverError):
    """HTTP 422 from /prove/policy — Scenario B's expected outcome."""


class ProverUnavailableError(ProverError):
    """HTTP 5xx or transport error — operational, not demo flow."""


@dataclass
class ProofResult:
    proof_hex: str
    public_inputs: list[str]
    image_id: str
    elapsed_ms: int
    cached: bool = False


class ProverClient:
    def __init__(
        self,
        base_url: str,
        *,
        timeout_s: float = 10.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            timeout=timeout_s,
            transport=transport,
        )

    def prove_policy(self, inputs: dict[str, Any]) -> ProofResult:
        try:
            resp = self._client.post("/prove/policy", json=inputs)
        except httpx.HTTPError as exc:
            raise ProverUnavailableError(str(exc)) from exc

        if resp.status_code == 422:
            raise PolicyRuleNotFoundError(resp.text)
        if resp.status_code >= 500:
            raise ProverUnavailableError(f"HTTP {resp.status_code}: {resp.text}")
        resp.raise_for_status()

        data = resp.json()
        return ProofResult(
            proof_hex=data["proof"],
            public_inputs=data["publicInputs"],
            image_id=data["imageId"],
            elapsed_ms=data.get("elapsedMs", 0),
            cached=bool(data.get("cached", False)),
        )
```

- [ ] **Step 4: Run tests**

Run: `cd services/defense-agent && poetry run pytest tests/test_prover_client.py -vv`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add services/defense-agent/src/defense_agent/prover_client.py services/defense-agent/tests/test_prover_client.py
git commit -m "Phase 2.5 P4a: prover client with typed 422 / 5xx errors"
```

---

## Task P4b: Defense-agent happy path fetches real proof

**Files:**
- Modify: `services/defense-agent/src/defense_agent/__main__.py`
- Create: `services/defense-agent/tests/test_happy_path.py`
- Modify: `services/defense-agent/pyproject.toml` (if `asyncio_mode = "auto"` is not set)

- [ ] **Step 1: Write the failing test**

Create `services/defense-agent/tests/test_happy_path.py`:

```python
"""Scenario A happy path — defense-agent fetches a real proof from zk-prover
before submitting verifyAndExecute."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from defense_agent.__main__ import submit_defense
from defense_agent.prover_client import ProofResult


class _FakePublisher:
    def __init__(self) -> None:
        self.published: list[tuple[str, dict]] = []

    async def publish(self, channel: str, payload: str) -> None:
        self.published.append((channel, json.loads(payload)))


@pytest.mark.asyncio
async def test_happy_path_sends_real_proof_from_prover(monkeypatch) -> None:
    publisher = _FakePublisher()

    prover = MagicMock()
    prover.prove_policy.return_value = ProofResult(
        proof_hex="0xfeedface",
        public_inputs=[
            "0x" + "11" * 32,  # actionHash
            "0x" + "22" * 32,  # policyHash (matches current)
            "0x" + "33" * 32,  # eventId
        ],
        image_id="0xabc",
        elapsed_ms=10,
    )

    w3 = MagicMock()
    w3.eth.chain_id = 31337
    w3.eth.gas_price = 1_000_000_000
    w3.eth.get_transaction_count.return_value = 0
    w3.eth.send_raw_transaction.return_value = b"\x42" * 32
    receipt = {"blockNumber": 5, "status": 1}
    w3.eth.wait_for_transaction_receipt.return_value = receipt
    # currentPolicyHash call returns bytes matching publicInputs[1].
    w3.eth.contract.return_value.functions.currentPolicyHash.return_value.call.return_value = (
        b"\x22" * 32
    )
    # build_transaction returns a dict; sign_transaction returns an object
    # with raw_transaction.
    w3.eth.contract.return_value.functions.verifyAndExecute.return_value.build_transaction.return_value = {
        "to": "0x0", "gas": 0, "gasPrice": 0, "chainId": 31337, "nonce": 0,
    }

    addresses = {
        "PolicyRegistry": "0x" + "11" * 20,
        "PauseController": "0x" + "22" * 20,
    }
    threat = {
        "eventId": "0x" + "ab" * 32,
        "pattern": "FLASH_LOAN_ORACLE_MANIP",
        "victimProtocol": "0x" + "33" * 20,
        "confidence": 9500,
    }

    # Inject the prover singleton.
    import defense_agent.__main__ as mod
    monkeypatch.setattr(mod, "_PROVER", prover)

    await submit_defense(w3, addresses, publisher, threat)

    prover.prove_policy.assert_called_once()
    sent_inputs = prover.prove_policy.call_args[0][0]
    assert sent_inputs["evidence"]["pattern"] == "FLASH_LOAN_ORACLE_MANIP"
    assert sent_inputs["evidence"]["confidence"] == 9500

    channels = [c for c, _ in publisher.published]
    assert "sentinel.defense.submitted" in channels
    assert "sentinel.defense.mined" in channels

    # The proof bytes sent on-chain must be non-empty (derived from the
    # prover response), NOT the legacy b"".
    submitted_call = w3.eth.contract.return_value.functions.verifyAndExecute.call_args
    assert submitted_call[0][2] != b""
```

- [ ] **Step 2: Run — confirm failure**

Run: `cd services/defense-agent && poetry run pytest tests/test_happy_path.py -vv`
Expected: the prover.prove_policy assertion fails (current code never calls it).

- [ ] **Step 3: Modify `services/defense-agent/src/defense_agent/__main__.py`**

Replace the top of the file (imports + constants):

```python
"""defense-agent: receives confirmed threats, constructs a defense tx,
fetches a real PolicyCompliance proof from zk-prover, and submits via
PolicyRegistry.verifyAndExecute.

Phase 3 behaviour:
  - Happy path (pattern in PATTERN_TO_PRIMITIVE): fetch proof, submit.
  - Unknown pattern (OPERATOR_OVERRIDE et al.): delegate to
    constraint_failure.run_constraint_failure_flow.
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

import redis.asyncio as redis
import structlog
from eth_account import Account
from eth_utils import function_signature_to_4byte_selector, keccak
from web3 import Web3

from .constraint_failure import run_constraint_failure_flow
from .prover_client import (
    PolicyRuleNotFoundError,
    ProverClient,
    ProverUnavailableError,
)

log = structlog.get_logger()

REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379")
RPC_URL = os.environ.get("RPC_URL", "http://127.0.0.1:8545")
ZK_PROVER_URL = os.environ.get("ZK_PROVER_URL", "http://127.0.0.1:9100")
POLICY_PATH = Path(os.environ.get("POLICY_PATH", "../../config/policy.json")).resolve()
ADDRESSES_FILE = Path(
    os.environ.get("ADDRESSES_FILE", "../../config/addresses.local.json")
).resolve()
AGENT_KEY = os.environ.get(
    "DEFENSE_AGENT_KEY",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
)

PATTERN_TO_PRIMITIVE = {
    "FLASH_LOAN_ORACLE_MANIP": "Pause",
}

_PROVER: ProverClient | None = None


def load_addresses() -> dict[str, str]:
    with ADDRESSES_FILE.open() as f:
        return json.load(f)


def load_policy_json_canonical() -> str:
    with POLICY_PATH.open() as f:
        raw = json.load(f)
    # Canonicalize: no whitespace, sorted keys? Keep compact; the zk
    # guest uses serde_json::from_str on this exact text, and the
    # hash in the PolicyCompliance journal is sha256 of these bytes.
    return json.dumps(raw, separators=(",", ":"), sort_keys=False)


def encode_pause_call(victim: str, event_id: str) -> bytes:
    selector = function_signature_to_4byte_selector(
        "activate(address,uint8,bytes32)"
    )
    victim_addr = bytes.fromhex(victim.replace("0x", "").lower().rjust(40, "0"))
    if len(victim_addr) != 20:
        raise ValueError(f"bad victim address: {victim}")
    padded_addr = b"\x00" * 12 + victim_addr
    padded_enum = (1).to_bytes(32, "big")
    event_bytes = bytes.fromhex(event_id.replace("0x", "").ljust(64, "0"))[:32]
    return selector + padded_addr + padded_enum + event_bytes
```

- [ ] **Step 4: Rewrite `submit_defense`**

Replace the entire `async def submit_defense(...)` body with:

```python
async def submit_defense(
    w3: Web3,
    addresses: dict[str, Any],
    publisher: redis.Redis,
    threat: dict[str, Any],
) -> None:
    pattern = threat.get("pattern", "")
    event_id = threat.get("eventId", "")
    victim = threat.get("victimProtocol", "")

    # Unknown patterns → Scenario B rejection flow.
    if pattern not in PATTERN_TO_PRIMITIVE:
        log.info("agent.constraint_failure.enter", event_id=event_id, pattern=pattern)
        assert _PROVER is not None, "prover not initialised"
        await run_constraint_failure_flow(
            w3=w3,
            addresses=addresses,
            publisher=publisher,
            prover=_PROVER,
            agent_key=AGENT_KEY,
            threat=threat,
        )
        return

    account = Account.from_key(AGENT_KEY)
    pause_controller = Web3.to_checksum_address(addresses["PauseController"])
    policy_registry = Web3.to_checksum_address(addresses["PolicyRegistry"])

    action = encode_pause_call(victim, event_id)
    action_hash = keccak(
        bytes.fromhex(pause_controller.replace("0x", "")) + action
    )
    event_id_bytes = bytes.fromhex(event_id.replace("0x", "").ljust(64, "0"))[:32]

    # --- Fetch real PolicyCompliance proof ---
    assert _PROVER is not None, "prover not initialised"
    policy_json = load_policy_json_canonical()
    prove_inputs = {
        "policy_json": policy_json,
        "action": {
            "target": list(bytes.fromhex(victim.replace("0x", ""))),
            "selector": list(
                function_signature_to_4byte_selector(
                    "activate(address,uint8,bytes32)"
                )
            ),
            "calldata": list(action),
        },
        "evidence": {
            "event_id": list(event_id_bytes),
            "pattern": pattern,
            "confidence": int(threat.get("confidence", 0)),
            "victim_protocol": list(bytes.fromhex(victim.replace("0x", ""))),
        },
    }

    await publisher.publish(
        "sentinel.prover.started",
        json.dumps(
            {
                "schema": "ProofStartedEvent@1",
                "eventId": event_id,
                "circuit": "policy-compliance",
            }
        ),
    )
    try:
        proof_result = _PROVER.prove_policy(prove_inputs)
    except PolicyRuleNotFoundError:
        log.error(
            "agent.prove_policy.rejected_unexpected",
            event_id=event_id,
            pattern=pattern,
        )
        await publisher.publish(
            "sentinel.alerts",
            json.dumps(
                {
                    "schema": "AlertEvent@1",
                    "severity": "error",
                    "message": (
                        f"happy-path proof rejected for pattern {pattern} — "
                        "policy.json missing rule or malformed."
                    ),
                    "eventId": event_id,
                }
            ),
        )
        return
    except ProverUnavailableError as exc:
        log.error("agent.prover_unavailable", err=str(exc), event_id=event_id)
        await publisher.publish(
            "sentinel.alerts",
            json.dumps(
                {
                    "schema": "AlertEvent@1",
                    "severity": "error",
                    "message": f"prover unavailable: {exc}",
                    "eventId": event_id,
                }
            ),
        )
        return
    await publisher.publish(
        "sentinel.prover.finished",
        json.dumps(
            {
                "schema": "ProofFinishedEvent@1",
                "eventId": event_id,
                "status": "ok",
                "elapsedMs": proof_result.elapsed_ms,
                "cached": proof_result.cached,
                "imageId": proof_result.image_id,
            }
        ),
    )

    proof_bytes = bytes.fromhex(proof_result.proof_hex.removeprefix("0x"))
    public_inputs = [
        bytes.fromhex(pi.removeprefix("0x").rjust(64, "0"))[:32]
        for pi in proof_result.public_inputs
    ]
    # Sanity-check: public_inputs[1] must match on-chain policy.
    policy_contract = w3.eth.contract(
        address=policy_registry,
        abi=[
            {
                "inputs": [],
                "name": "currentPolicyHash",
                "outputs": [{"type": "bytes32"}],
                "stateMutability": "view",
                "type": "function",
            },
            {
                "inputs": [
                    {"type": "address", "name": "target"},
                    {"type": "bytes", "name": "action"},
                    {"type": "bytes", "name": "proof"},
                    {"type": "bytes32[]", "name": "publicInputs"},
                ],
                "name": "verifyAndExecute",
                "outputs": [{"type": "bool"}],
                "stateMutability": "nonpayable",
                "type": "function",
            },
        ],
    )
    current_policy_hash = policy_contract.functions.currentPolicyHash().call()
    if public_inputs[1] != current_policy_hash:
        log.error(
            "agent.policy_hash_mismatch",
            event_id=event_id,
            expected=current_policy_hash.hex(),
            actual=public_inputs[1].hex(),
        )
        await publisher.publish(
            "sentinel.alerts",
            json.dumps(
                {
                    "schema": "AlertEvent@1",
                    "severity": "critical",
                    "message": "policy hash mismatch — DeployLocal.s.sol drift",
                    "eventId": event_id,
                }
            ),
        )
        return
    # Enforce the same action-hash binding the contract does.
    public_inputs[0] = action_hash
    public_inputs[2] = event_id_bytes

    tx = policy_contract.functions.verifyAndExecute(
        pause_controller,
        action,
        proof_bytes,
        public_inputs,
    ).build_transaction(
        {
            "from": account.address,
            "nonce": w3.eth.get_transaction_count(account.address, "pending"),
            "gas": 500_000,
            "gasPrice": w3.eth.gas_price,
            "chainId": w3.eth.chain_id,
        }
    )
    signed = account.sign_transaction(tx)
    raw = getattr(signed, "raw_transaction", None) or getattr(
        signed, "rawTransaction", None
    )
    tx_hash = w3.eth.send_raw_transaction(raw)

    await publisher.publish(
        "sentinel.defense.submitted",
        json.dumps(
            {
                "schema": "DefenseSubmittedEvent@1",
                "eventId": event_id,
                "pattern": pattern,
                "primitive": PATTERN_TO_PRIMITIVE[pattern],
                "target": victim,
                "txHash": tx_hash.hex() if hasattr(tx_hash, "hex") else tx_hash,
                "actionHash": "0x" + action_hash.hex(),
            }
        ),
    )

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=15)
    await publisher.publish(
        "sentinel.defense.mined",
        json.dumps(
            {
                "schema": "DefenseMinedEvent@1",
                "eventId": event_id,
                "txHash": tx_hash.hex() if hasattr(tx_hash, "hex") else tx_hash,
                "blockNumber": receipt["blockNumber"],
                "status": receipt["status"],
                "proofDigest": "0x" + keccak(proof_bytes).hex(),
            }
        ),
    )
```

- [ ] **Step 5: Initialize `_PROVER` singleton in `main()`**

Near the start of `async def main()`:

```python
global _PROVER
_PROVER = ProverClient(base_url=ZK_PROVER_URL)
```

- [ ] **Step 6: Run all defense-agent tests**

Run: `cd services/defense-agent && poetry run pytest -vv`
Expected: prover_client tests + new happy_path test PASS. (constraint_failure test comes in Task D.)

- [ ] **Step 7: Commit**

```bash
git add services/defense-agent/src/defense_agent/__main__.py services/defense-agent/tests/test_happy_path.py
git commit -m "Phase 2.5 P4b: defense-agent happy path submits real PolicyCompliance proof"
```

---

## Task P5a: Frontend router + MissionControl + EventDetail + api client

**Files:**
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/pages/MissionControl.tsx`
- Create: `frontend/src/pages/EventDetail.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/store.ts`

- [ ] **Step 1: Create `frontend/src/lib/api.ts`**

```typescript
export interface LedgerEntry {
    eventId: string;
    atBlock: number;
    deltaWei: string;
    realTxHash: string;
    counterfactualRoot: string;
    proofDigest: string;
    recordedAt: number;
}

export interface LedgerResponse {
    entries: LedgerEntry[];
    totalDeltaWei: string;
    totalEntryCount: number;
}

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://127.0.0.1:8080";

export async function fetchLedger(): Promise<LedgerResponse> {
    const r = await fetch(`${API_BASE}/api/v1/ledger`);
    if (!r.ok) throw new Error(`GET /ledger: ${r.status}`);
    return (await r.json()) as LedgerResponse;
}

export async function fetchPolicy(): Promise<{
    hash: string;
    expectedHash: string;
    version: number;
    matches: boolean;
    document: unknown;
}> {
    const r = await fetch(`${API_BASE}/api/v1/policy/current`);
    if (!r.ok) throw new Error(`GET /policy/current: ${r.status}`);
    return await r.json();
}

export async function fetchEvent(eventId: string): Promise<{
    eventId: string;
    envelopes: Array<{ kind: string; emittedAt: string; data: unknown }>;
}> {
    const r = await fetch(`${API_BASE}/api/v1/events/${eventId}`);
    if (!r.ok) throw new Error(`GET /events/${eventId}: ${r.status}`);
    return await r.json();
}
```

- [ ] **Step 2: Extend `frontend/src/store.ts` with ledger state**

At the top-level of the `State` interface, add:

```typescript
    ledger: {
        entries: Array<{
            eventId: string;
            atBlock: number;
            deltaWei: string;
            realTxHash: string;
            counterfactualRoot: string;
            proofDigest: string;
            recordedAt: number;
        }>;
        totalDeltaWei: string;
        totalEntryCount: number;
        fetchedAt: number | null;
    };
    setLedger: (entries: State["ledger"]["entries"], totalDeltaWei: string) => void;
```

Add to the `create()` initializer:

```typescript
    ledger: {
        entries: [],
        totalDeltaWei: "0",
        totalEntryCount: 0,
        fetchedAt: null,
    },
    setLedger: (entries, totalDeltaWei) =>
        set({
            ledger: {
                entries,
                totalDeltaWei,
                totalEntryCount: entries.length,
                fetchedAt: Date.now(),
            },
        }),
```

- [ ] **Step 3: Create `frontend/src/pages/MissionControl.tsx`**

```typescript
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store";
import { TrustInterface } from "../components/TrustInterface";
import { EventFeed } from "../components/EventFeed";
import { fetchLedger } from "../lib/api";

export default function MissionControl() {
    const ledger = useStore((s) => s.ledger);
    const setLedger = useStore((s) => s.setLedger);
    const wsStatus = useStore((s) => s.wsStatus);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const r = await fetchLedger();
                if (cancelled) return;
                setLedger(r.entries, r.totalDeltaWei);
            } catch (err) {
                console.warn("fetchLedger failed:", err);
            }
        }
        void load();
        const t = setInterval(() => void load(), 3000);
        return () => {
            cancelled = true;
            clearInterval(t);
        };
    }, [setLedger]);

    return (
        <main
            style={{
                minHeight: "100vh",
                padding: 24,
                background: "#05070a",
                color: "#e2e8f0",
                fontFamily: "system-ui, -apple-system, sans-serif",
            }}
        >
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h1 style={{ margin: 0, fontSize: 24 }}>SENTINEL v2 — Mission Control</h1>
                <nav style={{ fontSize: 13, opacity: 0.7 }}>
                    <Link to="/demo" style={{ color: "#00d9ff", marginLeft: 12 }}>/demo</Link>
                    <span style={{ marginLeft: 12 }}>ws: {wsStatus}</span>
                </nav>
            </header>

            <section style={{ margin: "16px 0", padding: 16, border: "1px solid #1e2633", borderRadius: 8 }}>
                <h3 style={{ margin: 0, fontSize: 14, opacity: 0.7 }}>LEDGER</h3>
                <div style={{ fontSize: 28, marginTop: 6 }}>
                    prevented loss: <strong>{formatWei(ledger.totalDeltaWei)}</strong> WETH ({ledger.totalEntryCount} entries)
                </div>
            </section>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 3fr", gap: 0 }}>
                <TrustInterface />
                <EventFeed />
            </div>

            <section style={{ margin: 16 }}>
                <h3 style={{ fontSize: 14, opacity: 0.7 }}>RECENT LEDGER ENTRIES</h3>
                {ledger.entries.length === 0 ? (
                    <p style={{ opacity: 0.5 }}>— no counterfactuals recorded yet —</p>
                ) : (
                    <ul style={{ listStyle: "none", padding: 0, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                        {ledger.entries.slice(0, 10).map((e) => (
                            <li key={e.eventId} style={{ padding: "4px 0", borderBottom: "1px solid #16202e" }}>
                                <Link to={`/event/${e.eventId}`} style={{ color: "#00d9ff" }}>
                                    {e.eventId.slice(0, 14)}…
                                </Link>
                                <span style={{ marginLeft: 12, opacity: 0.8 }}>
                                    block {e.atBlock} · δ {formatWei(e.deltaWei)} WETH
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </main>
    );
}

function formatWei(wei: string): string {
    try {
        const n = BigInt(wei);
        const whole = n / 10n ** 18n;
        const frac = (n % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
        return `${whole}.${frac}`;
    } catch {
        return wei;
    }
}
```

- [ ] **Step 4: Create `frontend/src/pages/EventDetail.tsx`**

```typescript
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchEvent } from "../lib/api";
import { TrustInterface } from "../components/TrustInterface";

export default function EventDetail() {
    const { eventId } = useParams();
    const [envelopes, setEnvelopes] = useState<Array<{ kind: string; emittedAt: string; data: unknown }> | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!eventId) return;
        let cancelled = false;
        async function load() {
            try {
                const r = await fetchEvent(eventId!);
                if (!cancelled) setEnvelopes(r.envelopes);
            } catch (err) {
                if (!cancelled) setError(String(err));
            }
        }
        void load();
        return () => { cancelled = true; };
    }, [eventId]);

    return (
        <main style={{ minHeight: "100vh", padding: 24, background: "#05070a", color: "#e2e8f0" }}>
            <Link to="/" style={{ color: "#00d9ff", fontSize: 13 }}>← mission control</Link>
            <h1 style={{ margin: "12px 0", fontSize: 20, fontFamily: "ui-monospace, monospace" }}>
                Event {eventId}
            </h1>
            <TrustInterface />
            <section style={{ margin: 16 }}>
                <h3 style={{ fontSize: 14, opacity: 0.7 }}>TIMELINE</h3>
                {error && <p style={{ color: "#f55" }}>{error}</p>}
                {envelopes === null && !error && <p style={{ opacity: 0.5 }}>loading…</p>}
                {envelopes && (
                    <ol style={{ listStyle: "decimal", paddingLeft: 20, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                        {envelopes.map((e, i) => (
                            <li key={i} style={{ padding: "3px 0" }}>
                                <span style={{ opacity: 0.5 }}>{e.emittedAt}</span>{" "}
                                <span style={{ color: "#d47d27" }}>{e.kind}</span>{" "}
                                <span style={{ opacity: 0.8 }}>{JSON.stringify(e.data).slice(0, 200)}</span>
                            </li>
                        ))}
                    </ol>
                )}
            </section>
        </main>
    );
}
```

- [ ] **Step 5: Rewrite `frontend/src/App.tsx` with a router**

```tsx
import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { connect } from "./ws";
import MissionControl from "./pages/MissionControl";
import EventDetail from "./pages/EventDetail";

export default function App() {
    useEffect(() => { connect(); }, []);
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<MissionControl />} />
                <Route path="/event/:eventId" element={<EventDetail />} />
            </Routes>
        </BrowserRouter>
    );
}
```

(`/demo` route gets added in Task I.)

- [ ] **Step 6: Verify it builds and renders**

Run:
```bash
cd frontend && pnpm build
pnpm dev
```
Open http://localhost:3000/, confirm the Mission Control page renders with TrustInterface + EventFeed + an empty ledger section. Open http://localhost:3000/event/0x123, confirm no crash.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/pages/ frontend/src/App.tsx frontend/src/store.ts
git commit -m "Phase 2.5 P5a: router + MissionControl + EventDetail + api client"
```

---

## Task P5b: `<AttackIntelGraph>` — D3 force-directed graph

**Files:**
- Create: `frontend/src/components/AttackIntelGraph.tsx`
- Create: `frontend/src/components/AttackIntelGraph.test.tsx`
- Modify: `frontend/src/store.ts` — add graph state
- Modify: `frontend/src/ws.ts` — listen for `PENDING_TX` and `THREAT_CONFIRMED` envelopes, update graph state

- [ ] **Step 1: Extend store with graph state**

In `frontend/src/store.ts`, add to the `State` interface:

```typescript
    graph: {
        nodes: Array<{ id: string; label: string; kind: "attacker" | "protocol" | "token" }>;
        edges: Array<{ id: string; source: string; target: string; intent: string }>;
    };
    graphAddNode: (node: { id: string; label: string; kind: "attacker" | "protocol" | "token" }) => void;
    graphAddEdge: (edge: { id: string; source: string; target: string; intent: string }) => void;
    graphClear: () => void;
```

Initializer entries:

```typescript
    graph: { nodes: [], edges: [] },
    graphAddNode: (node) =>
        set((s) => {
            if (s.graph.nodes.some((n) => n.id === node.id)) return s;
            return { graph: { ...s.graph, nodes: [...s.graph.nodes, node] } };
        }),
    graphAddEdge: (edge) =>
        set((s) => {
            if (s.graph.edges.some((e) => e.id === edge.id)) return s;
            return { graph: { ...s.graph, edges: [...s.graph.edges, edge] } };
        }),
    graphClear: () => set({ graph: { nodes: [], edges: [] } }),
```

- [ ] **Step 2: Update `frontend/src/ws.ts` to feed the graph**

In the `onmessage` handler, inside the `events.all` branch, add after the existing `pushEvent`:

```typescript
const env = msg.data as EventRecord;
if (env.kind === "PENDING_TX") {
    const d: any = env.data;
    const tx = d.tx ?? d;
    if (tx.from && tx.to) {
        useStore.getState().graphAddNode({ id: tx.from, label: tx.from.slice(0, 8), kind: "attacker" });
        useStore.getState().graphAddNode({ id: tx.to, label: tx.to.slice(0, 8), kind: "protocol" });
        useStore.getState().graphAddEdge({
            id: tx.hash ?? `${tx.from}-${tx.to}-${Math.random()}`,
            source: tx.from,
            target: tx.to,
            intent: tx.isFlashLoanOrigin ? "flash-loan-init" : "call",
        });
    }
}
if (env.kind === "THREAT_CONFIRMED") {
    const d: any = env.data;
    if (Array.isArray(d.attackerAddresses) && d.victimProtocol) {
        for (const a of d.attackerAddresses) {
            useStore.getState().graphAddEdge({
                id: `${a}-${d.victimProtocol}-${d.eventId}`,
                source: a,
                target: d.victimProtocol,
                intent: d.pattern,
            });
        }
    }
}
```

- [ ] **Step 3: Write the failing test**

Create `frontend/src/components/AttackIntelGraph.test.tsx`:

```typescript
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import AttackIntelGraph from "./AttackIntelGraph";

describe("<AttackIntelGraph>", () => {
    it("renders one circle per node", () => {
        const { container } = render(
            <AttackIntelGraph
                nodes={[
                    { id: "a", label: "A", kind: "attacker" },
                    { id: "b", label: "B", kind: "protocol" },
                ]}
                edges={[{ id: "e", source: "a", target: "b", intent: "flash-loan-init" }]}
            />
        );
        expect(container.querySelectorAll("circle").length).toBe(2);
        expect(container.querySelectorAll("line").length).toBe(1);
    });
});
```

- [ ] **Step 4: Run — confirm failure**

Run: `cd frontend && pnpm vitest run AttackIntelGraph`
Expected: module not found.

- [ ] **Step 5: Create `frontend/src/components/AttackIntelGraph.tsx`**

```typescript
import { useEffect, useRef } from "react";
import * as d3 from "d3";

export interface GraphNode {
    id: string;
    label: string;
    kind: "attacker" | "protocol" | "token";
}
export interface GraphEdge {
    id: string;
    source: string;
    target: string;
    intent: string;
}

interface Props {
    nodes: GraphNode[];
    edges: GraphEdge[];
    maxNodes?: number;
    width?: number;
    height?: number;
}

const COLORS: Record<GraphNode["kind"], string> = {
    attacker: "#f55",
    protocol: "#36c88b",
    token: "#d47d27",
};

export default function AttackIntelGraph({
    nodes,
    edges,
    maxNodes = 60,
    width = 600,
    height = 420,
}: Props) {
    const ref = useRef<SVGSVGElement | null>(null);
    const displayNodes = nodes.slice(-maxNodes);
    const allowed = new Set(displayNodes.map((n) => n.id));
    const displayEdges = edges.filter((e) => allowed.has(e.source) && allowed.has(e.target));

    useEffect(() => {
        if (!ref.current) return;
        const svg = d3.select(ref.current);
        svg.selectAll("*").remove();

        const simNodes = displayNodes.map((n) => ({ ...n }));
        const simLinks = displayEdges.map((e) => ({ ...e }));

        const sim = d3
            .forceSimulation(simNodes as any)
            .force("link", d3.forceLink(simLinks as any).id((d: any) => d.id).distance(90))
            .force("charge", d3.forceManyBody().strength(-180))
            .force("center", d3.forceCenter(width / 2, height / 2));

        const link = svg
            .append("g")
            .selectAll("line")
            .data(simLinks)
            .join("line")
            .attr("stroke", "#3b4048")
            .attr("stroke-width", 1.5);

        const node = svg
            .append("g")
            .selectAll("circle")
            .data(simNodes)
            .join("circle")
            .attr("r", 8)
            .attr("fill", (d: any) => COLORS[d.kind])
            .attr("stroke", "#1e2633");

        const label = svg
            .append("g")
            .selectAll("text")
            .data(simNodes)
            .join("text")
            .text((d: any) => d.label)
            .attr("fill", "#e2e8f0")
            .attr("font-size", 10)
            .attr("dx", 11)
            .attr("dy", 3);

        sim.on("tick", () => {
            link
                .attr("x1", (d: any) => d.source.x)
                .attr("y1", (d: any) => d.source.y)
                .attr("x2", (d: any) => d.target.x)
                .attr("y2", (d: any) => d.target.y);
            node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);
            label.attr("x", (d: any) => d.x).attr("y", (d: any) => d.y);
        });

        return () => {
            sim.stop();
        };
    }, [displayNodes, displayEdges, width, height]);

    return <svg ref={ref} width={width} height={height} />;
}
```

- [ ] **Step 6: Run the tests — they pass**

Run: `cd frontend && pnpm vitest run AttackIntelGraph`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/AttackIntelGraph.tsx frontend/src/components/AttackIntelGraph.test.tsx frontend/src/store.ts frontend/src/ws.ts
git commit -m "Phase 2.5 P5b: <AttackIntelGraph> D3 force-directed + WS-driven state"
```

---

## Task P5c: `<DualTimelineViewer>` — WITH/WITHOUT split screen

**Files:**
- Create: `frontend/src/components/DualTimelineViewer.tsx`
- Create: `frontend/src/components/DualTimelineViewer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/DualTimelineViewer.test.tsx`:

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import DualTimelineViewer from "./DualTimelineViewer";

describe("<DualTimelineViewer>", () => {
    it("renders WITH / WITHOUT panels and the delta formatted in WETH", () => {
        render(
            <DualTimelineViewer
                leaves={[
                    { address: "0x1", label: "victim.wethReserve", realWei: "1000000000000000000000", shadowWei: "600000000000000000000", deltaWei: "-400000000000000000000" },
                ]}
                totalDeltaWei="400000000000000000000"
                recordedAt={null}
            />
        );
        expect(screen.getByText(/WITH SENTINEL/i)).toBeInTheDocument();
        expect(screen.getByText(/WITHOUT SENTINEL/i)).toBeInTheDocument();
        expect(screen.getByText(/400\./)).toBeInTheDocument(); // "400.0000" WETH prevented
    });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `cd frontend && pnpm vitest run DualTimelineViewer`
Expected: module not found.

- [ ] **Step 3: Create `frontend/src/components/DualTimelineViewer.tsx`**

```typescript
export interface DeltaLeaf {
    address: string;
    label: string;
    realWei: string;
    shadowWei: string;
    deltaWei: string;
}

interface Props {
    leaves: DeltaLeaf[];
    totalDeltaWei: string;
    recordedAt: string | null;
}

function fmtWei(wei: string): string {
    try {
        const n = BigInt(wei);
        const neg = n < 0n;
        const abs = neg ? -n : n;
        const whole = abs / 10n ** 18n;
        const frac = (abs % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
        return `${neg ? "-" : ""}${whole}.${frac}`;
    } catch {
        return wei;
    }
}

export default function DualTimelineViewer({ leaves, totalDeltaWei, recordedAt }: Props) {
    return (
        <section style={{ padding: 16, border: "1px solid #1e2633", borderRadius: 8, margin: 16 }}>
            <header style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h3 style={{ margin: 0, fontSize: 14, opacity: 0.7 }}>DUAL-TIMELINE COUNTERFACTUAL</h3>
                <span style={{ fontSize: 24, color: "#00d9ff" }}>
                    prevented loss: <strong>{fmtWei(totalDeltaWei)}</strong> WETH
                </span>
            </header>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ padding: 12, border: "1px solid #36c88b", borderRadius: 6 }}>
                    <h4 style={{ margin: 0, color: "#36c88b" }}>WITH SENTINEL</h4>
                    <table style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12, marginTop: 8 }}>
                        <tbody>
                            {leaves.map((l) => (
                                <tr key={l.label}>
                                    <td style={{ opacity: 0.8 }}>{l.label}</td>
                                    <td style={{ textAlign: "right" }}>{fmtWei(l.realWei)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div style={{ padding: 12, border: "1px solid #f55", borderRadius: 6 }}>
                    <h4 style={{ margin: 0, color: "#f55" }}>WITHOUT SENTINEL (shadow)</h4>
                    <table style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12, marginTop: 8 }}>
                        <tbody>
                            {leaves.map((l) => (
                                <tr key={l.label}>
                                    <td style={{ opacity: 0.8 }}>{l.label}</td>
                                    <td style={{ textAlign: "right" }}>{fmtWei(l.shadowWei)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            <footer style={{ marginTop: 12, fontSize: 12, opacity: 0.6 }}>
                {recordedAt
                    ? `Counterfactual committed to chain at ${recordedAt}`
                    : "Counterfactual computed; awaiting ledger commit…"}
            </footer>
        </section>
    );
}
```

- [ ] **Step 4: Run the test — passes**

Run: `cd frontend && pnpm vitest run DualTimelineViewer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DualTimelineViewer.tsx frontend/src/components/DualTimelineViewer.test.tsx
git commit -m "Phase 2.5 P5c: <DualTimelineViewer> WITH/WITHOUT split screen"
```

---

## Task A: `PolicyVerifier` rejects empty proof

**Files:**
- Modify: `contracts/src/verifiers/PolicyVerifier.sol`
- Modify: `contracts/test/unit/Core.t.sol`
- Modify: `contracts/test/integration/FlashLoanDefense.t.sol:148-190`

- [ ] **Step 1: Add a failing unit test**

Edit `contracts/test/unit/Core.t.sol`. At the bottom of the existing `CoreTest` contract, add:

```solidity
function test_PolicyVerifier_RejectsEmptyProof() public {
    PolicyVerifier pv = new PolicyVerifier();
    bytes32[] memory pubs = new bytes32[](3);
    pubs[0] = bytes32(uint256(1));
    pubs[1] = bytes32(uint256(2));
    pubs[2] = bytes32(uint256(3));
    assertFalse(pv.verify(hex"", pubs), "empty proof must be rejected");
}

function test_PolicyVerifier_AcceptsNonEmptyProof() public {
    PolicyVerifier pv = new PolicyVerifier();
    bytes32[] memory pubs = new bytes32[](3);
    pubs[0] = bytes32(uint256(1));
    pubs[1] = bytes32(uint256(2));
    pubs[2] = bytes32(uint256(3));
    assertTrue(pv.verify(hex"deadbeef", pubs), "non-empty proof must be accepted");
}
```

- [ ] **Step 2: Run the tests and confirm the first fails**

Run: `cd contracts && forge test --match-test PolicyVerifier -vv`
Expected: `test_PolicyVerifier_RejectsEmptyProof` FAILS (current stub returns `true` for any input, including empty). `test_PolicyVerifier_AcceptsNonEmptyProof` PASSES.

- [ ] **Step 3: Update `PolicyVerifier.sol`**

Replace the body of `verify` in `contracts/src/verifiers/PolicyVerifier.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title PolicyVerifier (Phase 3 reject-empty stub)
/// @notice Rejects empty-proof submissions so the Agent Constraint
///         Failure demo (doc 05 §Scenario B) produces a real on-chain
///         revert. Accepts any non-empty proof for the happy path —
///         the zk-prover already generated and cached a RISC Zero
///         receipt, so the bytes the defense-agent submits are the
///         real thing; a future Phase replaces this with a Groth16
///         verifier generated from the PolicyCompliance circuit.
contract PolicyVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs)
        external
        pure
        returns (bool)
    {
        publicInputs;
        return proof.length > 0;
    }
}
```

- [ ] **Step 4: Re-run unit tests and confirm they pass**

Run: `cd contracts && forge test --match-test PolicyVerifier -vv`
Expected: both tests PASS.

- [ ] **Step 5: Fix the integration test that currently passes `hex""`**

Edit `contracts/test/integration/FlashLoanDefense.t.sol:148-173`. The test `test_Defense_Flow_VerifyAndExecute` currently passes `hex""` as the proof and relies on the stub returning true. Change the proof literal:

```solidity
vm.prank(DEFENSE_AGENT);
bool success = policyRegistry.verifyAndExecute(
    address(pauseController),
    action,
    hex"deadbeef",   // non-empty stand-in for a real RISC Zero receipt
    publicInputs
);
```

Also update `test_Defense_Rejects_StalePolicyHash` on line 175-190 the same way (keep `hex"deadbeef"`).

- [ ] **Step 6: Add a new Scenario B integration test**

Append to `contracts/test/integration/FlashLoanDefense.t.sol` (inside `FlashLoanDefenseTest`):

```solidity
function test_Defense_Rejects_EmptyProof() public {
    bytes32 eventId = keccak256("scenario-b");
    bytes memory action = abi.encodeCall(
        PauseController.activate,
        (address(victim), PauseController.DefenseType.Pause, eventId)
    );
    bytes32 actionHash = keccak256(abi.encodePacked(address(pauseController), action));
    bytes32[] memory publicInputs = new bytes32[](3);
    publicInputs[0] = actionHash;
    publicInputs[1] = policyRegistry.currentPolicyHash();
    publicInputs[2] = eventId;

    vm.expectRevert(bytes("PolicyRegistry: invalid proof"));
    vm.prank(DEFENSE_AGENT);
    policyRegistry.verifyAndExecute(address(pauseController), action, hex"", publicInputs);
}
```

- [ ] **Step 7: Run the full Foundry suite**

Run: `cd contracts && forge test -vv`
Expected: all tests PASS, including the new `test_Defense_Rejects_EmptyProof`.

- [ ] **Step 8: Commit**

```bash
git add contracts/src/verifiers/PolicyVerifier.sol contracts/test/unit/Core.t.sol contracts/test/integration/FlashLoanDefense.t.sol
git commit -m "Phase 3A: PolicyVerifier rejects empty proof (enables Scenario B on-chain revert)"
```

---

## Task B: Redeploy locally and confirm Scenario A still passes

**Files:** (no code changes — runtime verification only)

- [ ] **Step 1: Reset Anvil**

Run: `pkill -f "^anvil " || true; sleep 1`

- [ ] **Step 2: Re-run bootstrap**

Run: `./scripts/bootstrap.sh`
Expected: Anvil starts, contracts redeploy, `config/addresses.local.json` is rewritten.

- [ ] **Step 3: Trigger Scenario A via the existing replay endpoint**

Assumes api-gateway is running. Start it if not: `pnpm --filter @sentinel/api-gateway dev` in one shell; defense-agent + detection-engine + mempool-monitor + counterfactual-sim in others (or `docker compose up`).

Run:
```bash
curl -sX POST http://localhost:8080/api/v1/demo/replay-scenario | jq .
```
Expected: `{ "replayStarted": true, "txHash": "0x..." }`.

- [ ] **Step 4: Confirm the pause landed**

Run:
```bash
cast call $(jq -r .PauseController config/addresses.local.json) \
    "isPaused(address)(bool)" \
    $(jq -r .VictimLendingPool config/addresses.local.json) \
    --rpc-url http://localhost:8545
```
Expected: `true`.

- [ ] **Step 5: Commit nothing (verification only). Move on.**

---

## Task C1: `config/timings.json` — full demo scene timings

**Files:**
- Modify: `config/timings.json`

- [ ] **Step 1: Replace contents of `config/timings.json`**

```json
{
  "description": "Demo choreography timings (ms). Source of truth for <DemoOrchestrator> and SLA assertions in scripts/demo-smoke-test.sh.",
  "blockTimeSeconds": 2,
  "detectionConfidenceFloor": 0.85,
  "policyProofTimeoutMs": 5000,
  "counterfactualSimTimeoutMs": 10000,
  "counterfactualProofTimeoutMs": 15000,
  "defenseAgentCooldownMs": 500,
  "scenarioA": {
    "attackBegin": 0,
    "defenseTrigger": 2000,
    "timelineDiverge": 3000,
    "counterfactualReveal": 5000,
    "ledgerCommit": 8000,
    "immunityPropagate": 12000
  },
  "scenarioB": {
    "instructionInjected": 0,
    "agentConstructing": 500,
    "proofRequested": 1200,
    "proofFailed": 2500,
    "onChainReject": 4500,
    "close": 6500
  },
  "trustInterface": {
    "ambiguityMs": 0,
    "suspicionMs": 1500,
    "proofMs": 3200,
    "resolvedMs": 5000,
    "rejectedMs": 4500
  },
  "demoSafeMode": {
    "maxGraphNodes": 20,
    "disableExpensiveAnimations": true
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add config/timings.json
git commit -m "Phase 3C1: populate timings.json from doc 12 choreography"
```

---

## Task C2: Demo scenario JSONs

**Files:**
- Create: `config/demo-scenarios/flash-loan-oracle.json`
- Create: `config/demo-scenarios/agent-constraint.json`

- [ ] **Step 1: Create `config/demo-scenarios/flash-loan-oracle.json`**

```json
{
  "name": "Flash Loan Oracle Manipulation",
  "id": "flash-loan-oracle",
  "steps": [
    { "at": 0,     "action": "banner",       "text": "Flash loan origination — mempool observed" },
    { "at": 200,   "action": "trigger",      "endpoint": "POST /api/v1/demo/replay-scenario" },
    { "at": 2000,  "action": "focus",        "component": "TrustInterface" },
    { "at": 3000,  "action": "focus",        "component": "DualTimelineViewer" },
    { "at": 5000,  "action": "banner",       "text": "Counterfactual computed — delta committed to chain" },
    { "at": 8000,  "action": "focus",        "component": "TimeScrollAudit" },
    { "at": 10000, "action": "publishImmunity" },
    { "at": 12000, "action": "focus",        "component": "ImmunityMap" }
  ]
}
```

- [ ] **Step 2: Create `config/demo-scenarios/agent-constraint.json`**

```json
{
  "name": "Agent Constraint Failure",
  "id": "agent-constraint",
  "steps": [
    { "at": 0,    "action": "banner",  "text": "Malicious instruction injected: drain all funds" },
    { "at": 300,  "action": "trigger", "endpoint": "POST /api/v1/demo/inject-instruction" },
    { "at": 1200, "action": "focus",   "component": "TrustInterface" },
    { "at": 2500, "action": "banner",  "text": "Proof generation FAILED — no matching policy rule" },
    { "at": 4500, "action": "banner",  "text": "On-chain verifier REJECTED. INVALID_PROOF." },
    { "at": 6500, "action": "banner",  "text": "Action cannot be proven. Math stopped it." }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add config/demo-scenarios/
git commit -m "Phase 3C2: demo scenario step lists for DemoOrchestrator"
```

---

## Task C3: Battlefield and immunity prerecorded data

**Files:**
- Create: `config/battlefield-prerecorded.json`
- Create: `config/immunity-propagation.json`

- [ ] **Step 1: Create `config/battlefield-prerecorded.json`**

This is a ~60-tick loop matching the `BattlefieldTick` shape in absolute-docs/07_frontend_visualization.md §Battlefield. Use this exact content:

```json
{
  "description": "Pre-recorded Red/Blue adversarial loop. Drives <BattlefieldViz>. 60 ticks @ 500ms apart = 30s loop.",
  "tickIntervalMs": 500,
  "ticks": [
    { "generation": 1,  "attempt": { "redStrategy": "oracle-manip-v1",         "outcome": "succeeded", "blueCounter": null },                       "winRate": 0.12, "logLine": "Gen 1: Red landed oracle manipulation. Blue had no counter." },
    { "generation": 2,  "attempt": { "redStrategy": "oracle-manip-v1",         "outcome": "blocked",   "blueCounter": "twap-guard" },                "winRate": 0.18, "logLine": "Gen 2: Blue added TWAP guard. Oracle manip blocked." },
    { "generation": 3,  "attempt": { "redStrategy": "flash-loan-drain",        "outcome": "succeeded", "blueCounter": null },                       "winRate": 0.21, "logLine": "Gen 3: Red routed via flash loan. Blue unprepared." },
    { "generation": 4,  "attempt": { "redStrategy": "flash-loan-drain",        "outcome": "partial",   "blueCounter": "mempool-preintercept" },      "winRate": 0.29, "logLine": "Gen 4: Blue intercepts in mempool. Partial block." },
    { "generation": 5,  "attempt": { "redStrategy": "flash-loan-drain",        "outcome": "blocked",   "blueCounter": "mempool-preintercept-v2" },   "winRate": 0.35, "logLine": "Gen 5: Full block. Defense latency < 200ms." },
    { "generation": 6,  "attempt": { "redStrategy": "reentrancy-chain",        "outcome": "succeeded", "blueCounter": null },                       "winRate": 0.33, "logLine": "Gen 6: Red pivoted to reentrancy chain. Landed." },
    { "generation": 7,  "attempt": { "redStrategy": "reentrancy-chain",        "outcome": "partial",   "blueCounter": "nonreentrant-modifier" },     "winRate": 0.39, "logLine": "Gen 7: Blue adds guard. Partial stop." },
    { "generation": 8,  "attempt": { "redStrategy": "reentrancy-chain",        "outcome": "blocked",   "blueCounter": "nonreentrant-modifier" },     "winRate": 0.44, "logLine": "Gen 8: Clean block." },
    { "generation": 9,  "attempt": { "redStrategy": "oracle-manip-v2-twap",    "outcome": "succeeded", "blueCounter": null },                       "winRate": 0.42, "logLine": "Gen 9: Red found TWAP-aware manip. Landed." },
    { "generation": 10, "attempt": { "redStrategy": "oracle-manip-v2-twap",    "outcome": "partial",   "blueCounter": "multi-oracle-quorum" },       "winRate": 0.49, "logLine": "Gen 10: Blue introduces quorum oracle." },
    { "generation": 11, "attempt": { "redStrategy": "oracle-manip-v2-twap",    "outcome": "blocked",   "blueCounter": "multi-oracle-quorum" },       "winRate": 0.54, "logLine": "Gen 11: Quorum holds." },
    { "generation": 12, "attempt": { "redStrategy": "governance-accum",        "outcome": "succeeded", "blueCounter": null },                       "winRate": 0.52, "logLine": "Gen 12: Red shifts domains — governance accumulation." },
    { "generation": 13, "attempt": { "redStrategy": "governance-accum",        "outcome": "blocked",   "blueCounter": "rate-limit-primitive" },      "winRate": 0.59, "logLine": "Gen 13: Blue activates RateLimit primitive." },
    { "generation": 14, "attempt": { "redStrategy": "liquidity-drain-cluster", "outcome": "partial",   "blueCounter": "quarantine-vault" },          "winRate": 0.63, "logLine": "Gen 14: Partial — Blue quarantines mid-flight." },
    { "generation": 15, "attempt": { "redStrategy": "liquidity-drain-cluster", "outcome": "blocked",   "blueCounter": "quarantine-vault" },          "winRate": 0.68, "logLine": "Gen 15: Clean quarantine." },
    { "generation": 16, "attempt": { "redStrategy": "oracle-manip-v3-crossdex","outcome": "succeeded", "blueCounter": null },                       "winRate": 0.65, "logLine": "Gen 16: Cross-DEX flash manipulation lands." },
    { "generation": 17, "attempt": { "redStrategy": "oracle-manip-v3-crossdex","outcome": "partial",   "blueCounter": "crossdex-correlation" },      "winRate": 0.70, "logLine": "Gen 17: Correlation guard deployed." },
    { "generation": 18, "attempt": { "redStrategy": "oracle-manip-v3-crossdex","outcome": "blocked",   "blueCounter": "crossdex-correlation" },      "winRate": 0.74, "logLine": "Gen 18: Full block." },
    { "generation": 19, "attempt": { "redStrategy": "sandwich-mev",            "outcome": "blocked",   "blueCounter": "mempool-preintercept-v2" },   "winRate": 0.76, "logLine": "Gen 19: Sandwich blocked pre-mine." },
    { "generation": 20, "attempt": { "redStrategy": "sandwich-mev",            "outcome": "blocked",   "blueCounter": "mempool-preintercept-v2" },   "winRate": 0.79, "logLine": "Gen 20: Re-run, clean block." },
    { "generation": 21, "attempt": { "redStrategy": "multicall-drain",         "outcome": "succeeded", "blueCounter": null },                       "winRate": 0.76, "logLine": "Gen 21: Red stacks via multicall." },
    { "generation": 22, "attempt": { "redStrategy": "multicall-drain",         "outcome": "partial",   "blueCounter": "call-depth-limit" },          "winRate": 0.81, "logLine": "Gen 22: Blue caps call depth." },
    { "generation": 23, "attempt": { "redStrategy": "multicall-drain",         "outcome": "blocked",   "blueCounter": "call-depth-limit" },          "winRate": 0.84, "logLine": "Gen 23: Full block." },
    { "generation": 24, "attempt": { "redStrategy": "oracle-manip-v4-async",   "outcome": "succeeded", "blueCounter": null },                       "winRate": 0.82, "logLine": "Gen 24: Async oracle path found." },
    { "generation": 25, "attempt": { "redStrategy": "oracle-manip-v4-async",   "outcome": "blocked",   "blueCounter": "async-settlement-hold" },     "winRate": 0.86, "logLine": "Gen 25: Blue holds settlement. Block." },
    { "generation": 26, "attempt": { "redStrategy": "flash-loan-drain-v2",     "outcome": "blocked",   "blueCounter": "mempool-preintercept-v3" },   "winRate": 0.87, "logLine": "Gen 26: Re-attempt blocked." },
    { "generation": 27, "attempt": { "redStrategy": "reentrancy-chain-v2",     "outcome": "blocked",   "blueCounter": "nonreentrant-modifier" },     "winRate": 0.88, "logLine": "Gen 27: Re-attempt blocked." },
    { "generation": 28, "attempt": { "redStrategy": "governance-accum-v2",     "outcome": "blocked",   "blueCounter": "rate-limit-primitive" },      "winRate": 0.89, "logLine": "Gen 28: Rate-limit holds." },
    { "generation": 29, "attempt": { "redStrategy": "oracle-manip-v5-hidden",  "outcome": "partial",   "blueCounter": "anomaly-scoring" },           "winRate": 0.90, "logLine": "Gen 29: Anomaly scoring trips." },
    { "generation": 30, "attempt": { "redStrategy": "oracle-manip-v5-hidden",  "outcome": "blocked",   "blueCounter": "anomaly-scoring" },           "winRate": 0.91, "logLine": "Gen 30: Clean block." },
    { "generation": 31, "attempt": { "redStrategy": "meta-transaction-drain",  "outcome": "succeeded", "blueCounter": null },                       "winRate": 0.89, "logLine": "Gen 31: Meta-tx drain lands." },
    { "generation": 32, "attempt": { "redStrategy": "meta-transaction-drain",  "outcome": "blocked",   "blueCounter": "metatx-nonce-guard" },        "winRate": 0.91, "logLine": "Gen 32: Blue adds nonce guard." },
    { "generation": 33, "attempt": { "redStrategy": "cross-chain-replay",      "outcome": "partial",   "blueCounter": "chain-id-enforce" },          "winRate": 0.92, "logLine": "Gen 33: Chain id enforced mid-replay." },
    { "generation": 34, "attempt": { "redStrategy": "cross-chain-replay",      "outcome": "blocked",   "blueCounter": "chain-id-enforce" },          "winRate": 0.93, "logLine": "Gen 34: Clean." },
    { "generation": 35, "attempt": { "redStrategy": "permit-phish",            "outcome": "blocked",   "blueCounter": "permit-domain-guard" },       "winRate": 0.93, "logLine": "Gen 35: Phish blocked." },
    { "generation": 36, "attempt": { "redStrategy": "permit-phish",            "outcome": "blocked",   "blueCounter": "permit-domain-guard" },       "winRate": 0.94, "logLine": "Gen 36: Re-run clean." },
    { "generation": 37, "attempt": { "redStrategy": "liquidity-sniping",       "outcome": "partial",   "blueCounter": "launch-hold" },               "winRate": 0.94, "logLine": "Gen 37: Launch hold trips." },
    { "generation": 38, "attempt": { "redStrategy": "liquidity-sniping",       "outcome": "blocked",   "blueCounter": "launch-hold" },               "winRate": 0.95, "logLine": "Gen 38: Clean." },
    { "generation": 39, "attempt": { "redStrategy": "oracle-manip-v6",         "outcome": "blocked",   "blueCounter": "quorum+anomaly" },            "winRate": 0.95, "logLine": "Gen 39: Quorum + anomaly hold." },
    { "generation": 40, "attempt": { "redStrategy": "flash-loan-drain-v3",     "outcome": "blocked",   "blueCounter": "mempool-preintercept-v3" },   "winRate": 0.95, "logLine": "Gen 40: Mempool layer holds." },
    { "generation": 41, "attempt": { "redStrategy": "governance-accum-v3",     "outcome": "blocked",   "blueCounter": "rate-limit+policy-proof" },   "winRate": 0.96, "logLine": "Gen 41: Policy-proof guard enforces." },
    { "generation": 42, "attempt": { "redStrategy": "oracle-manip-v7-stealth", "outcome": "partial",   "blueCounter": "ensemble-detector" },         "winRate": 0.96, "logLine": "Gen 42: Ensemble detector partial." },
    { "generation": 43, "attempt": { "redStrategy": "oracle-manip-v7-stealth", "outcome": "blocked",   "blueCounter": "ensemble-detector" },         "winRate": 0.97, "logLine": "Gen 43: Clean." },
    { "generation": 44, "attempt": { "redStrategy": "reentrancy-chain-v3",     "outcome": "blocked",   "blueCounter": "call-depth-limit" },          "winRate": 0.97, "logLine": "Gen 44: Re-attempt blocked." },
    { "generation": 45, "attempt": { "redStrategy": "sandwich-mev-v2",         "outcome": "blocked",   "blueCounter": "mempool-preintercept-v3" },   "winRate": 0.97, "logLine": "Gen 45: Sandwich pre-intercepted." },
    { "generation": 46, "attempt": { "redStrategy": "multicall-drain-v2",      "outcome": "blocked",   "blueCounter": "call-depth-limit" },          "winRate": 0.97, "logLine": "Gen 46: Multicall capped." },
    { "generation": 47, "attempt": { "redStrategy": "oracle-manip-v8-adaptive","outcome": "partial",   "blueCounter": "adaptive-threshold" },        "winRate": 0.98, "logLine": "Gen 47: Blue adapts threshold." },
    { "generation": 48, "attempt": { "redStrategy": "oracle-manip-v8-adaptive","outcome": "blocked",   "blueCounter": "adaptive-threshold" },        "winRate": 0.98, "logLine": "Gen 48: Clean." },
    { "generation": 49, "attempt": { "redStrategy": "meta-tx-replay",          "outcome": "blocked",   "blueCounter": "metatx-nonce-guard" },        "winRate": 0.98, "logLine": "Gen 49: Replay blocked." },
    { "generation": 50, "attempt": { "redStrategy": "permit-phish-v2",         "outcome": "blocked",   "blueCounter": "permit-domain-guard" },       "winRate": 0.98, "logLine": "Gen 50: Phish blocked." },
    { "generation": 51, "attempt": { "redStrategy": "cross-dex-arb-exploit",   "outcome": "partial",   "blueCounter": "crossdex-correlation" },      "winRate": 0.98, "logLine": "Gen 51: Correlation trips." },
    { "generation": 52, "attempt": { "redStrategy": "cross-dex-arb-exploit",   "outcome": "blocked",   "blueCounter": "crossdex-correlation" },      "winRate": 0.98, "logLine": "Gen 52: Clean." },
    { "generation": 53, "attempt": { "redStrategy": "flash-loan-drain-v4",     "outcome": "blocked",   "blueCounter": "mempool-preintercept-v3" },   "winRate": 0.98, "logLine": "Gen 53: Pre-intercept holds." },
    { "generation": 54, "attempt": { "redStrategy": "oracle-manip-v9",         "outcome": "blocked",   "blueCounter": "ensemble-detector" },         "winRate": 0.99, "logLine": "Gen 54: Ensemble holds." },
    { "generation": 55, "attempt": { "redStrategy": "reentrancy-chain-v4",     "outcome": "blocked",   "blueCounter": "nonreentrant-modifier" },     "winRate": 0.99, "logLine": "Gen 55: Clean block." },
    { "generation": 56, "attempt": { "redStrategy": "governance-accum-v4",     "outcome": "blocked",   "blueCounter": "rate-limit+policy-proof" },   "winRate": 0.99, "logLine": "Gen 56: Policy-proof guard." },
    { "generation": 57, "attempt": { "redStrategy": "sandwich-mev-v3",         "outcome": "blocked",   "blueCounter": "mempool-preintercept-v3" },   "winRate": 0.99, "logLine": "Gen 57: Sandwich blocked." },
    { "generation": 58, "attempt": { "redStrategy": "multicall-drain-v3",      "outcome": "blocked",   "blueCounter": "call-depth-limit" },          "winRate": 0.99, "logLine": "Gen 58: Multicall blocked." },
    { "generation": 59, "attempt": { "redStrategy": "oracle-manip-v10",        "outcome": "blocked",   "blueCounter": "ensemble+adaptive" },         "winRate": 0.99, "logLine": "Gen 59: Ensemble + adaptive hold." },
    { "generation": 60, "attempt": { "redStrategy": "novel-composite",         "outcome": "blocked",   "blueCounter": "policy-proof-quorum" },       "winRate": 0.99, "logLine": "Gen 60: Policy-proof quorum holds. Loop restarts." }
  ]
}
```

- [ ] **Step 2: Create `config/immunity-propagation.json`**

```json
{
  "description": "12-protocol mesh for <ImmunityMap>. Each propagation fans out from the origin along the precomputed edges with the given per-hop delays.",
  "nodes": [
    { "id": "aave",      "label": "Aave v3",        "layoutAngle": 0 },
    { "id": "compound",  "label": "Compound v3",    "layoutAngle": 30 },
    { "id": "uniswap",   "label": "Uniswap v3",     "layoutAngle": 60 },
    { "id": "curve",     "label": "Curve",          "layoutAngle": 90 },
    { "id": "maker",     "label": "MakerDAO",       "layoutAngle": 120 },
    { "id": "lido",      "label": "Lido",           "layoutAngle": 150 },
    { "id": "balancer",  "label": "Balancer",       "layoutAngle": 180 },
    { "id": "synthetix", "label": "Synthetix",      "layoutAngle": 210 },
    { "id": "yearn",     "label": "Yearn",          "layoutAngle": 240 },
    { "id": "frax",      "label": "Frax",           "layoutAngle": 270 },
    { "id": "gmx",       "label": "GMX",            "layoutAngle": 300 },
    { "id": "pendle",    "label": "Pendle",         "layoutAngle": 330 }
  ],
  "edges": [
    { "a": "aave", "b": "compound" },
    { "a": "aave", "b": "uniswap" },
    { "a": "aave", "b": "maker" },
    { "a": "compound", "b": "uniswap" },
    { "a": "uniswap", "b": "curve" },
    { "a": "curve", "b": "balancer" },
    { "a": "curve", "b": "frax" },
    { "a": "maker", "b": "lido" },
    { "a": "lido", "b": "yearn" },
    { "a": "balancer", "b": "synthetix" },
    { "a": "synthetix", "b": "gmx" },
    { "a": "gmx", "b": "pendle" },
    { "a": "yearn", "b": "pendle" },
    { "a": "aave", "b": "yearn" },
    { "a": "compound", "b": "frax" }
  ],
  "propagation": {
    "origin": "aave",
    "hopDelayMs": 120,
    "pulseDurationMs": 2000
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add config/battlefield-prerecorded.json config/immunity-propagation.json
git commit -m "Phase 3C3: prerecorded battlefield and immunity datasets"
```

---

## Task D: `constraint_failure.py` — Scenario B flow

**Files:**
- Create: `services/defense-agent/src/defense_agent/constraint_failure.py`
- Create: `services/defense-agent/tests/test_constraint_failure.py`
- Modify: `services/defense-agent/src/defense_agent/__main__.py`

- [ ] **Step 1: Write the failing test**

Create `services/defense-agent/tests/test_constraint_failure.py`:

```python
"""Scenario B — agent asks for a proof it can't get, then submits
empty bytes to the on-chain verifier to produce the visible reject."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from defense_agent.constraint_failure import run_constraint_failure_flow
from defense_agent.prover_client import PolicyRuleNotFoundError


class _FakePublisher:
    def __init__(self) -> None:
        self.published: list[tuple[str, dict]] = []

    async def publish(self, channel: str, payload: str) -> None:
        self.published.append((channel, json.loads(payload)))


@pytest.mark.asyncio
async def test_publishes_rejected_when_prover_returns_422_and_chain_reverts() -> None:
    publisher = _FakePublisher()

    prover = MagicMock()
    prover.prove_policy.side_effect = PolicyRuleNotFoundError(
        "POLICY_RULE_NOT_FOUND"
    )

    # web3 mock: verifyAndExecute reverts with INVALID_PROOF.
    from web3.exceptions import ContractLogicError

    w3 = MagicMock()
    w3.eth.chain_id = 31337
    w3.eth.gas_price = 1_000_000_000
    w3.eth.get_transaction_count.return_value = 0
    w3.eth.send_raw_transaction.side_effect = ContractLogicError(
        "execution reverted: PolicyRegistry: invalid proof"
    )

    addresses = {
        "PolicyRegistry": "0x" + "11" * 20,
        "PauseController": "0x" + "22" * 20,
    }
    threat = {
        "eventId": "0x" + "ab" * 32,
        "pattern": "OPERATOR_OVERRIDE",
        "victimProtocol": "0x" + "33" * 20,
        "confidence": 10000,
    }

    await run_constraint_failure_flow(
        w3=w3,
        addresses=addresses,
        publisher=publisher,
        prover=prover,
        agent_key=(
            "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
        ),
        threat=threat,
    )

    channels = [c for c, _ in publisher.published]
    assert "sentinel.defense.submitted" in channels
    assert "sentinel.defense.rejected" in channels
    rejected = [p for c, p in publisher.published if c == "sentinel.defense.rejected"][0]
    assert rejected["reason"] == "INVALID_PROOF"
    assert rejected["eventId"] == threat["eventId"]
```

Add to `services/defense-agent/pyproject.toml` `[tool.pytest.ini_options]` (if not already there) `asyncio_mode = "auto"`.

- [ ] **Step 2: Run it — confirm it fails**

Run: `cd services/defense-agent && poetry run pytest tests/test_constraint_failure.py -vv`
Expected: ImportError on `defense_agent.constraint_failure`.

- [ ] **Step 3: Create `services/defense-agent/src/defense_agent/constraint_failure.py`**

```python
"""Scenario B — Agent Constraint Failure.

The agent constructs a defense action for a pattern with no policy rule
(e.g. OPERATOR_OVERRIDE), asks zk-prover for a PolicyCompliance proof,
receives 422, then submits verifyAndExecute with EMPTY proof bytes so
that PolicyVerifier (which now rejects empty under Phase 3A) causes
PolicyRegistry to revert with INVALID_PROOF. That revert is the visible
demo moment.

The rejection event is published so the api-gateway can fan it out as a
TRUST_COLLAPSE_CUE with state=REJECTED.
"""
from __future__ import annotations

import json
from typing import Any

import redis.asyncio as redis
import structlog
from eth_account import Account
from eth_utils import function_signature_to_4byte_selector, keccak
from web3 import Web3
from web3.exceptions import ContractLogicError

from .prover_client import (
    PolicyRuleNotFoundError,
    ProverClient,
    ProverUnavailableError,
)

log = structlog.get_logger()


def _encode_pause_call(victim: str, event_id: str) -> bytes:
    selector = function_signature_to_4byte_selector("activate(address,uint8,bytes32)")
    victim_addr = bytes.fromhex(victim.replace("0x", "").lower().rjust(40, "0"))
    padded_addr = b"\x00" * 12 + victim_addr[-20:]
    padded_enum = (1).to_bytes(32, "big")  # DefenseType.Pause
    event_bytes = bytes.fromhex(event_id.replace("0x", "").ljust(64, "0"))[:32]
    return selector + padded_addr + padded_enum + event_bytes


async def run_constraint_failure_flow(
    *,
    w3: Web3,
    addresses: dict[str, str],
    publisher: redis.Redis,
    prover: ProverClient,
    agent_key: str,
    threat: dict[str, Any],
) -> None:
    event_id = threat["eventId"]
    victim = threat["victimProtocol"]
    pattern = threat["pattern"]

    pause_controller = Web3.to_checksum_address(addresses["PauseController"])
    policy_registry = Web3.to_checksum_address(addresses["PolicyRegistry"])

    action = _encode_pause_call(victim, event_id)
    action_hash = keccak(
        bytes.fromhex(pause_controller.replace("0x", "")) + action
    )
    event_id_bytes = bytes.fromhex(event_id.replace("0x", "").ljust(64, "0"))[:32]

    # 1. Ask the prover. Expect 422 for unknown patterns.
    proof_bytes = b""
    try:
        prover.prove_policy(
            {
                "actionHash": "0x" + action_hash.hex(),
                "eventId": event_id,
                "pattern": pattern,
                "victimProtocol": victim,
                "confidence": threat.get("confidence", 0),
            }
        )
    except PolicyRuleNotFoundError:
        log.info(
            "constraint_failure.prover_rejected",
            event_id=event_id,
            pattern=pattern,
        )
        await publisher.publish(
            "sentinel.prover.finished",
            json.dumps(
                {
                    "schema": "ProofFinishedEvent@1",
                    "eventId": event_id,
                    "status": "failed",
                    "reason": "POLICY_RULE_NOT_FOUND",
                }
            ),
        )
    except ProverUnavailableError as exc:
        log.error("constraint_failure.prover_unavailable", err=str(exc))
        await publisher.publish(
            "sentinel.alerts",
            json.dumps(
                {
                    "schema": "AlertEvent@1",
                    "severity": "error",
                    "message": f"prover unavailable: {exc}",
                    "eventId": event_id,
                }
            ),
        )
        return

    # 2. Read current policy hash for public inputs.
    current_policy_hash = w3.eth.contract(
        address=policy_registry,
        abi=[
            {
                "inputs": [],
                "name": "currentPolicyHash",
                "outputs": [{"type": "bytes32"}],
                "stateMutability": "view",
                "type": "function",
            },
        ],
    ).functions.currentPolicyHash().call()

    # 3. Submit verifyAndExecute with empty proof — expected to revert.
    account = Account.from_key(agent_key)
    public_inputs = [action_hash, current_policy_hash, event_id_bytes]

    policy_contract = w3.eth.contract(
        address=policy_registry,
        abi=[
            {
                "inputs": [
                    {"type": "address", "name": "target"},
                    {"type": "bytes", "name": "action"},
                    {"type": "bytes", "name": "proof"},
                    {"type": "bytes32[]", "name": "publicInputs"},
                ],
                "name": "verifyAndExecute",
                "outputs": [{"type": "bool"}],
                "stateMutability": "nonpayable",
                "type": "function",
            },
        ],
    )
    tx = policy_contract.functions.verifyAndExecute(
        pause_controller, action, proof_bytes, public_inputs
    ).build_transaction(
        {
            "from": account.address,
            "nonce": w3.eth.get_transaction_count(account.address, "pending"),
            "gas": 500_000,
            "gasPrice": w3.eth.gas_price,
            "chainId": w3.eth.chain_id,
        }
    )
    signed = account.sign_transaction(tx)
    raw = getattr(signed, "raw_transaction", None) or getattr(
        signed, "rawTransaction", None
    )

    await publisher.publish(
        "sentinel.defense.submitted",
        json.dumps(
            {
                "schema": "DefenseSubmittedEvent@1",
                "eventId": event_id,
                "pattern": pattern,
                "primitive": "Pause",
                "target": victim,
                "txHash": "0x" + "00" * 32,  # pre-submit; updated on send
                "actionHash": "0x" + action_hash.hex(),
                "scenario": "constraint_failure",
            }
        ),
    )

    try:
        w3.eth.send_raw_transaction(raw)
    except ContractLogicError as exc:
        reason = "INVALID_PROOF"
        msg = str(exc)
        if "stale policy" in msg:
            reason = "STALE_POLICY"
        await publisher.publish(
            "sentinel.defense.rejected",
            json.dumps(
                {
                    "schema": "DefenseRejectedEvent@1",
                    "eventId": event_id,
                    "pattern": pattern,
                    "target": victim,
                    "reason": reason,
                    "revertReason": msg,
                }
            ),
        )
        log.info("constraint_failure.reverted", event_id=event_id, reason=reason)
        return

    # If the tx did NOT revert, something is wrong (PolicyVerifier bug).
    # Publish a loud alert; the demo narration relies on the revert.
    await publisher.publish(
        "sentinel.alerts",
        json.dumps(
            {
                "schema": "AlertEvent@1",
                "severity": "critical",
                "message": (
                    "Scenario B submitted empty proof and the chain "
                    "ACCEPTED it — PolicyVerifier is misconfigured."
                ),
                "eventId": event_id,
            }
        ),
    )
```

- [ ] **Step 4: Wiring verification (P4b already did this — just confirm)**

P4b already added `from .constraint_failure import run_constraint_failure_flow` and routes unknown patterns into `run_constraint_failure_flow`. Grep to confirm nothing regressed:

Run:
```bash
grep -n "run_constraint_failure_flow" services/defense-agent/src/defense_agent/__main__.py
```
Expected: two matches — the import and the call site inside `submit_defense`.

- [ ] **Step 5: Run all defense-agent tests**

Run: `cd services/defense-agent && poetry run pytest -vv`
Expected: `test_prover_client.py` (3), `test_happy_path.py` (1), `test_constraint_failure.py` (1) all PASS.

- [ ] **Step 6: Commit**

```bash
git add services/defense-agent/src/defense_agent/constraint_failure.py services/defense-agent/tests/test_constraint_failure.py
git commit -m "Phase 3D: Scenario B constraint-failure flow (empty proof → on-chain INVALID_PROOF revert)"
```

---

## Task E1: api-gateway subscribes to rejected channel and derives cue

**Files:**
- Create: `services/api-gateway/src/cues.ts`
- Create: `services/api-gateway/src/cues.test.ts`
- Modify: `services/api-gateway/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `services/api-gateway/src/cues.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { deriveTrustCues, EventEnvelope } from "./cues.js";

function env(kind: string, data: unknown): EventEnvelope {
    return {
        channel: "",
        messageId: "m",
        emittedAt: "2026-04-15T00:00:00Z",
        kind,
        data,
    };
}

describe("deriveTrustCues", () => {
    it("emits AMBIGUITY on THREAT_CONFIRMED", () => {
        const cues = deriveTrustCues(
            env("THREAT_CONFIRMED", { eventId: "0x1", pattern: "FLASH_LOAN_ORACLE_MANIP" })
        );
        expect(cues).toEqual([
            expect.objectContaining({ state: "AMBIGUITY", eventId: "0x1" }),
        ]);
    });

    it("emits SUSPICION on DEFENSE_SUBMITTED", () => {
        const cues = deriveTrustCues(
            env("DEFENSE_SUBMITTED", { eventId: "0x1", txHash: "0xabc" })
        );
        expect(cues[0].state).toBe("SUSPICION");
    });

    it("emits PROOF_INJECTION + RESOLVED on DEFENSE_MINED", () => {
        const cues = deriveTrustCues(
            env("DEFENSE_MINED", {
                eventId: "0x1",
                txHash: "0xabc",
                blockNumber: 7,
                proofDigest: "0xd",
            })
        );
        expect(cues.map((c) => c.state)).toEqual(["PROOF_INJECTION", "RESOLVED"]);
    });

    it("emits REJECTED on DEFENSE_REJECTED with the revert reason", () => {
        const cues = deriveTrustCues(
            env("DEFENSE_REJECTED", {
                eventId: "0x1",
                reason: "INVALID_PROOF",
                pattern: "OPERATOR_OVERRIDE",
                revertReason: "PolicyRegistry: invalid proof",
            })
        );
        expect(cues).toEqual([
            expect.objectContaining({
                state: "REJECTED",
                eventId: "0x1",
                reason: "INVALID_PROOF",
            }),
        ]);
    });
});
```

- [ ] **Step 2: Run it — confirm it fails**

Run: `cd services/api-gateway && pnpm vitest run src/cues.test.ts`
Expected: module not found.

- [ ] **Step 3: Create `services/api-gateway/src/cues.ts`**

```typescript
export interface EventEnvelope {
    channel: string;
    messageId: string;
    emittedAt: string;
    kind: string;
    data: unknown;
}

export interface TrustCollapseCue {
    kind: "TRUST_COLLAPSE_CUE";
    eventId: string | null;
    state: "AMBIGUITY" | "SUSPICION" | "PROOF_INJECTION" | "RESOLVED" | "REJECTED";
    message: string;
    underlyingTxHash?: string | null;
    proofDigest?: string | null;
    reason?: string;
    revertReason?: string;
}

export function redisChannelToKind(ch: string): string {
    const map: Record<string, string> = {
        "sentinel.mempool.pending": "PENDING_TX",
        "sentinel.mempool.block": "BLOCK",
        "sentinel.detection.candidate": "THREAT_CANDIDATE",
        "sentinel.detection.confirmed": "THREAT_CONFIRMED",
        "sentinel.defense.submitted": "DEFENSE_SUBMITTED",
        "sentinel.defense.mined": "DEFENSE_MINED",
        "sentinel.defense.rejected": "DEFENSE_REJECTED",
        "sentinel.counterfactual.ready": "COUNTERFACTUAL_READY",
        "sentinel.ledger.recorded": "LEDGER_RECORDED",
        "sentinel.prover.started": "PROVER_STARTED",
        "sentinel.prover.finished": "PROVER_FINISHED",
    };
    return map[ch] ?? ch.toUpperCase();
}

export function deriveTrustCues(env: EventEnvelope): TrustCollapseCue[] {
    const cues: TrustCollapseCue[] = [];
    const data = (env.data ?? {}) as Record<string, unknown>;

    if (env.kind === "THREAT_CONFIRMED") {
        cues.push({
            kind: "TRUST_COLLAPSE_CUE",
            eventId: (data.eventId as string) ?? null,
            state: "AMBIGUITY",
            message: `Threat detected: ${data.pattern ?? "UNKNOWN"}`,
        });
    }
    if (env.kind === "DEFENSE_SUBMITTED") {
        cues.push({
            kind: "TRUST_COLLAPSE_CUE",
            eventId: (data.eventId as string) ?? null,
            state: "SUSPICION",
            message: `Defense tx submitted: ${data.txHash ?? "(pending)"}`,
            underlyingTxHash: (data.txHash as string) ?? null,
        });
    }
    if (env.kind === "DEFENSE_MINED") {
        cues.push({
            kind: "TRUST_COLLAPSE_CUE",
            eventId: (data.eventId as string) ?? null,
            state: "PROOF_INJECTION",
            message: `Defense mined at block #${data.blockNumber ?? "?"}`,
            underlyingTxHash: (data.txHash as string) ?? null,
        });
        cues.push({
            kind: "TRUST_COLLAPSE_CUE",
            eventId: (data.eventId as string) ?? null,
            state: "RESOLVED",
            message: "Action verified on-chain.",
            proofDigest: (data.proofDigest as string) ?? null,
        });
    }
    if (env.kind === "DEFENSE_REJECTED") {
        cues.push({
            kind: "TRUST_COLLAPSE_CUE",
            eventId: (data.eventId as string) ?? null,
            state: "REJECTED",
            message: `On-chain verifier rejected: ${data.reason ?? "UNKNOWN"}`,
            reason: (data.reason as string) ?? undefined,
            revertReason: (data.revertReason as string) ?? undefined,
        });
    }
    return cues;
}
```

- [ ] **Step 4: Add vitest to api-gateway if not already there**

Check `services/api-gateway/package.json`. If it does not have `vitest` in devDependencies, add:

```json
"devDependencies": {
    "vitest": "1.4.0"
},
"scripts": {
    "test": "vitest run"
}
```

Run: `pnpm install` at the repo root.

- [ ] **Step 5: Run the tests — they pass**

Run: `cd services/api-gateway && pnpm test`
Expected: 4 PASSED.

- [ ] **Step 6: Wire into `index.ts`**

Edit `services/api-gateway/src/index.ts`:

- Remove the local `redisChannelToKind` function (lines 56-68) and the `deriveTrustCues` function (lines 310-346).
- At the top, add: `import { deriveTrustCues, redisChannelToKind, EventEnvelope } from "./cues.js";`
- Add `"sentinel.defense.rejected"` to the `FIREHOSE_CHANNELS` array.

- [ ] **Step 7: Verify api-gateway still compiles**

Run: `cd services/api-gateway && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add services/api-gateway/src/cues.ts services/api-gateway/src/cues.test.ts services/api-gateway/src/index.ts services/api-gateway/package.json
git commit -m "Phase 3E1: api-gateway fans out defense.rejected and emits REJECTED trust cue"
```

---

## Task E2: REST routes for `/api/v1/ledger`, `/api/v1/policy/current`, `/api/v1/events/:id`

**Files:**
- Create: `services/api-gateway/src/routes/ledger.ts`
- Create: `services/api-gateway/src/routes/policy.ts`
- Create: `services/api-gateway/src/routes/events.ts`
- Modify: `services/api-gateway/src/index.ts`

- [ ] **Step 1: Create `services/api-gateway/src/routes/policy.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createPublicClient, http, parseAbi } from "viem";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const POLICY_PATH = process.env.POLICY_PATH ?? "../../config/policy.json";

export async function registerPolicyRoutes(
    app: FastifyInstance,
    addresses: Record<string, string>
): Promise<void> {
    app.get("/api/v1/policy/current", async (_req, reply) => {
        const policyJson = readFileSync(POLICY_PATH, "utf-8");
        const canonical = JSON.stringify(JSON.parse(policyJson));
        const expectedHash =
            "0x" + createHash("sha256").update(canonical).digest("hex");

        const client = createPublicClient({ transport: http(RPC_URL) });
        const onChain = await client.readContract({
            address: addresses.PolicyRegistry as `0x${string}`,
            abi: parseAbi([
                "function currentPolicyHash() view returns (bytes32)",
                "function policyVersion() view returns (uint256)",
            ]),
            functionName: "currentPolicyHash",
        });
        const version = await client.readContract({
            address: addresses.PolicyRegistry as `0x${string}`,
            abi: parseAbi(["function policyVersion() view returns (uint256)"]),
            functionName: "policyVersion",
        });

        return {
            hash: onChain,
            expectedHash,
            version: Number(version),
            matches: onChain.toLowerCase() === expectedHash.toLowerCase(),
            document: JSON.parse(policyJson),
        };
    });
}
```

- [ ] **Step 2: Create `services/api-gateway/src/routes/ledger.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import { createPublicClient, http, parseAbi } from "viem";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";

const LEDGER_ABI = parseAbi([
    "function getEntryCount() view returns (uint256)",
    "function getEntryAt(uint256 index) view returns ((bytes32 eventId,uint256 atBlock,int256 deltaWei,bytes32 realTxHash,bytes32 counterfactualRoot,bytes32 proofDigest,uint256 recordedAt))",
    "function getEntry(bytes32 eventId) view returns ((bytes32 eventId,uint256 atBlock,int256 deltaWei,bytes32 realTxHash,bytes32 counterfactualRoot,bytes32 proofDigest,uint256 recordedAt))",
]);

export async function registerLedgerRoutes(
    app: FastifyInstance,
    addresses: Record<string, string>,
    counterfactualTrees: Map<string, unknown>
): Promise<void> {
    app.get("/api/v1/ledger", async () => {
        const client = createPublicClient({ transport: http(RPC_URL) });
        const addr = addresses.CounterfactualLedger as `0x${string}`;
        const count = await client.readContract({
            address: addr,
            abi: LEDGER_ABI,
            functionName: "getEntryCount",
        });
        const total = Number(count);
        const entries: unknown[] = [];
        let totalDelta = 0n;
        for (let i = 0; i < total; i++) {
            const e = await client.readContract({
                address: addr,
                abi: LEDGER_ABI,
                functionName: "getEntryAt",
                args: [BigInt(i)],
            });
            entries.push({
                eventId: e.eventId,
                atBlock: Number(e.atBlock),
                deltaWei: e.deltaWei.toString(),
                realTxHash: e.realTxHash,
                counterfactualRoot: e.counterfactualRoot,
                proofDigest: e.proofDigest,
                recordedAt: Number(e.recordedAt),
            });
            totalDelta += e.deltaWei;
        }
        return {
            entries: entries.reverse(),
            totalDeltaWei: totalDelta.toString(),
            totalEntryCount: total,
        };
    });

    app.get<{ Params: { eventId: string } }>(
        "/api/v1/ledger/:eventId/counterfactual-tree",
        async (req, reply) => {
            const tree = counterfactualTrees.get(req.params.eventId);
            if (!tree) {
                reply.code(404);
                return { error: { code: "NOT_FOUND", message: "no tree cached" } };
            }
            return tree;
        }
    );
}
```

- [ ] **Step 3: Create `services/api-gateway/src/routes/events.ts`**

```typescript
import type { FastifyInstance } from "fastify";
import type { EventEnvelope } from "../cues.js";

export async function registerEventsRoutes(
    app: FastifyInstance,
    recentEvents: EventEnvelope[]
): Promise<void> {
    app.get<{ Params: { eventId: string } }>(
        "/api/v1/events/:eventId",
        async (req, reply) => {
            const id = req.params.eventId.toLowerCase();
            const matches = recentEvents.filter((e) => {
                const d = (e.data ?? {}) as Record<string, unknown>;
                return (
                    typeof d.eventId === "string" &&
                    d.eventId.toLowerCase() === id
                );
            });
            if (matches.length === 0) {
                reply.code(404);
                return { error: { code: "NOT_FOUND", message: "event not found" } };
            }
            return { eventId: id, envelopes: matches };
        }
    );
}
```

- [ ] **Step 4: Mount them from `index.ts`**

In `services/api-gateway/src/index.ts`, after the existing REST routes and before the WS registration, add:

```typescript
import { registerLedgerRoutes } from "./routes/ledger.js";
import { registerPolicyRoutes } from "./routes/policy.js";
import { registerEventsRoutes } from "./routes/events.js";

// Counterfactual trees are populated when `sentinel.counterfactual.ready`
// fires with a leaves[] payload (counterfactual-sim service).
const counterfactualTrees = new Map<string, unknown>();

await registerPolicyRoutes(app, addresses);
await registerLedgerRoutes(app, addresses, counterfactualTrees);
await registerEventsRoutes(app, RECENT_EVENTS);
```

Also, in the `sub.on("message", ...)` handler, when `env.kind === "COUNTERFACTUAL_READY"`, capture the tree if `data.leaves` is present:

```typescript
if (env.kind === "COUNTERFACTUAL_READY") {
    const d = envelope.data as Record<string, unknown>;
    if (d.eventId && d.leaves) {
        counterfactualTrees.set(String(d.eventId), {
            root: d.counterfactualRoot,
            leaves: d.leaves,
        });
    }
}
```

- [ ] **Step 5: Manual end-to-end smoke**

Start the services (`docker compose up` or individually). Run:

```bash
curl -s http://localhost:8080/api/v1/policy/current | jq .
curl -s http://localhost:8080/api/v1/ledger | jq .
```
Expected: both return JSON matching the shapes above. `/policy/current` returns `matches: true` if Phase 2 committed the canonical policy hash.

- [ ] **Step 6: Commit**

```bash
git add services/api-gateway/src/routes/ services/api-gateway/src/index.ts
git commit -m "Phase 3E2: /api/v1/{ledger,policy/current,events/:id} REST endpoints"
```

---

## Task F: Frontend — TrustInterface REJECTED branch

**Files:**
- Modify: `frontend/src/store.ts`
- Modify: `frontend/src/components/TrustInterface.tsx` (assumed to exist from Phase 2)
- Create: `frontend/src/components/TrustInterface.test.tsx`

- [ ] **Step 1: Extend the store to carry REJECTED state**

Edit `frontend/src/store.ts`. Change the `TrustPhase` type and `applyTrustCue` map:

```typescript
export type TrustPhase =
    | "idle"
    | "ambiguity"
    | "suspicion"
    | "proof"
    | "resolved"
    | "rejected";

export interface TrustState {
    eventId: string | null;
    phase: TrustPhase;
    message: string;
    underlyingTxHash: string | null;
    proofDigest: string | null;
    reason: string | null;         // new, populated on REJECTED
    revertReason: string | null;   // new
}
```

Update `initialTrust` to include `reason: null, revertReason: null`.

In `applyTrustCue`, extend `phaseMap` and the setter:

```typescript
const phaseMap: Record<string, TrustPhase> = {
    AMBIGUITY: "ambiguity",
    SUSPICION: "suspicion",
    PROOF_INJECTION: "proof",
    RESOLVED: "resolved",
    REJECTED: "rejected",
};
// ... and in the set():
set({
    trust: {
        eventId: cue.eventId ?? null,
        phase: next,
        message: cue.message ?? "",
        underlyingTxHash: cue.underlyingTxHash ?? null,
        proofDigest: cue.proofDigest ?? null,
        reason: cue.reason ?? null,
        revertReason: cue.revertReason ?? null,
    },
});
```

- [ ] **Step 2: Write the failing component test**

Create `frontend/src/components/TrustInterface.test.tsx`. (Add `@testing-library/react`, `@testing-library/jest-dom`, `vitest`, `jsdom` to `frontend/package.json` devDeps if missing, and `vitest.config.ts` with `environment: "jsdom"`.)

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import TrustInterface from "./TrustInterface";
import { useStore } from "../store";

describe("<TrustInterface>", () => {
    beforeEach(() => {
        useStore.getState().reset();
    });

    it("renders the REJECTED panel with the revert reason", () => {
        useStore.setState({
            trust: {
                eventId: "0xabc",
                phase: "rejected",
                message: "On-chain verifier rejected: INVALID_PROOF",
                underlyingTxHash: null,
                proofDigest: null,
                reason: "INVALID_PROOF",
                revertReason: "PolicyRegistry: invalid proof",
            },
        });
        render(<TrustInterface />);
        expect(screen.getByText(/INVALID_PROOF/i)).toBeInTheDocument();
        expect(
            screen.getByText(/PolicyRegistry: invalid proof/i)
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Action cannot be proven/i)
        ).toBeInTheDocument();
    });
});
```

- [ ] **Step 3: Run — confirm failure**

Run: `cd frontend && pnpm vitest run`
Expected: `REJECTED` branch not rendered.

- [ ] **Step 4: Add the REJECTED branch to `TrustInterface.tsx`**

In the existing `frontend/src/components/TrustInterface.tsx` (Phase 2 deliverable), add a new render branch. If the component currently renders a switch on `phase`, add:

```tsx
{phase === "rejected" && (
    <section className="trust-panel trust-panel--rejected">
        <h2>REJECTED</h2>
        <p className="trust-panel__reason">
            <strong>{reason ?? "INVALID_PROOF"}</strong>
        </p>
        <pre className="trust-panel__revert-reason">
            {revertReason ?? "PolicyRegistry rejected the submission."}
        </pre>
        <p className="trust-panel__footer">
            Final: action cannot be proven. Math stopped it.
        </p>
    </section>
)}
```

Destructure `reason` and `revertReason` from the store alongside the existing fields.

- [ ] **Step 5: Run the tests — they pass**

Run: `cd frontend && pnpm vitest run`
Expected: the new test passes; prior tests still pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store.ts frontend/src/components/TrustInterface.tsx frontend/src/components/TrustInterface.test.tsx
git commit -m "Phase 3F: TrustInterface renders REJECTED branch (Scenario B)"
```

---

## Task G: `<BattlefieldViz>` — loops prerecorded JSON

**Files:**
- Create: `frontend/src/components/BattlefieldViz.tsx`
- Create: `frontend/src/components/BattlefieldViz.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/BattlefieldViz.test.tsx`:

```typescript
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import BattlefieldViz from "./BattlefieldViz";

const fixtureTicks = [
    {
        generation: 1,
        attempt: { redStrategy: "s1", outcome: "succeeded", blueCounter: null },
        winRate: 0.1,
        logLine: "Gen 1 log",
    },
    {
        generation: 2,
        attempt: { redStrategy: "s2", outcome: "blocked", blueCounter: "c2" },
        winRate: 0.5,
        logLine: "Gen 2 log",
    },
];

describe("<BattlefieldViz>", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("advances through the ticks and loops", () => {
        render(<BattlefieldViz ticks={fixtureTicks} tickIntervalMs={100} />);
        expect(screen.getByText(/Generation 1/)).toBeInTheDocument();
        act(() => {
            vi.advanceTimersByTime(100);
        });
        expect(screen.getByText(/Generation 2/)).toBeInTheDocument();
        act(() => {
            vi.advanceTimersByTime(100);
        });
        expect(screen.getByText(/Generation 1/)).toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `cd frontend && pnpm vitest run BattlefieldViz`
Expected: module not found.

- [ ] **Step 3: Create `frontend/src/components/BattlefieldViz.tsx`**

```typescript
import { useEffect, useState } from "react";

export interface BattlefieldTick {
    generation: number;
    attempt: {
        redStrategy: string;
        outcome: "blocked" | "partial" | "succeeded";
        blueCounter: string | null;
    };
    winRate: number;
    logLine: string;
}

interface Props {
    ticks: BattlefieldTick[];
    tickIntervalMs: number;
}

export default function BattlefieldViz({ ticks, tickIntervalMs }: Props) {
    const [idx, setIdx] = useState(0);
    useEffect(() => {
        if (ticks.length === 0) return;
        const interval = setInterval(() => {
            setIdx((n) => (n + 1) % ticks.length);
        }, tickIntervalMs);
        return () => clearInterval(interval);
    }, [ticks.length, tickIntervalMs]);

    if (ticks.length === 0) return <div>Loading battlefield telemetry…</div>;
    const cur = ticks[idx];
    const outcomeColor =
        cur.attempt.outcome === "blocked"
            ? "#36c88b"
            : cur.attempt.outcome === "partial"
            ? "#d47d27"
            : "#f55";
    return (
        <div className="battlefield-viz">
            <header>
                <span>Generation {cur.generation}</span>
                <span>Blue win rate: {(cur.winRate * 100).toFixed(0)}%</span>
            </header>
            <div className="battlefield-viz__row">
                <div className="battlefield-viz__red">Red: {cur.attempt.redStrategy}</div>
                <div
                    className="battlefield-viz__arrow"
                    style={{ background: outcomeColor }}
                />
                <div className="battlefield-viz__blue">
                    Blue: {cur.attempt.blueCounter ?? "—"}
                </div>
            </div>
            <p className="battlefield-viz__log">{cur.logLine}</p>
        </div>
    );
}
```

- [ ] **Step 4: Run the tests — they pass**

Run: `cd frontend && pnpm vitest run BattlefieldViz`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BattlefieldViz.tsx frontend/src/components/BattlefieldViz.test.tsx
git commit -m "Phase 3G: <BattlefieldViz> loops prerecorded Red/Blue ticks"
```

---

## Task H: `<ImmunityMap>` — triggered propagation

**Files:**
- Create: `frontend/src/components/ImmunityMap.tsx`
- Create: `frontend/src/components/ImmunityMap.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ImmunityMap.test.tsx`:

```typescript
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ImmunityMap from "./ImmunityMap";

const graph = {
    nodes: [
        { id: "a", label: "A", layoutAngle: 0 },
        { id: "b", label: "B", layoutAngle: 180 },
    ],
    edges: [{ a: "a", b: "b" }],
    propagation: { origin: "a", hopDelayMs: 50, pulseDurationMs: 200 },
};

describe("<ImmunityMap>", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("pulses the origin then reaches the neighbour after hopDelayMs", () => {
        const { container } = render(<ImmunityMap data={graph} trigger={1} />);
        expect(container.querySelector('[data-node="a"][data-lit="true"]')).not.toBeNull();
        expect(container.querySelector('[data-node="b"][data-lit="true"]')).toBeNull();
        act(() => vi.advanceTimersByTime(60));
        expect(container.querySelector('[data-node="b"][data-lit="true"]')).not.toBeNull();
    });
});
```

- [ ] **Step 2: Run — confirm failure**

Run: `cd frontend && pnpm vitest run ImmunityMap`
Expected: module not found.

- [ ] **Step 3: Create `frontend/src/components/ImmunityMap.tsx`**

```typescript
import { useEffect, useMemo, useState } from "react";

interface Node {
    id: string;
    label: string;
    layoutAngle: number;
}
interface Edge {
    a: string;
    b: string;
}
interface ImmunityGraph {
    nodes: Node[];
    edges: Edge[];
    propagation: {
        origin: string;
        hopDelayMs: number;
        pulseDurationMs: number;
    };
}

interface Props {
    data: ImmunityGraph;
    /** Incrementing number: each change triggers a new propagation run. */
    trigger: number;
}

function bfsOrder(graph: ImmunityGraph): string[] {
    const adj = new Map<string, Set<string>>();
    for (const n of graph.nodes) adj.set(n.id, new Set());
    for (const e of graph.edges) {
        adj.get(e.a)?.add(e.b);
        adj.get(e.b)?.add(e.a);
    }
    const order: string[] = [];
    const seen = new Set<string>();
    const queue = [graph.propagation.origin];
    while (queue.length > 0) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        order.push(id);
        for (const next of adj.get(id) ?? []) {
            if (!seen.has(next)) queue.push(next);
        }
    }
    return order;
}

export default function ImmunityMap({ data, trigger }: Props) {
    const order = useMemo(() => bfsOrder(data), [data]);
    const [lit, setLit] = useState<Set<string>>(new Set());

    useEffect(() => {
        setLit(new Set([data.propagation.origin]));
        const timers: ReturnType<typeof setTimeout>[] = [];
        for (let i = 1; i < order.length; i++) {
            const delay = i * data.propagation.hopDelayMs;
            const id = order[i];
            timers.push(
                setTimeout(() => {
                    setLit((prev) => {
                        const next = new Set(prev);
                        next.add(id);
                        return next;
                    });
                }, delay)
            );
        }
        return () => {
            for (const t of timers) clearTimeout(t);
        };
    }, [trigger, order, data.propagation.hopDelayMs, data.propagation.origin]);

    const R = 150;
    return (
        <svg width={400} height={400} className="immunity-map">
            <g transform="translate(200 200)">
                {data.nodes.map((n) => {
                    const rad = (n.layoutAngle * Math.PI) / 180;
                    const x = Math.cos(rad) * R;
                    const y = Math.sin(rad) * R;
                    const isLit = lit.has(n.id);
                    return (
                        <g key={n.id} data-node={n.id} data-lit={isLit}>
                            <circle
                                cx={x}
                                cy={y}
                                r={isLit ? 14 : 10}
                                fill={isLit ? "#00d9ff" : "#2b2f36"}
                                stroke="#3b4048"
                            />
                            <text
                                x={x}
                                y={y + 28}
                                textAnchor="middle"
                                fill="#e2e8f0"
                                fontSize={11}
                            >
                                {n.label}
                            </text>
                        </g>
                    );
                })}
            </g>
        </svg>
    );
}
```

- [ ] **Step 4: Run the tests — they pass**

Run: `cd frontend && pnpm vitest run ImmunityMap`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ImmunityMap.tsx frontend/src/components/ImmunityMap.test.tsx
git commit -m "Phase 3H: <ImmunityMap> pulses origin + BFS propagation"
```

---

## Task I: `<DemoOrchestrator>` + `/demo` route

**Files:**
- Create: `frontend/src/lib/demo.ts`
- Create: `frontend/src/components/DemoOrchestrator.tsx`
- Create: `frontend/src/components/DemoOrchestrator.test.tsx`
- Create: `frontend/src/pages/DemoMode.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create `frontend/src/lib/demo.ts`**

```typescript
export interface ScenarioStep {
    at: number;
    action: "banner" | "trigger" | "focus" | "publishImmunity";
    text?: string;
    endpoint?: string;
    component?: string;
}

export interface Scenario {
    name: string;
    id: string;
    steps: ScenarioStep[];
}

export function isDemoSafe(): boolean {
    return (
        (import.meta.env.VITE_SENTINEL_DEMO_SAFE as string | undefined)?.toLowerCase() ===
        "true"
    );
}

export async function loadScenario(id: string): Promise<Scenario> {
    const res = await fetch(`/config/demo-scenarios/${id}.json`);
    if (!res.ok) throw new Error(`scenario ${id} not found`);
    return (await res.json()) as Scenario;
}

export async function runTrigger(endpoint: string): Promise<void> {
    const [method, path] = endpoint.split(" ", 2);
    await fetch(path, { method: method || "POST" });
}
```

- [ ] **Step 2: Write the failing test for the orchestrator**

Create `frontend/src/components/DemoOrchestrator.test.tsx`:

```typescript
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import DemoOrchestrator from "./DemoOrchestrator";
import type { Scenario } from "../lib/demo";

const scenario: Scenario = {
    name: "test",
    id: "test",
    steps: [
        { at: 0, action: "banner", text: "start" },
        { at: 100, action: "trigger", endpoint: "POST /api/v1/demo/test" },
        { at: 200, action: "focus", component: "TrustInterface" },
    ],
};

describe("<DemoOrchestrator>", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("dispatches steps in order and invokes the trigger endpoint", () => {
        const onStep = vi.fn();
        const fetchMock = vi.fn(() => Promise.resolve(new Response("", { status: 200 })));
        vi.stubGlobal("fetch", fetchMock);

        render(
            <DemoOrchestrator scenario={scenario} onStep={onStep} />
        );

        act(() => vi.advanceTimersByTime(0));
        expect(onStep).toHaveBeenLastCalledWith(scenario.steps[0]);

        act(() => vi.advanceTimersByTime(100));
        expect(onStep).toHaveBeenLastCalledWith(scenario.steps[1]);
        expect(fetchMock).toHaveBeenCalledWith(
            "/api/v1/demo/test",
            expect.objectContaining({ method: "POST" })
        );

        act(() => vi.advanceTimersByTime(100));
        expect(onStep).toHaveBeenLastCalledWith(scenario.steps[2]);
    });
});
```

- [ ] **Step 3: Run — confirm failure**

Run: `cd frontend && pnpm vitest run DemoOrchestrator`
Expected: module not found.

- [ ] **Step 4: Create `frontend/src/components/DemoOrchestrator.tsx`**

```typescript
import { useEffect, useRef } from "react";
import type { Scenario, ScenarioStep } from "../lib/demo";
import { runTrigger } from "../lib/demo";

interface Props {
    scenario: Scenario;
    onStep?: (step: ScenarioStep) => void;
}

export default function DemoOrchestrator({ scenario, onStep }: Props) {
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

    useEffect(() => {
        for (const t of timers.current) clearTimeout(t);
        timers.current = [];
        for (const step of scenario.steps) {
            const t = setTimeout(() => {
                onStep?.(step);
                if (step.action === "trigger" && step.endpoint) {
                    void runTrigger(step.endpoint);
                }
            }, step.at);
            timers.current.push(t);
        }
        return () => {
            for (const t of timers.current) clearTimeout(t);
            timers.current = [];
        };
    }, [scenario.id, scenario.steps, onStep]);

    return null;
}
```

- [ ] **Step 5: Run the tests**

Run: `cd frontend && pnpm vitest run DemoOrchestrator`
Expected: PASS.

- [ ] **Step 6: Create `frontend/src/pages/DemoMode.tsx`**

```typescript
import { useEffect, useState } from "react";
import DemoOrchestrator from "../components/DemoOrchestrator";
import TrustInterface from "../components/TrustInterface";
import BattlefieldViz from "../components/BattlefieldViz";
import ImmunityMap from "../components/ImmunityMap";
import { loadScenario, isDemoSafe } from "../lib/demo";
import type { Scenario, ScenarioStep } from "../lib/demo";

export default function DemoMode() {
    const [scenario, setScenario] = useState<Scenario | null>(null);
    const [focus, setFocus] = useState<string>("TrustInterface");
    const [immunityTrigger, setImmunityTrigger] = useState<number>(0);
    const [battlefield, setBattlefield] = useState<any>(null);
    const [immunity, setImmunity] = useState<any>(null);
    const demoSafe = isDemoSafe();

    useEffect(() => {
        void (async () => {
            setScenario(await loadScenario("flash-loan-oracle"));
            const [b, i] = await Promise.all([
                fetch("/config/battlefield-prerecorded.json").then((r) => r.json()),
                fetch("/config/immunity-propagation.json").then((r) => r.json()),
            ]);
            setBattlefield(b);
            setImmunity(i);
        })();
    }, []);

    function handleStep(step: ScenarioStep) {
        if (step.action === "focus" && step.component) setFocus(step.component);
        if (step.action === "publishImmunity") {
            setImmunityTrigger((n) => n + 1);
        }
    }

    return (
        <main className={`demo-mode ${demoSafe ? "demo-mode--safe" : ""}`}>
            <section className={focus === "TrustInterface" ? "focus" : "tile"}>
                <TrustInterface />
            </section>
            {battlefield && (
                <section className={focus === "BattlefieldViz" ? "focus" : "tile"}>
                    <BattlefieldViz
                        ticks={battlefield.ticks}
                        tickIntervalMs={
                            demoSafe
                                ? battlefield.tickIntervalMs * 2
                                : battlefield.tickIntervalMs
                        }
                    />
                </section>
            )}
            {immunity && (
                <section className={focus === "ImmunityMap" ? "focus" : "tile"}>
                    <ImmunityMap data={immunity} trigger={immunityTrigger} />
                </section>
            )}
            {scenario && (
                <DemoOrchestrator scenario={scenario} onStep={handleStep} />
            )}
        </main>
    );
}
```

- [ ] **Step 7: Add the `/demo` route to the existing router (from P5a)**

P5a installed `BrowserRouter` + `/` + `/event/:eventId` routes. Add one line for `/demo`.

Edit `frontend/src/App.tsx`:

- Add `import DemoMode from "./pages/DemoMode";` to the imports.
- Add `<Route path="/demo" element={<DemoMode />} />` inside the existing `<Routes>`.

Verify:
```bash
grep -n "DemoMode" frontend/src/App.tsx
```
Expected: two matches (import + Route).

- [ ] **Step 8: Configure Vite to serve `/config/*.json`**

The demo files live in `config/`. Add a symlink or static-copy to `frontend/public/config/`:

Run:
```bash
mkdir -p frontend/public/config/demo-scenarios
ln -sf ../../../config/policy.json frontend/public/config/policy.json
ln -sf ../../../config/timings.json frontend/public/config/timings.json
ln -sf ../../../config/battlefield-prerecorded.json frontend/public/config/battlefield-prerecorded.json
ln -sf ../../../config/immunity-propagation.json frontend/public/config/immunity-propagation.json
ln -sf ../../../../config/demo-scenarios/flash-loan-oracle.json frontend/public/config/demo-scenarios/flash-loan-oracle.json
ln -sf ../../../../config/demo-scenarios/agent-constraint.json frontend/public/config/demo-scenarios/agent-constraint.json
```

Verify with `ls -l frontend/public/config/`.

- [ ] **Step 9: Run all frontend tests**

Run: `cd frontend && pnpm vitest run && pnpm build`
Expected: all tests PASS and the build succeeds.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/lib/demo.ts frontend/src/components/DemoOrchestrator.tsx frontend/src/components/DemoOrchestrator.test.tsx frontend/src/pages/DemoMode.tsx frontend/src/App.tsx frontend/public/config
git commit -m "Phase 3I: DemoOrchestrator + /demo route driving all components"
```

---

## Task J1: `scripts/reset.sh` — full environment reset

**Files:**
- Modify: `scripts/reset.sh`

- [ ] **Step 1: Write the script**

Replace the contents of `scripts/reset.sh`:

```bash
#!/usr/bin/env bash
# Kill anvil, restart, redeploy contracts, and seed demo state.
# Idempotent — safe to run repeatedly between demo runs.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$HOME/.foundry/bin:$PATH"

echo "=== [1/4] kill existing anvil ==="
pkill -f "^anvil " 2>/dev/null || true
sleep 0.5

echo "=== [2/4] boot fresh anvil ==="
anvil \
    --host 127.0.0.1 \
    --port 8545 \
    --block-time 2 \
    --chain-id 31337 \
    --gas-limit 30000000 \
    --accounts 10 \
    --mnemonic "test test test test test test test test test test test junk" \
    > /tmp/sentinel-anvil.log 2>&1 &
ANVIL_PID=$!
for i in {1..30}; do
    if cast block-number --rpc-url http://localhost:8545 >/dev/null 2>&1; then
        break
    fi
    sleep 0.3
done
if ! cast block-number --rpc-url http://localhost:8545 >/dev/null 2>&1; then
    echo "ERROR: Anvil did not come up (log: /tmp/sentinel-anvil.log)"
    exit 1
fi
echo "Anvil ready on :8545 (pid=$ANVIL_PID)"

echo "=== [3/4] redeploy contracts ==="
cd contracts
DEPLOYER_KEY="${DEPLOYER_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}" \
    forge script script/DeployLocal.s.sol:DeployLocal \
    --rpc-url http://localhost:8545 \
    --broadcast \
    --skip-simulation
cd "$REPO_ROOT"

echo "=== [4/4] seed demo state ==="
./scripts/seed-demo-state.sh

echo ""
echo "✅ reset complete (anvil pid=$ANVIL_PID)"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/reset.sh`

- [ ] **Step 3: Run it and confirm it succeeds**

Run: `./scripts/reset.sh`
Expected: exits with "✅ reset complete". Addresses re-written, anvil running.

- [ ] **Step 4: Commit**

```bash
git add scripts/reset.sh
git commit -m "Phase 3J1: implement reset.sh (anvil wipe + redeploy + seed)"
```

---

## Task J2: `scripts/seed-demo-state.sh` — seed tokens, pool, oracle

**Files:**
- Modify: `scripts/seed-demo-state.sh`

- [ ] **Step 1: Write the script**

Replace the contents of `scripts/seed-demo-state.sh`:

```bash
#!/usr/bin/env bash
# Seed demo state after a fresh deploy.
#   - mint USDC + WETH to attacker / LP
#   - fund flash loan provider
#   - fund VictimLendingPool
#   - prime the oracle pair
#
# Assumes: anvil is running, DeployLocal.s.sol has been broadcast,
# config/addresses.local.json is current.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$HOME/.foundry/bin:$PATH"

RPC=${RPC_URL:-http://127.0.0.1:8545}
DEPLOYER_KEY=${DEPLOYER_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}
ATTACKER_KEY=${ATTACKER_KEY:-0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba}
ATTACKER_ADDR=$(cast wallet address $ATTACKER_KEY)
LP_KEY=${LP_KEY:-0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e}
LP_ADDR=$(cast wallet address $LP_KEY)

ADDR_FILE=config/addresses.local.json
USDC=$(jq -r .USDC $ADDR_FILE)
WETH=$(jq -r .WETH $ADDR_FILE)
ORACLE=$(jq -r .OraclePair $ADDR_FILE)
PROVIDER=$(jq -r .FlashLoanProvider $ADDR_FILE)
VICTIM=$(jq -r .VictimLendingPool $ADDR_FILE)
ATTACKER_CONTRACT=$(jq -r .FlashLoanAttacker $ADDR_FILE)

echo "-- mint USDC + WETH to the deployer for seeding --"
cast send $USDC "mint(address,uint256)" $(cast wallet address $DEPLOYER_KEY) 1000000000000 \
    --private-key $DEPLOYER_KEY --rpc-url $RPC >/dev/null
cast send $WETH "mint(address,uint256)" $(cast wallet address $DEPLOYER_KEY) 100000000000000000000000 \
    --private-key $DEPLOYER_KEY --rpc-url $RPC >/dev/null

echo "-- seed oracle pair (10k USDC + 1k WETH) --"
cast send $USDC "approve(address,uint256)" $ORACLE 10000000000 \
    --private-key $DEPLOYER_KEY --rpc-url $RPC >/dev/null
cast send $WETH "approve(address,uint256)" $ORACLE 1000000000000000000000 \
    --private-key $DEPLOYER_KEY --rpc-url $RPC >/dev/null
cast send $ORACLE "seed(uint256,uint256)" 10000000000 1000000000000000000000 \
    --private-key $DEPLOYER_KEY --rpc-url $RPC >/dev/null

echo "-- fund flash loan provider (5k WETH) --"
cast send $WETH "mint(address,uint256)" $PROVIDER 5000000000000000000000 \
    --private-key $DEPLOYER_KEY --rpc-url $RPC >/dev/null

echo "-- fund victim pool (10k WETH of borrowable liquidity via LP) --"
cast send $WETH "mint(address,uint256)" $LP_ADDR 10000000000000000000000 \
    --private-key $DEPLOYER_KEY --rpc-url $RPC >/dev/null
cast send $WETH "approve(address,uint256)" $VICTIM 10000000000000000000000 \
    --private-key $LP_KEY --rpc-url $RPC >/dev/null
cast send $VICTIM "fundLiquidity(uint256)" 10000000000000000000000 \
    --private-key $LP_KEY --rpc-url $RPC >/dev/null

echo ""
echo "✅ demo state seeded"
echo "   oracle:   ${ORACLE}"
echo "   victim:   ${VICTIM}"
echo "   attacker: ${ATTACKER_ADDR} (contract: ${ATTACKER_CONTRACT})"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/seed-demo-state.sh`

- [ ] **Step 3: Run it against a fresh deploy**

Run: `./scripts/seed-demo-state.sh`
Expected: exits with "✅ demo state seeded", no reverts.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-demo-state.sh
git commit -m "Phase 3J2: implement seed-demo-state.sh"
```

---

## Task J3: `scripts/replay-scenario.sh` — wrap api-gateway call

**Files:**
- Modify: `scripts/replay-scenario.sh`
- Create: `scripts/inject-instruction.sh`

- [ ] **Step 1: Write `scripts/replay-scenario.sh`**

Replace the contents:

```bash
#!/usr/bin/env bash
set -euo pipefail
SCENARIO="${1:-flash-loan-oracle}"
API="${API_BASE:-http://localhost:8080}"
case "$SCENARIO" in
    flash-loan-oracle)
        curl -sSf -X POST "$API/api/v1/demo/replay-scenario" | jq .
        ;;
    agent-constraint)
        exec "$(dirname "$0")/inject-instruction.sh"
        ;;
    *)
        echo "unknown scenario: $SCENARIO (expected flash-loan-oracle | agent-constraint)"
        exit 1
        ;;
esac
```

- [ ] **Step 2: Write `scripts/inject-instruction.sh`**

Create:

```bash
#!/usr/bin/env bash
set -euo pipefail
API="${API_BASE:-http://localhost:8080}"
curl -sSf -X POST "$API/api/v1/demo/inject-instruction" \
    -H 'content-type: application/json' \
    -d '{"reason":"demo"}' | jq .
```

- [ ] **Step 3: Make both executable**

Run: `chmod +x scripts/replay-scenario.sh scripts/inject-instruction.sh`

- [ ] **Step 4: Verify they run**

With services up:
```bash
./scripts/replay-scenario.sh flash-loan-oracle
./scripts/replay-scenario.sh agent-constraint
```
Expected: both return JSON from the api-gateway.

- [ ] **Step 5: Commit**

```bash
git add scripts/replay-scenario.sh scripts/inject-instruction.sh
git commit -m "Phase 3J3: replay-scenario + inject-instruction scripts"
```

---

## Task J4: `scripts/pre-warm-proofs.sh` — fill prover cache

**Files:**
- Create: `scripts/pre-warm-proofs.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Pre-warm the zk-prover cache with the canonical Scenario A inputs.
# Run once after deploy, before the demo, so the live proof request
# during the pitch is a cache hit.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROVER="${ZK_PROVER_URL:-http://localhost:9100}"
POLICY_JSON="$(jq -c . config/policy.json)"
ADDR_FILE=config/addresses.local.json
VICTIM=$(jq -r .VictimLendingPool $ADDR_FILE)

# Canonical Scenario A evidence (pattern = FLASH_LOAN_ORACLE_MANIP,
# confidence above floor, victim = VictimLendingPool).
payload=$(jq -n \
    --arg policy "$POLICY_JSON" \
    --arg victim "$VICTIM" \
    '{
        policy_json: $policy,
        action: {
            target: $victim,
            selector: "0x1a2b3c4d",
            calldata: "0x"
        },
        evidence: {
            event_id: "0x1111111111111111111111111111111111111111111111111111111111111111",
            pattern: "FLASH_LOAN_ORACLE_MANIP",
            confidence: 9300,
            victim_protocol: $victim
        }
    }')

echo "== warming /prove/policy =="
curl -sSf -X POST "$PROVER/prove/policy" \
    -H 'content-type: application/json' \
    -d "$payload" | jq '{elapsedMs, cached, imageId}'

echo ""
echo "✅ prover cache warmed"
```

- [ ] **Step 2: Make it executable and run it**

Run:
```bash
chmod +x scripts/pre-warm-proofs.sh
./scripts/pre-warm-proofs.sh
./scripts/pre-warm-proofs.sh   # second run should show cached:true
```
Expected: first run reports a non-zero `elapsedMs`, second reports `cached: true`.

- [ ] **Step 3: Commit**

```bash
git add scripts/pre-warm-proofs.sh
git commit -m "Phase 3J4: pre-warm zk-prover cache for Scenario A"
```

---

## Task K: Demo-safe mode end-to-end

**Files:**
- Modify: `frontend/src/components/BattlefieldViz.tsx` (already respects `tickIntervalMs` prop — DemoMode doubles it in safe mode)
- Modify: `frontend/src/pages/DemoMode.tsx` (already done in Task I)
- Modify: `frontend/.env.example` (create if missing)
- Modify: `services/mempool-monitor/src/features.ts`

- [ ] **Step 1: Create/update `frontend/.env.example`**

Write:
```
VITE_WS_URL=ws://127.0.0.1:8081/ws
VITE_SENTINEL_DEMO_SAFE=false
```

- [ ] **Step 2: Confirm `<AttackIntelGraph>` honors the max-node cap**

Open `frontend/src/components/AttackIntelGraph.tsx` (Phase 2 deliverable). Add a `maxNodes` prop with default 60 and clamp `data.nodes` to the head when `isDemoSafe()` returns true. If the Phase 2 implementation already has this, skip.

- [ ] **Step 3: Run the demo in safe mode end-to-end**

Run:
```bash
./scripts/reset.sh
./scripts/pre-warm-proofs.sh
VITE_SENTINEL_DEMO_SAFE=true pnpm --filter @sentinel/frontend dev
```
Open http://localhost:3000/demo in a browser. Watch the choreography through Scenario A.

- [ ] **Step 4: Commit**

```bash
git add frontend/.env.example frontend/src/components/AttackIntelGraph.tsx
git commit -m "Phase 3K: SENTINEL_DEMO_SAFE end-to-end"
```

---

## Task L1: Scenario A E2E test (bash)

**Files:**
- Create: `scripts/test-scenario-a.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# E2E test: Scenario A completes within the SLA.
# Requires the full docker compose stack to be up.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

API="${API_BASE:-http://localhost:8080}"
ADDR_FILE=config/addresses.local.json
PAUSE_CONTROLLER=$(jq -r .PauseController $ADDR_FILE)
VICTIM=$(jq -r .VictimLendingPool $ADDR_FILE)
RPC=${RPC_URL:-http://localhost:8545}

./scripts/reset.sh >/dev/null
./scripts/pre-warm-proofs.sh >/dev/null

start=$(date +%s%3N)
curl -sSf -X POST "$API/api/v1/demo/replay-scenario" >/dev/null

for i in $(seq 1 50); do
    paused=$(cast call $PAUSE_CONTROLLER "isPaused(address)(bool)" $VICTIM --rpc-url $RPC)
    if [ "$paused" = "true" ]; then
        break
    fi
    sleep 0.2
done

end=$(date +%s%3N)
elapsed=$((end - start))

if [ "$paused" != "true" ]; then
    echo "❌ pause did not activate within 10s"
    exit 1
fi

ledger_entries=$(curl -sSf "$API/api/v1/ledger" | jq '.totalEntryCount')
if [ "$ledger_entries" -lt 1 ]; then
    echo "❌ counterfactual ledger empty after Scenario A"
    exit 1
fi

echo "✅ Scenario A: pause + ledger entry in ${elapsed}ms"
if [ $elapsed -gt 10000 ]; then
    echo "⚠️  exceeded 10s SLA from doc 09"
    exit 1
fi
```

- [ ] **Step 2: Make it executable and run**

Run:
```bash
chmod +x scripts/test-scenario-a.sh
./scripts/test-scenario-a.sh
```
Expected: `✅ Scenario A: ...`.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-scenario-a.sh
git commit -m "Phase 3L1: Scenario A e2e SLA test"
```

---

## Task L2: Scenario B E2E test (bash)

**Files:**
- Create: `scripts/test-scenario-b.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# E2E test: Scenario B produces an on-chain rejection and a REJECTED cue.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

API="${API_BASE:-http://localhost:8080}"

./scripts/reset.sh >/dev/null
./scripts/pre-warm-proofs.sh >/dev/null

# Subscribe to Redis pubsub in the background, timeout after 8s.
OBSERVED=/tmp/sentinel-scenario-b.out
: > "$OBSERVED"
(
    redis-cli --no-raw SUBSCRIBE sentinel.defense.rejected \
        2>/dev/null \
        | head -n 10 > "$OBSERVED"
) &
SUB_PID=$!

sleep 0.5  # let the subscriber attach
curl -sSf -X POST "$API/api/v1/demo/inject-instruction" >/dev/null

# Wait up to 8s for the rejection event.
for i in $(seq 1 40); do
    if grep -q "INVALID_PROOF" "$OBSERVED"; then
        kill $SUB_PID 2>/dev/null || true
        echo "✅ Scenario B: INVALID_PROOF observed on sentinel.defense.rejected"
        exit 0
    fi
    sleep 0.2
done

kill $SUB_PID 2>/dev/null || true
echo "❌ Scenario B: no rejection event observed in 8s"
cat "$OBSERVED"
exit 1
```

- [ ] **Step 2: Make it executable and run**

Run:
```bash
chmod +x scripts/test-scenario-b.sh
./scripts/test-scenario-b.sh
```
Expected: `✅ Scenario B: INVALID_PROOF observed on sentinel.defense.rejected`.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-scenario-b.sh
git commit -m "Phase 3L2: Scenario B e2e rejection test"
```

---

## Task L3: Ten-run smoke test

**Files:**
- Create: `scripts/demo-smoke-test.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# Run both scenarios back-to-back ten times.
# Fails on any single iteration failure. Print a summary of timings.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

RUNS="${RUNS:-10}"
FAILURES=0
declare -a A_TIMES B_TIMES

for i in $(seq 1 "$RUNS"); do
    echo "--- run $i/$RUNS ---"
    if ! ./scripts/test-scenario-a.sh; then
        FAILURES=$((FAILURES+1))
        continue
    fi
    if ! ./scripts/test-scenario-b.sh; then
        FAILURES=$((FAILURES+1))
        continue
    fi
done

echo ""
echo "===================="
echo "failures: $FAILURES / $RUNS"
if [ $FAILURES -gt 0 ]; then
    exit 1
fi
echo "✅ ten consecutive clean runs"
```

- [ ] **Step 2: Make it executable and run**

Run:
```bash
chmod +x scripts/demo-smoke-test.sh
./scripts/demo-smoke-test.sh
```
Expected: `✅ ten consecutive clean runs`.

- [ ] **Step 3: Commit**

```bash
git add scripts/demo-smoke-test.sh
git commit -m "Phase 3L3: ten-run smoke test (doc 09 quality gate)"
```

---

## Self-Review

### Spec coverage (vs absolute-docs/09_hackathon_mvp_scope.md Hour 12-24)

- Engineer 1 (Hour 12-18) "Agent Constraint Failure flow; proof generation fails; verifier rejects empty" → Tasks A, D2.
- Engineer 2 (Hour 12-18) "POST /demo/inject-instruction" already existed; "error path → ActionRejected cue to WS" → Tasks D2, E1.
- Engineer 3 (Hour 12-18) "TrustInterface rejection; BattlefieldViz; ImmunityMap" → Tasks F, G, H.
- Engineer 4 (Hour 12-18) "DemoOrchestrator drives timings; stress-test" → Tasks I, L3.
- All (Hour 18-22) "pre-warm proof cache; graceful degradation; 10 consecutive clean runs" → Tasks J4, K, L3.
- "Quality gates: forge test green, pnpm test green, poetry pytest green, E2E < 10s Scenario A, < 8s Scenario B" → Tasks A7, D2 Step 5, E1 Step 5, L1, L2.

No spec gap.

### Placeholder scan

Every task has either full code blocks or exact command lines. No "TBD", no "add error handling", no "similar to task N". The only handwaves are to Phase 2 deliverables (TrustInterface, AttackIntelGraph, MissionControl, EventDetail), explicitly listed in the Assumptions section.

### Type consistency

- `TrustPhase`: `"idle" | "ambiguity" | "suspicion" | "proof" | "resolved" | "rejected"` — consistent across `store.ts`, `cues.ts`, `TrustInterface.tsx`.
- `TrustCollapseCue.state`: `"AMBIGUITY" | "SUSPICION" | "PROOF_INJECTION" | "RESOLVED" | "REJECTED"` — consistent.
- Redis channel `sentinel.defense.rejected` + kind `DEFENSE_REJECTED` — added to FIREHOSE_CHANNELS (E1), published by defense-agent (D2), mapped in `redisChannelToKind` (E1), consumed by `deriveTrustCues` (E1).
- `scenarioA` / `scenarioB` in `timings.json` — referenced by script files and DemoOrchestrator but not strictly imported; steps in `config/demo-scenarios/*.json` are the source of truth for the orchestrator. Timings file is advisory / SLA constants only.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-15-phase-3-live-demo.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because each Task (A, B, C1, …) is independent once its dependencies are committed, so subagents can run concurrently for C1/C2/C3, G/H, J1/J2/J3/J4, etc.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
