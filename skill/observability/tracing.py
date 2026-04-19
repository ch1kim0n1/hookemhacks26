"""OpenTelemetry tracing setup (optional)."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from fastapi import FastAPI

_tracing_initialized = False


def init_tracing(app: FastAPI | None = None) -> None:
    """Configure OTLP HTTP tracing when OTEL_EXPORTER_OTLP_ENDPOINT is set."""
    global _tracing_initialized
    if _tracing_initialized:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        from skill.config.secrets import get_secret
    except ImportError as exc:
        logger.debug("OpenTelemetry not installed: %s", exc)
        _tracing_initialized = True
        return

    endpoint = get_secret("OTEL_EXPORTER_OTLP_ENDPOINT", default="").strip()
    if not endpoint:
        logger.debug("OTEL_EXPORTER_OTLP_ENDPOINT unset; skipping tracing export")
        _tracing_initialized = True
        return

    service_name = get_secret("OTEL_SERVICE_NAME", default="clawguard")
    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)
    try:
        exporter = OTLPSpanExporter(endpoint=endpoint)
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)
        logger.info("OTLP tracing enabled endpoint=%s", endpoint)
    except Exception as exc:
        logger.warning("OTLP tracing setup failed: %s", exc)
        _tracing_initialized = True
        return

    if app is not None:
        try:
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

            FastAPIInstrumentor.instrument_app(app)
        except Exception as exc:
            logger.warning("FastAPI instrumentation failed: %s", exc)

    _tracing_initialized = True


def get_tracer(name: str):
    try:
        from opentelemetry import trace

        return trace.get_tracer(name)
    except ImportError:
        return _NoOpTracer()


class _NoOpTracer:
    class _Span:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def set_attribute(self, *args, **kwargs):
            pass

    def start_as_current_span(self, _name: str):
        return self._Span()
