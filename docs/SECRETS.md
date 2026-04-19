# Secrets Management

Configuration and secrets are read through `skill.config.secrets`, so the source can move from environment variables to Vault or another backend without rewiring call sites.

## Using Secrets in Code

```python
from skill.config import get_secret

# Required (raises ValueError if unset)
api_key = get_secret("ANTHROPIC_API_KEY")

# Optional with default
debug = get_secret("DEBUG_MODE", default="false")
```

## Environment Variables

Set variables before starting the app or tests:

```bash
export ANTHROPIC_API_KEY="sk-..."
export CLAWGUARD_PRIVATE_KEY="0x..."
export RPC_URL="https://..."
export BASE_SEPOLIA_RPC_URL="https://..."
export DEFENSE_PROTOCOL_ADDRESS="0x..."
export CORS_ORIGINS="http://localhost:5175,https://example.com"
export WS_BEARER_TOKEN="long-random-token"   # required for non-localhost WebSocket clients
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318/v1/traces"
export OTEL_SERVICE_NAME="clawguard"
export SKILL_AUDIT_RATE_LIMIT_PER_MIN="10"
```

`get_secret` auto-initializes an env-backed manager on first use. The FastAPI app also calls `init_secrets("env")` on startup.

## Future: Vault

```python
from skill.config import init_secrets

init_secrets(source="vault")  # Not implemented yet; use "env" today
```

Call sites keep using `get_secret(...)`.

## Missing Required Secret

You will see:

```text
ValueError: Required secret not found: ANTHROPIC_API_KEY. Set environment variable: export ANTHROPIC_API_KEY=<value>
```
