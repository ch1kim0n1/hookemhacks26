# `policy-compliance` — PolicyCompliance guest

Proves: **the proposed action is an authorised response to this evidence under the current policy**, without revealing the policy or the evidence fields.

A failed assertion inside the guest produces no proof. That is a feature — it is the cryptographic backing of the "Agent Constraint Failure" demo scenario.

## Statement

Given private inputs
- `policy_json` — canonicalised JSON of the current policy `P` (may carry a linear classifier)
- `action` — `{ target, selector, calldata }`
- `evidence` — `{ event_id, pattern, confidence, victim_protocol, features }`

the guest asserts, then commits:

1. `P` parses and contains a rule whose `pattern == evidence.pattern`.
2. `evidence.confidence >= rule.min_confidence`.
3. `action.target == evidence.victim_protocol`.
4. `action.selector ∈ rule.authorized_selectors`.
5. **On-chain inference gate (optional):** if `P.classifier` is set,
   compute `score = Σ weights[i] * features[i] + bias` as an `i64`
   (saturating) and assert `score >= threshold`. Because `policyHash`
   commits to the full `policy_json`, the on-chain verifier is
   cryptographically bound to the exact classifier weights that ran.
6. `action_hash := sha256(action.target || action.calldata)`.
7. `policy_hash := sha256(policy_json_bytes)`.

### On-chain inference (§5)

The linear classifier is evaluated **inside the zkVM**. The Groth16
proof is a succinct argument that this specific model, committed in
`policyHash`, saw these features and cleared the threshold. The
on-chain verifier never sees the features — it verifies the proof
against `policyHash`. That is genuine on-chain inference: model
execution happens inside the proof; chain execution verifies the
proof. Weights live in `config/policy.json` under `classifier`.

## Public inputs (journal)

`POLICY_JOURNAL_LEN = 96`.

| Offset | Bytes | Field |
|---|---|---|
| 0 | 32 | `actionHash` |
| 32 | 32 | `policyHash` |
| 64 | 32 | `eventId` |

Layout constructed by `sentinel_zk_shared::policy_journal`.

## Private inputs

The full policy JSON and evidence object, including any sensitive attacker fingerprints. Only the three digests above leave the zkVM.

## Canonicalisation

`policyHash` is `sha256` over the raw bytes of `policy_json`. **Whitespace and key order matter.** Callers must canonicalise before hashing; use `scripts/compute-policy-hash.sh` so the on-chain `PolicyRegistry.currentPolicyHash` and the guest's `policyHash` always match.

## On-chain binding

`PolicyRegistry.verifyAndExecute` calls `PolicyVerifier.verify(seal, imageId, journalDigest)`. Reverts if `journal[32..64] != currentPolicyHash`. Otherwise executes `action` against `evidence.victim_protocol`.

## Numeric types

`confidence` is `u16` in basis points (0-10000). **Never** cross the host/guest boundary with floats.

## Sources

- Guest entry: [src/main.rs](src/main.rs)
- Input type + journal helper: [../../shared/src/lib.rs](../../shared/src/lib.rs)
- Host wrapper: [../../host/src/lib.rs](../../host/src/lib.rs) (`prove_policy`)
- CLI: [../../host/src/bin/prove_policy.rs](../../host/src/bin/prove_policy.rs)
