"""Extract text from HTML, email (.eml), and plain text with hidden-element detection."""

import email
import re
from email import policy

from bs4 import BeautifulSoup

# Zero-width characters to flag
ZERO_WIDTH_CHARS = {
    "\u200b": "ZERO_WIDTH_SPACE",
    "\u200c": "ZERO_WIDTH_NON_JOINER",
    "\u200d": "ZERO_WIDTH_JOINER",
    "\u2060": "WORD_JOINER",
    "\ufeff": "BOM",
    "\u200e": "LTR_MARK",
    "\u200f": "RTL_MARK",
}


def extract_text(content: str | bytes, content_type: str = "text/plain") -> dict:
    """Extract text and return manifest of sources found.

    Returns:
        {
            "text": str,           # unified text blob
            "manifest": [          # where each piece came from
                {"source": "visible_text", "length": int},
                {"source": "html_comment", "content": str},
                {"source": "hidden_element", "content": str},
                {"source": "zero_width_chars", "chars": dict},
                ...
            ]
        }
    """
    if isinstance(content, bytes):
        content = content.decode("utf-8", errors="replace")

    if content_type in ("message/rfc822", "text/eml") or _looks_like_email(content):
        return _extract_email(content)
    elif content_type == "text/html" or "<html" in content.lower()[:500]:
        return _extract_html(content)
    else:
        return _extract_plain(content)


def _looks_like_email(content: str) -> bool:
    # Quick heuristic: has email headers
    return bool(re.match(r"^(From|To|Subject|Date|MIME-Version):\s", content, re.MULTILINE))


def _extract_email(raw: str) -> dict:
    manifest = []
    texts = []

    msg = email.message_from_string(raw, policy=policy.default)

    # Headers as context
    headers_text = f"From: {msg['from']}\nTo: {msg['to']}\nSubject: {msg['subject']}\n"
    texts.append(headers_text)
    manifest.append({"source": "email_headers", "length": len(headers_text)})

    # Walk MIME parts
    for part in msg.walk():
        ct = part.get_content_type()
        if ct.startswith("multipart/"):
            continue
        try:
            payload = part.get_content() if hasattr(part, "get_content") else None
        except (KeyError, LookupError):
            payload = None
        if payload is None:
            continue

        if ct == "text/html" and isinstance(payload, str):
            result = _extract_html(payload)
            texts.append(result["text"])
            manifest.extend(result["manifest"])
        elif ct == "text/plain" and isinstance(payload, str):
            result = _extract_plain(payload)
            texts.append(result["text"])
            manifest.extend(result["manifest"])

    return {"text": "\n".join(texts), "manifest": manifest}


def _extract_html(html: str) -> dict:
    manifest = []
    texts = []

    soup = BeautifulSoup(html, "lxml")

    # Extract HTML comments
    from bs4 import Comment
    for comment in soup.find_all(string=lambda t: isinstance(t, Comment)):
        comment_text = str(comment).strip()
        if comment_text:
            texts.append(f"[HTML_COMMENT: {comment_text}]")
            manifest.append({"source": "html_comment", "content": comment_text})

    # Extract hidden elements (display:none, visibility:hidden, opacity:0, tiny font)
    hidden_patterns = [
        re.compile(r"display\s*:\s*none", re.I),
        re.compile(r"visibility\s*:\s*hidden", re.I),
        re.compile(r"opacity\s*:\s*0", re.I),
        re.compile(r"font-size\s*:\s*0", re.I),
        re.compile(r"color\s*:\s*(?:white|#fff(?:fff)?|rgb\(255\s*,\s*255\s*,\s*255\))", re.I),
    ]
    for tag in soup.find_all(style=True):
        style = tag.get("style", "")
        for pat in hidden_patterns:
            if pat.search(style):
                hidden_text = tag.get_text(strip=True)
                if hidden_text:
                    texts.append(f"[HIDDEN_ELEMENT: {hidden_text}]")
                    manifest.append({"source": "hidden_element", "content": hidden_text, "style": style})
                break

    # Hidden inputs
    for inp in soup.find_all("input", type="hidden"):
        val = inp.get("value", "")
        if val:
            texts.append(f"[HIDDEN_INPUT: {val}]")
            manifest.append({"source": "hidden_input", "content": val})

    # Visible text
    for script in soup(["script", "style"]):
        script.decompose()
    visible = soup.get_text(separator="\n", strip=True)
    texts.append(visible)
    manifest.append({"source": "visible_text", "length": len(visible)})

    # Check zero-width chars
    full_text = "\n".join(texts)
    zw = _detect_zero_width(full_text)
    if zw:
        manifest.append({"source": "zero_width_chars", "chars": zw})

    return {"text": full_text, "manifest": manifest}


def _extract_plain(text: str) -> dict:
    manifest = [{"source": "visible_text", "length": len(text)}]
    zw = _detect_zero_width(text)
    if zw:
        manifest.append({"source": "zero_width_chars", "chars": zw})
    return {"text": text, "manifest": manifest}


def _detect_zero_width(text: str) -> dict:
    found = {}
    for char, name in ZERO_WIDTH_CHARS.items():
        count = text.count(char)
        if count > 0:
            found[name] = count
    return found
