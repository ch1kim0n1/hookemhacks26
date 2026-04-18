"""Network propagation: poll registry and apply defenses."""

from .applier import DefenseApplier
from .poller import NetworkPoller

__all__ = ["DefenseApplier", "NetworkPoller"]
