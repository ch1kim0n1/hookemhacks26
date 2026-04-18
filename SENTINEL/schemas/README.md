# `schemas/` — Event Schemas

JSON Schema (draft-07) definitions for every message published on the SENTINEL Redis bus. Producers and consumers must honour the `schema` tag on every envelope; CI validates every schema file plus fixture round-trips.

## Files

| Schema | `schema` tag | Producer | Primary consumers |
|---|---|---|---|
| [PendingTxEvent.json](PendingTxEvent.json) | `PendingTxEvent@1` | `mempool-monitor` | `detection-engine`, `preemptive-strike` |
| [OperatorVerdict.json](OperatorVerdict.json) | `OperatorVerdict@1` | `detection-engine` (per operator) | `federation-coordinator` |
| [ThreatConfirmedEvent.json](ThreatConfirmedEvent.json) | `ThreatConfirmedEvent@1` | `detection-engine` (legacy solo path) | `defense-agent`, `counterfactual-sim` |
| [ThreatConfirmedEvent_v2.json](ThreatConfirmedEvent_v2.json) | `ThreatConfirmedEvent@2` | `federation-coordinator` | `defense-agent`, `counterfactual-sim` |
| [CounterfactualReadyEvent.json](CounterfactualReadyEvent.json) | `CounterfactualReadyEvent@1` | `counterfactual-sim` | `zk-prover` |
| [DefenseSubmittedEvent.json](DefenseSubmittedEvent.json) | `DefenseSubmittedEvent@1` | `defense-agent` | `api-gateway`, frontend |
| [DefenseMinedEvent.json](DefenseMinedEvent.json) | `DefenseMinedEvent@1` | `defense-agent` (receipt watcher) | `api-gateway`, frontend |
| [LedgerRecordedEvent.json](LedgerRecordedEvent.json) | `LedgerRecordedEvent@1` | `zk-prover` (ledger publisher) | `api-gateway`, frontend |
| [PreemptiveStrikeEvent.json](PreemptiveStrikeEvent.json) | `PreemptiveStrikeEvent@1` or `PreemptiveAlertEvent@1` (oneOf) | `preemptive-strike` | `api-gateway`, frontend |
| [TrainingEvent.json](TrainingEvent.json) | `TrainingEvent@1` | `learning-loop` | `api-gateway`, frontend |

The flow is laid out in [../absolute-docs/05_data_flow_and_sequences.md](../absolute-docs/05_data_flow_and_sequences.md). Redis stream names and API exposure are defined in [../absolute-docs/03_off_chain_services.md](../absolute-docs/03_off_chain_services.md) and [../absolute-docs/06_api_specifications.md](../absolute-docs/06_api_specifications.md).

## Envelope invariants

Every event object:

1. Has a `schema` property with a `const` value of the form `<Name>@<major>`.
2. Is a single JSON object (never an array, never a primitive).
3. Uses `bytes32` fields as `"0x" + 64 hex chars`, addresses as `"0x" + 40 hex chars` (lowercase is preferred but not required).
4. Uses **strings** for any 256-bit integer (`deltaWei`, `gasPrice`, etc.) to avoid IEEE-754 precision loss.
5. Uses RFC 3339 timestamps (`format: date-time`) for anything named `*At` or `timestamp`.

## Versioning policy

The `schema` tag is `<Name>@<major>`. We bump the major suffix when a change is not **backwards-compatible for consumers**:

| Change | Major bump? | Example |
|---|---|---|
| Add optional field | No | `observations?: number` |
| Add enum value | **Yes** (consumers may exhaustively match) | `state: "QUARANTINED"` |
| Remove / rename field | **Yes** | `confidence` → `confidenceBp` |
| Tighten a validator (existing data stops validating) | **Yes** | `confidence` range 0-1 → 0-10000 |
| Loosen a validator | No | optional `note` becomes free-form |
| Change semantic meaning (same type, new interpretation) | **Yes** | `deltaWei` sign convention flipped |

When you bump:

1. **Create a new file** alongside the old one: `FooEvent_v2.json` with `schema = "FooEvent@2"`. Do not overwrite the `_v1`.
2. Keep the old schema validating for at least one release so consumers can migrate. Mark it deprecated in [CHANGELOG.md](CHANGELOG.md).
3. Producers write both tags during the overlap window; consumers accept both.
4. Remove the old schema in a follow-up PR after every consumer declares v2 support (grep for the tag string).

`ThreatConfirmedEvent_v2.json` is the canonical example — its `description` explains how v1 consumers can treat the new `federation` block as opaque.

## Ownership

- **One schema ⇢ one producer service.** The producer owns breaking changes to its schema. Other services are consumers.
- Cross-service schema changes need sign-off from every listed consumer (grep this README's table).
- See [CODEOWNERS](CODEOWNERS) for the review-routing config GitHub uses to enforce this.

## Validation enforcement

Three layers:

1. **Static** — every `*.json` here must be valid JSON Schema draft-07 with an `$id` matching the filename.
2. **Fixtures** — [fixtures/](fixtures/) ships one `valid.json` and one `invalid.json` per schema. The valid fixture must validate; the invalid one must fail. This catches accidental loosening.
3. **Runtime** — every consumer validates at the service boundary (before any business logic sees the payload). Unknown `schema` tags and validation failures are dead-lettered, not silently dropped.

All three are exercised by:

```bash
pnpm run validate:schemas
```

in CI ([../.github/workflows/ci.yml](../.github/workflows/ci.yml), `lint` job). The script is [../scripts/validate-schemas.mjs](../scripts/validate-schemas.mjs) — zero-dependency, validates against draft-07 features actually used in this directory.

## Adding a new schema

1. Create `FooEvent.json` with `$id: "FooEvent"`, `schema` const `"FooEvent@1"`, the fields, and draft-07 validators.
2. Add a row to the table above with the producer and consumers.
3. Add `fixtures/FooEvent.valid.json` and `fixtures/FooEvent.invalid.json`.
4. Run `pnpm run validate:schemas` locally — must pass.
5. Add a line to [CHANGELOG.md](CHANGELOG.md).

## Adding a field to an existing schema

- **Optional** → patch bump only. Update the schema, add the field to fixtures if you want coverage, note in CHANGELOG.
- **Required** or enum extension → create `FooEvent_v2.json` per the versioning policy above.

## Non-goals

- **Wire format.** Events are JSON today; this directory is agnostic. A future move to protobuf/avro would keep the same event names and semantics.
- **Transport.** Redis stream names live in [../absolute-docs/03_off_chain_services.md](../absolute-docs/03_off_chain_services.md); they are not part of the schema contract.
- **Authorization.** Who is allowed to publish to a stream is enforced by service boundaries, not by the schema.
