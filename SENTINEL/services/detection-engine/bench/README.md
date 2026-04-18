# Historical-attack replay benchmark

Reproducible measurement of the SENTINEL detection engine against the
kill-chain signatures of 8 real DeFi exploits.

## Run it

```bash
cd services/detection-engine
poetry install
poetry run pip install matplotlib        # optional — PNG chart
poetry run python -m bench.run
```

Outputs are written to `bench/results/`:

| File | Consumer |
|---|---|
| `historical_attacks.md`  | judge-ready table + methodology |
| `historical_attacks.json`| machine-readable metrics (CI / dashboards) |
| `latency_chart.txt`      | ASCII bars (terminal / logs) |
| `latency_chart.png`      | horizontal bar chart (slides / README) |

The run is fully deterministic given the fixed seeds: re-running produces
identical per-attack numbers (wall-clock latency obviously varies by host).

## What's measured

- **Catch rate** — fraction of attacks where the operator returns a
  `candidate` or `confirmed` verdict on the exploit-call tx.
- **$ blocked** — per-attack post-mortem loss summed over caught attacks.
- **Exploit-tx latency** — wall-clock inside `Operator.evaluate(exploit_tx)`;
  this is what gates on-chain defense.
- **End-to-end latency** — full three-step kill-chain elapsed time.
- **False-positive rate** — a stream of 500 randomised benign ERC-20
  transfers / swaps scored by the same operator.

## Attack corpus

Reconstructed from each exploit's public post-mortem — flash-loan size,
oracle deviation %, and attack selector are pattern-faithful. See
[`attack_corpus.py`](./attack_corpus.py) for references.
