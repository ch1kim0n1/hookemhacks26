"""Red agent: adversarial prompt variants (issue #88)."""

from __future__ import annotations

import base64
import random
import re
import unicodedata
from dataclasses import dataclass


@dataclass
class RedProposal:
    variant: str
    score: float


class RedAgent:
    """Generate measurably distinct attack variants from a seed string."""

    def propose(self, seed: str, n: int = 8) -> list[RedProposal]:
        if not seed.strip():
            return []
        out: list[RedProposal] = []
        seen: set[str] = set()
        mutators = (
            _paraphrase_override,
            _zero_width_spacers,
            _b64_wrap,
            _case_obfuscate,
            _delimiter_injection,
            _unicode_homoglyphs_light,
        )
        attempts = 0
        max_attempts = max(n * 6, 24)
        while len(out) < n and attempts < max_attempts:
            attempts += 1
            mut = random.choice(mutators)
            try:
                v = mut(seed)
            except Exception:
                continue
            v = v.strip()
            if not v or v == seed or v in seen:
                continue
            seen.add(v)
            out.append(RedProposal(variant=v[:4000], score=0.0))
        if not out:
            out.append(RedProposal(variant=seed.strip()[:4000], score=0.0))
        return out[:n]


def _paraphrase_override(s: str) -> str:
    return re.sub(
        r"ignore\s+all\s+previous\s+instructions",
        "disregard every prior directive",
        s,
        count=1,
        flags=re.I,
    )


def _zero_width_spacers(s: str) -> str:
    zw = random.choice(["\u200b", "\u200c", "\u200d"])
    return re.sub(r"\s+", lambda m: zw + m.group(0), s, count=random.randint(1, 3))


def _b64_wrap(s: str) -> str:
    needle = "instructions"
    if needle not in s.lower():
        return s + "\n[encoding] " + base64.b64encode(s[-120:].encode()).decode()
    i = s.lower().index(needle)
    chunk = s[i : i + 40]
    return s[:i] + "decode(base64):" + base64.b64encode(chunk.encode()).decode() + s[i + 40 :]


def _case_obfuscate(s: str) -> str:
    return "".join(c.upper() if random.random() < 0.35 else c.lower() for c in s)


def _delimiter_injection(s: str) -> str:
    return "<!-- policy -->\n" + s + "\n<!-- end policy -->"


def _unicode_homoglyphs_light(s: str) -> str:
    t = s.replace("o", "\u043e", 1)  # Cyrillic small o
    return unicodedata.normalize("NFKC", t)
