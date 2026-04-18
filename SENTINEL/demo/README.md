# Live Attack Demo — two-machine setup

A theatrical adversary-vs-defender walkthrough for a non-technical audience.
Attacker runs a staged flash-loan oracle-manipulation exploit; the defender's
detection-engine picks it up, the on-stage console lights red, and the attack
is neutralised. Ten-second recon, twenty-second takedown.

The demo runs in one of two modes:

- **real** — attacker signs and broadcasts real txs to a local Anvil node;
  `mempool-monitor` observes the pending-tx stream and feeds the detection
  engine. Full stack exercised end-to-end.
- **simulated** — attacker pushes synthetic tx envelopes directly into
  Redis. No chain needed. Deterministic, low-setup.

Default is `--mode auto`: try real first, fall back to simulated if Anvil
isn't running or the contracts aren't deployed.

---

## Prereqs

Both machines on the same LAN. Python 3.11+. Defender runs Redis + the
detection-engine + `defender.py`. Attacker runs `attacker.py`.

```
pip install -r demo/requirements.txt
```

(`web3`, `eth-account`, `eth-abi` are only needed for real mode. Simulated
mode works without them.)

---

## Real mode (preferred)

The simplest way to get a real chain up is `scripts/dev.sh`, which starts
Redis, Anvil, deploys contracts, seeds state, and launches every service
including `mempool-monitor`:

```
./scripts/dev.sh
```

Then on the defender host:

```
ADDRESSES_FILE=config/addresses.local.json \
REDIS_URL=redis://127.0.0.1:6379 \
python3 demo/defender.py
```

Fire a scenario (real mode is the default):

```
python3 demo/attacker.py blitz
```

If Anvil is reachable and `config/addresses.local.json` resolves, the
attacker submits real signed txs from Anvil account #5. The
`mempool-monitor` picks them up off the pending stream, extracts features,
and writes to `sentinel.mempool.pending` — same stream the simulated path
uses, so the detection engine and defender console are unchanged.

Force real (no fallback):

```
python3 demo/attacker.py blitz --mode real
```

---

## Simulated mode (always works)

Skip the chain entirely. Good for rehearsal, CI, or when setup time is
short.

### Defender host

1. Start Redis, bound to LAN so the attacker can reach it:
   ```
   redis-server --bind 0.0.0.0 --protected-mode no
   ```
2. Start the detection-engine:
   ```
   cd services/detection-engine
   poetry install
   REDIS_URL=redis://127.0.0.1:6379 poetry run python -m detection_engine
   ```
3. Start the console:
   ```
   REDIS_URL=redis://127.0.0.1:6379 \
   ADDRESSES_FILE=config/addresses.local.json \
   python3 demo/defender.py
   ```

### Attacker host

```
REDIS_URL=redis://<defender-lan-ip>:6379 \
python3 demo/attacker.py blitz --mode simulated
```

---

## Scenarios

Eight scenarios, grouped by shape:

### Attack scenarios (all end in a red `threat confirmed` banner)

| scenario    | runtime | profile                                                    |
|-------------|---------|------------------------------------------------------------|
| `blitz`     | ~20s    | Loud, textbook flash-loan oracle manipulation. Four stages, high gas, every signal screams. Good opener — maximum drama. |
| `recon`     | ~40s    | Patient intel-gathering. Extended reconnaissance banner, sybil probes (`getReserves`, `balanceOf`, `approve`), five-stage attack with a nudge swap before the main slam. Eight signals the defender correlates. |
| `stealth`   | ~10s    | Surgical direct exploit. No flash loan, no oracle touch, no cover txs. One `attack(address,uint256)` call with low gas. Loses anyway — the state machine's direct-exploit branch transitions `IDLE → CONFIRMED` at 0.9 confidence on signature alone. |
| `sandwich`  | ~15s    | Classic MEV: front-run swap → victim tx → back-run swap → exploit call. Detection keys on rapid same-pair swap cadence. |
| `pingflood` | ~25s    | Oracle TWAP bias via 18 rapid micro-swaps across two bursts, then the kill call. Cadence-based anomaly signal. |
| `dust`      | ~30s    | Evasion attempt: 25 dust ERC20 transfers before the exploit, hoping to poison the anomaly model's distribution. Doesn't work — selector match still fires. |
| `reentrant` | ~12s    | Reentrancy pattern: seed deposit + six rapid `borrow()` callbacks against `VictimLendingPool`, then the exploit. Selector-repetition burst trips the anomaly score. |

### Baseline

| scenario    | runtime | profile                                                    |
|-------------|---------|------------------------------------------------------------|
| `routine`   | ~8s     | Benign: one deposit, one small swap, one transfer — no exploit selector anywhere. Detection should stay at `noise`/`idle`. Fire this **before** an attack scenario to demonstrate the system doesn't false-positive on normal activity. |

Confidence paths for the most-important transitions:

- `blitz` / `recon`: `IDLE → FLASH_LOAN_OBSERVED → ORACLE_IMPACT_OBSERVED → CONFIRMED`
- `stealth` / `sandwich` / `pingflood` / `dust` / `reentrant`: direct `IDLE → CONFIRMED` via attack selector (with varying anomaly/sequence scores)
- `routine`: no transition — stays at `IDLE`, emits `noise`-level verdicts at most

---

## Env vars (real mode)

| var               | default                                        |
|-------------------|------------------------------------------------|
| `DEMO_MODE`       | `auto`                                         |
| `RPC_URL`         | `http://127.0.0.1:8545`                        |
| `ATTACKER_KEY`    | Anvil account #5 (`0x8b3a350c…edffba`)         |
| `ADDRESSES_FILE`  | `<repo>/config/addresses.local.json`           |
| `REDIS_URL`       | `redis://127.0.0.1:6379`                       |

---

## Rehearsal (single machine, simulated)

```
# terminal 1
redis-server

# terminal 2
cd services/detection-engine && poetry run python -m detection_engine

# terminal 3
python3 demo/defender.py

# terminal 4 — fire when ready
python3 demo/attacker.py --mode simulated
```

---

## Why the attacker always loses

The detection pipeline wires three signals into a multiplicative confidence:

- `IsolationForest` anomaly score on each tx's 5-feature vector
- `LSTM` sequence score across the rolling 5-tx window
- 4-state machine: `IDLE → FLASH_LOAN_OBSERVED → ORACLE_IMPACT_OBSERVED → CONFIRMED`

By the time the exploit call hits, confidence clears the 0.85 confirmation
threshold — published as a `ThreatConfirmedEvent@1` with confidence in basis
points, and the defender console renders the red banner. The same engine
consumes real and simulated txs identically — it just sees the same schema
on the same Redis stream.
