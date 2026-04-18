# ZK integration (Python + Solidity)

This repo wires **verification** at three levels:

## 1. On-chain (`contracts/`)

- **`MockGroth16Verifier`** implements `IVerifier` (`verify(bytes,bytes32[]) → bool`) for local and devnet builds.
- **`DefenseProtocol`** calls `IVerifier.verify` for `verifyAndExecute` (policy) and `publishDefenseUpdate` / `_applyDefenseUpdate` (learning).
- **Foundry tests**: `contracts/test/MockGroth16Verifier.t.sol`, `contracts/test/MockGroth16DefenseProtocol.t.sol` — valid proofs accepted (mock always returns `true`); production must swap in a real pairing checker.

## 2. Off-chain Python (`zk/prover_host.py`)

- HTTP stub `/prove` returns deterministic fake Groth16-shaped JSON for demos.
- **`zk/proof_cache.py`** deduplicates identical `publicInputs` to avoid redundant work.

## 3. Application flag (`SKIP_ZK_PROOF`)

- **`network/applier.py`** respects `SKIP_ZK_PROOF` when applying defense bundles off-chain.
- Full **RISC Zero** / **snarkjs** circuits (ScanAttestation, DefenseUpdateCorrectness) are tracked as a larger toolchain effort; the Solidity interface + mock verifier + tests above define the integration contract.

## Dev mode (`learningVerifier == address(0)`)

`DefenseProtocol` allows owner to point `learningVerifier` at `address(0)` for special dev handling (see `DefenseProtocol.sol`). Prefer **`MockGroth16Verifier`** + tests for reproducible CI.
