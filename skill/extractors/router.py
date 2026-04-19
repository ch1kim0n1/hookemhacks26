"""Routes content to the right extractor based on modality."""

import mimetypes
import re
import unicodedata
from pathlib import Path

from .audio import extract_audio
from .image import extract_image
from .pdf import extract_pdf
from .text import extract_text


def normalize_extracted_text(text: str) -> str:
    """NFKC + collapsed whitespace for a single detection surface (issue #92)."""
    t = unicodedata.normalize("NFKC", text or "")
    t = re.sub(r"[ \t\r\f\v]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def detect_modality(content: str | bytes, content_type: str | None = None,
                    filename: str | None = None) -> str:
    """Determine the modality of the content."""
    if content_type:
        if content_type.startswith("image/"):
            return "image"
        if content_type == "application/pdf":
            return "pdf"
        if content_type.startswith("audio/"):
            return "audio"
        if content_type in ("text/html", "message/rfc822"):
            return "text"
        if content_type.startswith("text/"):
            return "text"

    if filename:
        ext = Path(filename).suffix.lower()
        if ext in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tiff"):
            return "image"
        if ext == ".pdf":
            return "pdf"
        if ext in (".wav", ".mp3", ".flac", ".ogg", ".m4a", ".webm"):
            return "audio"
        if ext in (".eml", ".html", ".htm"):
            return "text"
        mime, _ = mimetypes.guess_type(filename)
        if mime:
            return detect_modality(content, content_type=mime)

    # Sniff bytes
    if isinstance(content, bytes):
        if content[:5] == b"%PDF-":
            return "pdf"
        if content[:8] == b"\x89PNG\r\n\x1a\n" or content[:2] == b"\xff\xd8":
            return "image"
        if content[:4] == b"RIFF" or content[:3] == b"ID3":
            return "audio"

    return "text"


def extract_all(content: str | bytes, content_type: str | None = None,
                filename: str | None = None) -> dict:
    """Extract text from any content type.

    Returns:
        {
            "modality": str,
            "text": str,
            "manifest": list
        }
    """
    modality = detect_modality(content, content_type, filename)

    if modality == "image":
        result = extract_image(content)
    elif modality == "pdf":
        result = extract_pdf(content)
    elif modality == "audio":
        result = extract_audio(content)
    else:
        ct = content_type or "text/plain"
        result = extract_text(content, ct)

    text_out = normalize_extracted_text(result["text"])
    return {
        "modality": modality,
        "text": text_out,
        "manifest": result["manifest"],
    }
