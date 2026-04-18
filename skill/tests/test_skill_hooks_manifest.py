"""SKILL.md hook list stays aligned with hook_registrar."""

from pathlib import Path

from skill.hook_registrar import HOOKED_TOOLS


def test_skill_md_mentions_all_hooked_tools():
    md = Path(__file__).resolve().parents[1] / "SKILL.md"
    text = md.read_text(encoding="utf-8")
    for tool in HOOKED_TOOLS:
        assert tool in text, f"SKILL.md should mention hooked tool {tool!r}"
