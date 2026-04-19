# Observability

## OpenTelemetry (tracing)

Optional. Install dev/observability extras, then set:

- `OTEL_EXPORTER_OTLP_ENDPOINT` — e.g. `http://localhost:4318/v1/traces` for an OTLP HTTP collector (Jaeger, Grafana Tempo, etc.)
- `OTEL_SERVICE_NAME` — defaults to `clawguard`

If `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, tracing export is disabled (no overhead).

## Prometheus

The API exposes `GET /metrics` (standard Prometheus scrape format). Counters and histograms cover detections, learning rounds, defense publishes, RPC latency, and threat-cache access.

## Alerting (Slack)

Set `SLACK_WEBHOOK_URL` to a Slack incoming webhook. Critical paths (e.g. learning round failure, RPC timeouts/errors in the async JSON-RPC client) call the alert dispatcher when configured.

For synchronous code paths, `alert_sync()` is used when no asyncio loop is running.
