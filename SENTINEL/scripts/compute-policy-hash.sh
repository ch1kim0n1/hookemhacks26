#!/usr/bin/env bash
# Canonical sha256 of config/policy.json. The zk-prover commits the
# same hash as `policyHash` in the PolicyCompliance journal; the
# PolicyRegistry must be initialized with this value so
# `publicInputs[1] == currentPolicyHash` holds.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Strip the trailing newline that jq -c appends — matches what the
# defense-agent (json.dumps without newline) and the zk guest
# (sha256(inputs.policy_json.as_bytes())) actually hash.
HASH=$(jq -cj . "$REPO_ROOT/config/policy.json" | shasum -a 256 | awk '{print $1}')
echo "0x$HASH"
