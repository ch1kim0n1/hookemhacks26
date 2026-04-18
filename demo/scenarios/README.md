# Demo Scenarios

Scripted step sequences that drive SENTINEL through specific on-chain storylines. Each file is JSON loaded by the demo orchestrator; each **step** emits a UI banner, focuses a component, or `trigger`s a real API call against a running api-gateway.

Scenarios are **scripts, not fixtures** — they call real endpoints, which produce real on-chain effects against the local anvil. What's prerecorded is only the *choreography*: which banners to show, when to focus which component.

## Menu

### Benign (normal blockchain activity)

| ID | Severity | Runnable today? | What happens |
|---|---|---|---|
| [routine-swap](routine-swap.json) | 0 | spec | Healthy token swap; detector marks `noise`, no action fires |
| [liquidity-provision](liquidity-provision.json) | 0 | spec | LP deposits into `VictimLendingPool`; clean timeline |
| [policy-governance-update](policy-governance-update.json) | 0 | spec | Governance raises `min_confidence` for a rule; policy-hash changes on-chain |
| [operator-onboarding](operator-onboarding.json) | 0 | spec | New detection operator registers model hash in `ModelRegistry` |
| [learning-loop-win](learning-loop-win.json) | 0 | spec | Generation tick with ≥ win-rate threshold → `LearningLoopCorrectness` proof accepted |

### Attacks / exploit attempts

| ID | Severity | Runnable today? | What happens |
|---|---|---|---|
| [flash-loan-oracle](flash-loan-oracle.json) | 9 | **yes** (`/demo/replay-scenario`) | Flash-loan borrows → oracle manipulation → drain. Detector confirms, defense pauses. |
| [agent-constraint](agent-constraint.json) | 10 | **yes** (`/demo/inject-instruction`) | Malicious instruction (unknown pattern) — `PolicyCompliance` proof fails to generate. |
| [preemptive-strike](preemptive-strike.json) | 8 | **yes** (`/demo/preemptive`) | Cross-federation signature seeds before mempool tx lands → pause before attack executes. |
| [reentrancy-drain](reentrancy-drain.json) | 9 | spec | Classic reentrancy callback drains `VictimLendingPool` |
| [sandwich-attack](sandwich-attack.json) | 6 | spec | Front-run + back-run of an innocent swap; detector flags MEV pattern |
| [oracle-ping-flood](oracle-ping-flood.json) | 7 | spec | Attacker spams the oracle pair to bias TWAP; detection fires on deviation velocity |
| [governance-hijack](governance-hijack.json) | 10 | spec | Proposal to swap `PolicyVerifier` to attacker-controlled contract; policy rule rejects |
| [operator-collusion](operator-collusion.json) | 8 | spec | 2 operators emit matching false positives; federation quorum rejects below K-of-N |
| [signature-replay](signature-replay.json) | 8 | spec | Replay a previously-signed permit on a different domain; detector matches signature hash |
| [dust-spam-evasion](dust-spam-evasion.json) | 5 | spec | Flood of tiny txs to desensitize detector; learning-loop bumps threshold |

## Schema

The minimum shape (back-compat with the original two scenarios):

```jsonc
{
  "name": "Human readable",
  "id": "kebab-case-id",
  "steps": [
    { "at": 0,    "action": "banner", "text": "..." },
    { "at": 200,  "action": "trigger", "endpoint": "POST /api/v1/demo/..." },
    { "at": 2000, "action": "focus",  "component": "TrustInterface" },
    { "at": 10000, "action": "publishImmunity" }
  ]
}
```

Optional metadata fields used by the control panel:

| Field | Purpose |
|---|---|
| `category` | `benign \| attack \| governance \| federation` |
| `severity` | 0-10 (noise → critical). Drives badge colour in the control panel. |
| `summary` | One-sentence description for the scenario card. |
| `expectedOutcome` | What the judge should see happen. |
| `runnable` | `true` when every `trigger.endpoint` already exists. `false` flags a spec that needs new endpoints — see `requires`. |
| `requires` | List of endpoints the scenario assumes. Stays accurate as the endpoint surface grows. |

### Step actions

| action | Purpose |
|---|---|
| `banner` | Show a banner (`text`) in the demo UI. |
| `trigger` | Call `endpoint` against the api-gateway (`"POST /api/v1/demo/..."`). |
| `focus` | Focus a frontend `component`. |
| `publishImmunity` | Push the current state into the ImmunityMap. |
| `wait` | (new) Explicit pause for step-through mode. |

## What "runnable" means

`runnable: true` scenarios work today — `./scripts/replay-scenario.sh <id>` will drive them end-to-end against a running stack. Use them in live demos.

`runnable: false` scenarios are **specifications** of the storylines we want to support. They are useful as:
- A design contract for the new API endpoints (documented in `requires`).
- Menu entries for the frontend control panel — grey them out until the endpoint lands.
- Integration-test fixtures — once an endpoint ships, flip `runnable: true` and add it to the test matrix.

Do not pretend spec scenarios run live. The judge should see the real chain react.

## Adding a scenario

1. Pick a category and an honest `severity`.
2. Either reuse an existing endpoint (check [services/api-gateway/src/index.ts](../../services/api-gateway/src/index.ts) for the demo surface) or document the new endpoint in `requires` and leave `runnable: false`.
3. Keep steps short — target 8-15 seconds total. Judges lose attention after that.
4. Commit alongside an entry in this README's menu.
5. If runnable, add a case to [../../scripts/replay-scenario.sh](../../scripts/replay-scenario.sh).

## New endpoints needed to make every spec scenario runnable

Tracked here so the api-gateway PR can implement them in one sweep. See each scenario's `requires` block for payload details.

- `POST /api/v1/demo/swap` — routine AMM swap
- `POST /api/v1/demo/lp-deposit` — liquidity provision
- `POST /api/v1/demo/policy-update` — governance bump of a rule's `min_confidence`
- `POST /api/v1/demo/register-operator` — onboard a new operator
- `POST /api/v1/demo/trigger-generation` — run one learning-loop generation now
- `POST /api/v1/demo/reentrancy` — fire the reentrancy attacker contract
- `POST /api/v1/demo/sandwich` — front/back-run a pending swap
- `POST /api/v1/demo/oracle-flood` — spam the oracle pair
- `POST /api/v1/demo/governance-hijack` — submit a malicious policy proposal
- `POST /api/v1/demo/operator-collusion` — publish matching `OperatorVerdict`s from ≥2 compromised operator ids
- `POST /api/v1/demo/replay-permit` — replay a signed permit
- `POST /api/v1/demo/dust-spam` — spray tiny txs
