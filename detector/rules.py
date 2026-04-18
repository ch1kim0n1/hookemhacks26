"""Regex-based injection detection rules. 30 patterns covering known attack vectors."""

import re
from dataclasses import dataclass


@dataclass
class RuleMatch:
    rule_id: str
    rule_name: str
    category: str
    severity: float  # 0.0-1.0
    matched_text: str


# Each rule: (id, name, category, pattern, severity)
RULES: list[tuple[str, str, str, re.Pattern, float]] = [
    # --- Direct instruction override ---
    ("R01", "ignore_previous", "instruction_override",
     re.compile(r"ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|context)", re.I),
     0.95),

    ("R02", "disregard_instructions", "instruction_override",
     re.compile(r"disregard\s+(all\s+)?(previous|prior|above|your)\s+(instructions?|programming|guidelines?)", re.I),
     0.95),

    ("R03", "forget_instructions", "instruction_override",
     re.compile(r"forget\s+(everything|all|what)\s+(you\s+)?(know|were told|learned)", re.I),
     0.90),

    ("R04", "new_instructions", "instruction_override",
     re.compile(r"(your\s+)?new\s+instructions?\s+(are|is|:)", re.I),
     0.90),

    ("R05", "override_system", "instruction_override",
     re.compile(r"override\s+(your\s+)?(system|base|core|original)\s+(prompt|instructions?|programming)", re.I),
     0.95),

    # --- Role manipulation ---
    ("R06", "you_are_now", "role_override",
     re.compile(r"you\s+are\s+now\s+(a|an|the)\s+\w+", re.I),
     0.80),

    ("R07", "act_as", "role_override",
     re.compile(r"(act|behave|respond|pretend)\s+(as|like)\s+(a|an|if\s+you\s+are)", re.I),
     0.75),

    ("R08", "jailbreak_dan", "role_override",
     re.compile(r"(DAN|do\s+anything\s+now|developer\s+mode|god\s+mode|sudo\s+mode)", re.I),
     0.95),

    ("R09", "roleplay_system", "role_override",
     re.compile(r"(enter|switch\s+to|enable)\s+(roleplay|character|persona)\s+mode", re.I),
     0.85),

    # --- System prompt markers ---
    ("R10", "system_prompt_tag", "prompt_leak",
     re.compile(r"<\s*/?system\s*>|<<\s*SYS\s*>>|\[SYSTEM\]|\[INST\]", re.I),
     0.90),

    ("R11", "prompt_boundary", "prompt_leak",
     re.compile(r"(BEGIN|START|END)\s+(SYSTEM|HIDDEN|SECRET)\s+(PROMPT|INSTRUCTIONS?|MESSAGE)", re.I),
     0.90),

    ("R12", "reveal_prompt", "prompt_leak",
     re.compile(r"(show|reveal|print|output|repeat|display)\s+(your\s+)?(system\s+)?(prompt|instructions?|rules?)", re.I),
     0.85),

    # --- Encoded/obfuscated payloads ---
    ("R13", "base64_blob", "obfuscation",
     re.compile(r"(?:base64|decode|eval)\s*[:(]\s*[A-Za-z0-9+/]{20,}={0,2}", re.I),
     0.80),

    ("R14", "hex_encoded", "obfuscation",
     re.compile(r"\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){5,}", re.I),
     0.75),

    ("R15", "unicode_escape", "obfuscation",
     re.compile(r"\\u[0-9a-fA-F]{4}(?:\\u[0-9a-fA-F]{4}){3,}", re.I),
     0.70),

    # --- Zero-width and invisible characters ---
    ("R16", "zero_width_injection", "steganographic",
     re.compile(r"[\u200b\u200c\u200d\u2060\ufeff]{3,}"),
     0.85),

    ("R17", "homoglyph_attack", "steganographic",
     re.compile(r"[\u0400-\u04ff].*[a-zA-Z]|[a-zA-Z].*[\u0400-\u04ff]"),  # mixed Cyrillic+Latin
     0.60),

    # --- HTML/markup injection ---
    ("R18", "html_comment_instruction", "markup_injection",
     re.compile(r"<!--\s*(ignore|override|system|instruction|inject|execute)", re.I),
     0.90),

    ("R19", "hidden_div_instruction", "markup_injection",
     re.compile(r"display\s*:\s*none[^>]*>.*?(ignore|override|instruction|execute|you\s+are)", re.I | re.S),
     0.90),

    ("R20", "script_injection", "markup_injection",
     re.compile(r"<script[^>]*>.*?(fetch|eval|document|window)", re.I | re.S),
     0.85),

    # --- Suspicious URL patterns ---
    ("R21", "data_uri", "suspicious_url",
     re.compile(r"data:(?:text|application)/[^;]+;base64,[A-Za-z0-9+/]{50,}", re.I),
     0.75),

    ("R22", "callback_url", "suspicious_url",
     re.compile(r"(send|post|fetch|forward|exfiltrate)\s+(to|data\s+to)\s+https?://", re.I),
     0.85),

    # --- Financial-specific patterns ---
    ("R23", "trade_instruction", "financial",
     re.compile(r"(immediately\s+)?(sell|buy|liquidate|transfer)\s+(all|everything|position|portfolio|holdings)", re.I),
     0.80),

    ("R24", "urgency_manipulation", "financial",
     re.compile(r"(urgent|critical|emergency|immediately|right\s+now)\s*[!:]\s*(sell|buy|liquidate|transfer|execute)", re.I),
     0.85),

    # --- Context manipulation ---
    ("R25", "fake_error", "context_manipulation",
     re.compile(r"(error|warning|alert)\s*:\s*(system|admin|security)\s*(says?|requires?|demands?)", re.I),
     0.75),

    ("R26", "fake_user_message", "context_manipulation",
     re.compile(r"(USER|HUMAN|ADMIN)\s*:\s*(ignore|override|forget|new\s+instruction)", re.I),
     0.90),

    ("R27", "separator_injection", "context_manipulation",
     re.compile(r"[-=]{10,}\s*(system|admin|new\s+context|instructions?)", re.I),
     0.80),

    # --- Payload delimiters ---
    ("R28", "triple_backtick_system", "delimiter_abuse",
     re.compile(r"```\s*(system|prompt|instruction|inject)", re.I),
     0.75),

    ("R29", "xml_tag_injection", "delimiter_abuse",
     re.compile(r"<(system_prompt|instructions?|context|admin_override)>", re.I),
     0.90),

    # --- Exfiltration ---
    ("R30", "markdown_image_exfil", "exfiltration",
     re.compile(r"!\[.*?\]\(https?://[^\)]*\{.*?\}", re.I),
     0.90),
]


def scan(text: str) -> list[RuleMatch]:
    """Run all rules against text, return list of matches."""
    matches = []
    for rule_id, name, category, pattern, severity in RULES:
        for m in pattern.finditer(text):
            matches.append(RuleMatch(
                rule_id=rule_id,
                rule_name=name,
                category=category,
                severity=severity,
                matched_text=m.group()[:200],  # truncate long matches
            ))
    return matches


def max_severity(matches: list[RuleMatch]) -> float:
    """Return the highest severity among all matches, or 0.0 if none."""
    return max((m.severity for m in matches), default=0.0)
