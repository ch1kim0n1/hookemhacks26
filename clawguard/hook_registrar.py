"""OpenClaw pre-tool hooks — delegates to :mod:`skill.hook_registrar`."""

from skill.hook_registrar import HOOKED_TOOLS, intercept_entry

__all__ = ["HOOKED_TOOLS", "intercept_entry"]
