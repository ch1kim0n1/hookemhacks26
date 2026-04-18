#!/usr/bin/env bash
# Trigger a demo scenario against a running api-gateway.
#
# Usage:
#   ./scripts/replay-scenario.sh <scenario-id>
#   ./scripts/replay-scenario.sh --list
#
# Only scenarios with runnable:true in config/demo-scenarios/<id>.json work
# today — the others are specifications awaiting their endpoints. See
# config/demo-scenarios/README.md for the menu.
set -euo pipefail

SCENARIO="${1:-flash-loan-oracle}"
API="${API_BASE:-http://localhost:8080}"

if [[ "$SCENARIO" == "--list" || "$SCENARIO" == "-l" ]]; then
    echo "Runnable scenarios:"
    echo "  flash-loan-oracle    — flash-loan + oracle manipulation (attack)"
    echo "  agent-constraint     — malicious instruction, proof fails (attack)"
    echo "  preemptive-strike    — cross-federation pre-mempool pause (attack)"
    echo
    echo "Spec-only scenarios (endpoint not yet implemented):"
    for f in config/demo-scenarios/*.json; do
        id=$(basename "$f" .json)
        case "$id" in
            flash-loan-oracle|agent-constraint|preemptive-strike) ;;
            *) echo "  $id" ;;
        esac
    done
    exit 0
fi

case "$SCENARIO" in
    flash-loan-oracle)
        curl -sSf -X POST "$API/api/v1/demo/replay-scenario" | jq .
        ;;
    agent-constraint)
        exec "$(dirname "$0")/inject-instruction.sh"
        ;;
    preemptive-strike)
        curl -sSf -X POST "$API/api/v1/demo/preemptive" | jq .
        ;;
    routine-swap|liquidity-provision|policy-governance-update|operator-onboarding|\
    learning-loop-win|reentrancy-drain|sandwich-attack|oracle-ping-flood|\
    governance-hijack|operator-collusion|signature-replay|dust-spam-evasion)
        echo "error: '$SCENARIO' is a spec scenario — endpoint not yet implemented." >&2
        echo "See config/demo-scenarios/${SCENARIO}.json for the required endpoint." >&2
        exit 2
        ;;
    *)
        echo "unknown scenario: $SCENARIO" >&2
        echo "run with --list to see available scenarios" >&2
        exit 1
        ;;
esac
