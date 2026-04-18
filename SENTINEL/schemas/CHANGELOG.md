# Schema Changelog

One-line entries, newest on top. A PR that touches any `*.json` in this directory must add a row.

## Unreleased

- _nothing yet_

## 2026-04-16

- **`OperatorVerdict@1`** — added. Per-operator per-tx verdict published on `sentinel.detection.operator.<id>` for K-of-N federated consensus ([OperatorVerdict.json](OperatorVerdict.json)).
- **`ThreatConfirmedEvent@2`** — added as superset of `@1`, introduces `federation` block with per-operator attestations and K-of-N metadata ([ThreatConfirmedEvent_v2.json](ThreatConfirmedEvent_v2.json)). `@1` remains valid during the consumer migration window.
- **`PreemptiveStrikeEvent@1` / `PreemptiveAlertEvent@1`** — added as `oneOf` variants so a single `PreemptiveStrikeEvent` payload carries either the defense-tx path (`action: "pause"`) or the alert path (`action: "alert"`) ([PreemptiveStrikeEvent.json](PreemptiveStrikeEvent.json)).

## Initial set

- **`PendingTxEvent@1`** — published by `mempool-monitor`.
- **`ThreatConfirmedEvent@1`** — solo-path consensus output from `detection-engine`.
- **`CounterfactualReadyEvent@1`** — counterfactual simulation result from `counterfactual-sim`.
- **`DefenseSubmittedEvent@1`** / **`DefenseMinedEvent@1`** — defense lifecycle from `defense-agent`.
- **`LedgerRecordedEvent@1`** — on-chain proof-digest commit from `zk-prover`.
- **`TrainingEvent@1`** — learning-loop generation tick.

## Format

```
## YYYY-MM-DD

- **`SchemaName@N`** — one-line description. Link to the file.
```

Breaking changes must explain the migration in one line and link the replacement schema.
