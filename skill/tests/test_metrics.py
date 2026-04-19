"""Prometheus metrics definitions."""

from skill.observability.metrics import (
    detection_latency,
    detections_total,
    learning_rounds_total,
)


def test_detection_counter_increments():
    detections_total.labels(verdict="block", modality="text").inc()


def test_histogram_observes():
    detection_latency.observe(0.5)


def test_learning_rounds_counter():
    learning_rounds_total.inc()
