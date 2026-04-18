# `learning-loop`

Adversarial self-training. A Bayesian-optimized Red agent proposes attack variants; a real MLP Blue agent (manual backprop, SGD-with-momentum) learns to defend; when the aggregate win-rate clears the threshold, the learning-loop calls `PolicyRegistry.updatePolicy` and publishes a `LearningLoopCorrectness` proof.

## Role in the pipeline

```
(self-driven)  ──►  learning-loop  ──►  sentinel.training.*
                                     ├─►  zk-prover  /prove/learning
                                     └─►  PolicyRegistry.updatePolicy (tx)
```

## What it does

1. **Bayesian optimizer** ([bayesian-optimizer.ts](src/bayesian-optimizer.ts)) picks attack-variant hyperparameters.
2. **Eval harness** ([eval-harness.ts](src/eval-harness.ts)) runs variants against a physics-backed constant-product simulator; records defended/breached counts.
3. **Blue agent** ([blue-agent.ts](src/blue-agent.ts)) — MLP with He init, L2 regularisation, momentum — trains on each generation's outcomes.
4. Emits [TrainingEvent@1](../../schemas/TrainingEvent.json) per generation (`generation_start`, `variant_result`, `generation_complete`, `policy_update`).
5. When `Σ defended / Σ attacks ≥ WIN_RATE_THRESHOLD` over `MIN_GENERATIONS`, posts to `ZK_PROVER_URL/prove/learning`, then [chain-updater.ts](src/chain-updater.ts) submits the on-chain policy update.

## Env

| Var | Default | Purpose |
|---|---|---|
| `POPULATION_SIZE` | `20` | Red variants per generation |
| `WIN_RATE_THRESHOLD` | `0.95` | Blue must clear this to rotate policy |
| `MAX_GENERATIONS` | `50` | Hard ceiling |
| `GENERATION_DELAY_MS` | `2000` | Throttles telemetry fan-out |
| `ZK_PROVER_URL` | `http://localhost:9100` | `/prove/learning` |
| `LEARNING_LOOP_KEY` | (testnet) | Signs `PolicyRegistry.updatePolicy` |
| `HEALTH_PORT_LearningLoop` | `9005` | `/healthz` |

## Run locally

```bash
pnpm --filter @sentinel/learning-loop dev
```

Training telemetry (loss, accuracy, precision, recall, FPR) streams to the frontend live — `TrainingEvent@1.data.*`. The [learning-loop-win](../../config/demo-scenarios/learning-loop-win.json) scenario drives one generation end-to-end.

## Test

```bash
pnpm --filter @sentinel/learning-loop test
```

Unit-tests for Bayesian acquisition, eval-harness determinism, Blue agent gradient correctness.
