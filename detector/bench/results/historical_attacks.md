# SENTINEL Historical-Attack Replay Benchmark

Each row replays the kill-chain of a real DeFi exploit through the SENTINEL detection engine and measures whether the attacker would have been stopped.

## Headline

- **8 / 8** historical attacks caught (**100.0%** catch rate)
- **$320.7M** of **$320.7M** losses would have been blocked (100.0%)
- Exploit-tx detection latency: **p50 2.40 ms**, p95 2.62 ms, max 2.62 ms
- False-positive rate on 500 benign txs: **0.000%** (0 false fires); 2.596 ms/tx throughput
- Total wall-clock benchmark time: 4.24 s

## Per-attack detail

| # | Attack | Year | Loss ($M) | Caught | Confidence | Level | Exploit-tx latency | Latency bar |
|---|---|---|---:|:-:|---:|:-:|---:|:---|
| 1 | bZx #1 (ETH/sUSD) | 2020 | 0.35 | ✅ | 100.0% | confirmed | 2.44 ms | `██████████████████████··` |
| 2 | bZx #2 (sUSD/ETH) | 2020 | 0.65 | ✅ | 100.0% | confirmed | 2.42 ms | `██████████████████████··` |
| 3 | Harvest Finance | 2020 | 24.00 | ✅ | 100.0% | confirmed | 2.28 ms | `█████████████████████···` |
| 4 | Value DeFi | 2020 | 6.00 | ✅ | 100.0% | confirmed | 2.38 ms | `██████████████████████··` |
| 5 | Warp Finance | 2020 | 7.70 | ✅ | 100.0% | confirmed | 2.62 ms | `████████████████████████` |
| 6 | Vee Finance | 2021 | 35.00 | ✅ | 100.0% | confirmed | 2.38 ms | `██████████████████████··` |
| 7 | Cream Finance (yUSD) | 2021 | 130.00 | ✅ | 100.0% | confirmed | 2.44 ms | `██████████████████████··` |
| 8 | Mango Markets | 2022 | 117.00 | ✅ | 100.0% | confirmed | 2.31 ms | `█████████████████████···` |

## Latency distribution

```
exploit-tx latency (ms)  n=8
  bZx #1 (ETH/sUSD)               2.44  █████████████████████████████████████···
  bZx #2 (sUSD/ETH)               2.42  █████████████████████████████████████···
  Harvest Finance                 2.28  ███████████████████████████████████·····
  Value DeFi                      2.38  ████████████████████████████████████····
  Warp Finance                    2.62  ████████████████████████████████████████
  Vee Finance                     2.38  ████████████████████████████████████····
  Cream Finance (yUSD)            2.44  █████████████████████████████████████···
  Mango Markets                   2.31  ███████████████████████████████████·····
```

## Methodology

- Each attack is encoded as a 3-step kill-chain (`flash-loan → oracle-impact → exploit-call`) reconstructed from the exploit's public post-mortem. Flash-loan size, oracle deviation %, and attack selector are pattern-faithful; counterparty addresses are stable synthetic values.
- A single `Operator` (seed=1337) is warmed up once on a 300-normal / 200-attack synthetic corpus, then every attack + benign tx runs through the same detector.
- Latency is wall-clock from `Operator.evaluate(exploit_tx)` entry to return (`p50 / p95 / max` reported). The end-to-end number in the headline covers all three kill-chain steps.
- Benchmark is fully deterministic given the seed; re-run with `poetry run python -m bench.run` to reproduce.
