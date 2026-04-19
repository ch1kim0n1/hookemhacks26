"""Prometheus metrics (import safe without prometheus_client in minimal installs)."""

from __future__ import annotations

try:
    from prometheus_client import Counter, Gauge, Histogram
except ImportError:  # pragma: no cover - optional extra

    class _Noop:
        def labels(self, *args, **kwargs):
            return self

        def inc(self, *args, **kwargs):
            pass

        def set(self, *args, **kwargs):
            pass

        def observe(self, *args, **kwargs):
            pass

    def Counter(*args, **kwargs):  # type: ignore[misc]
        return _Noop()

    def Histogram(*args, **kwargs):  # type: ignore[misc]
        return _Noop()

    def Gauge(*args, **kwargs):  # type: ignore[misc]
        return _Noop()


detections_total = Counter(
    "clawguard_detections_total",
    "Total detections",
    ["verdict", "modality"],
)

detection_latency = Histogram(
    "clawguard_detection_latency_seconds",
    "Detection pipeline latency",
    buckets=(0.01, 0.05, 0.1, 0.5, 1.0, 5.0),
)

learning_rounds_total = Counter(
    "clawguard_learning_rounds_total",
    "Total learning rounds completed",
)

blue_agent_accuracy = Gauge(
    "clawguard_blue_agent_accuracy",
    "Blue agent training accuracy",
)

defense_publishes_total = Counter(
    "clawguard_defense_publishes_total",
    "Defense updates published to chain",
    ["status"],
)

rpc_latency = Histogram(
    "clawguard_rpc_latency_seconds",
    "RPC call latency",
    ["method"],
    buckets=(0.1, 0.5, 1.0, 5.0, 10.0),
)

threat_cache_hits = Counter(
    "clawguard_threat_cache_hits_total",
    "Threat cache hits",
)

threat_cache_misses = Counter(
    "clawguard_threat_cache_misses_total",
    "Threat cache misses",
)

threat_cache_size = Gauge(
    "clawguard_threat_cache_size",
    "Threat cache row count",
)
