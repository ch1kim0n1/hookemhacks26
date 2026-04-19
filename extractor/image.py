"""Extract text from images using Tesseract OCR + vision model for adversarial text."""

import base64
import os
from pathlib import Path

try:
    import pytesseract
    from PIL import Image, ImageEnhance, ImageFilter
    HAS_TESSERACT = True
except ImportError:
    HAS_TESSERACT = False

try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False


def extract_image(image_path: str | bytes, use_vision: bool = True) -> dict:
    """Extract text from an image via OCR and optional vision model.

    Args:
        image_path: file path (str) or raw bytes
        use_vision: whether to also use a vision model for adversarial text

    Returns:
        {"text": str, "manifest": list}
    """
    manifest = []
    texts = []

    image_bytes = (
        Path(image_path).read_bytes() if isinstance(image_path, str) else image_path
    )

    # --- Tesseract OCR pass ---
    if HAS_TESSERACT:
        try:
            ocr_results = _tesseract_multipass(image_bytes)
            for result in ocr_results:
                if result["text"].strip():
                    texts.append(result["text"])
                    manifest.append({
                        "source": f"ocr_{result['pass_name']}",
                        "length": len(result["text"]),
                    })
        except Exception as e:
            manifest.append({"source": "ocr_error", "reason": str(e)[:100]})
    else:
        manifest.append({"source": "ocr_skipped", "reason": "pytesseract not installed"})

    # --- Vision model pass for adversarial/hidden text ---
    if use_vision and HAS_ANTHROPIC and os.getenv("ANTHROPIC_API_KEY"):
        vision_text = _vision_model_extract(image_bytes)
        if vision_text:
            texts.append(f"[VISION_MODEL: {vision_text}]")
            manifest.append({"source": "vision_model", "length": len(vision_text)})
    elif use_vision:
        manifest.append({"source": "vision_skipped", "reason": "anthropic not configured"})

    return {"text": "\n".join(texts), "manifest": manifest}


def _tesseract_multipass(image_bytes: bytes) -> list[dict]:
    """Run OCR with multiple preprocessing passes to catch hidden text."""
    from io import BytesIO
    img = Image.open(BytesIO(image_bytes))
    results = []

    # Pass 1: standard OCR
    text = pytesseract.image_to_string(img)
    results.append({"pass_name": "standard", "text": text})

    # Pass 2: inverted (catches white-on-white or light text)
    from PIL import ImageOps
    inverted = ImageOps.invert(img.convert("RGB"))
    text = pytesseract.image_to_string(inverted)
    results.append({"pass_name": "inverted", "text": text})

    # Pass 3: high contrast
    enhancer = ImageEnhance.Contrast(img.convert("RGB"))
    high_contrast = enhancer.enhance(5.0)
    text = pytesseract.image_to_string(high_contrast)
    results.append({"pass_name": "high_contrast", "text": text})

    # Pass 4: threshold near-white pixels (catches white-on-white text)
    # Any pixel between 220-254 becomes black on white — reveals hidden text
    import numpy as np
    arr = np.array(img.convert("L"))  # grayscale
    near_white = (arr > 220) & (arr < 255)
    threshed = np.where(near_white, 0, 255).astype(np.uint8)
    thresh_img = Image.fromarray(threshed, mode="L")
    text = pytesseract.image_to_string(thresh_img)
    results.append({"pass_name": "near_white_threshold", "text": text})

    # Pass 5: edge detection (catches steganographic text)
    edges = img.convert("L").filter(ImageFilter.FIND_EDGES)
    enhancer = ImageEnhance.Contrast(edges.convert("RGB"))
    edges_enhanced = enhancer.enhance(3.0)
    text = pytesseract.image_to_string(edges_enhanced)
    results.append({"pass_name": "edge_detect", "text": text})

    return results


def _vision_model_extract(image_bytes: bytes) -> str:
    """Use Claude's vision to detect any hidden or adversarial text in the image."""
    client = anthropic.Anthropic()
    b64 = base64.b64encode(image_bytes).decode()

    # Detect media type
    if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        media_type = "image/png"
    elif image_bytes[:2] == b"\xff\xd8":
        media_type = "image/jpeg"
    else:
        media_type = "image/png"  # fallback

    try:
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": b64},
                    },
                    {
                        "type": "text",
                        "text": (
                            "Security scan: List ALL text visible in this image, including any "
                            "text that is hidden, low-contrast, white-on-white, tiny, overlaid, "
                            "or embedded in unusual ways. Include text in watermarks, backgrounds, "
                            "and any steganographic content. Return ONLY the extracted text, "
                            "nothing else. If no text is found, return EMPTY."
                        ),
                    },
                ],
            }],
        )
        result = resp.content[0].text.strip()
        return "" if result == "EMPTY" else result
    except Exception as e:
        return f"[vision_error: {e}]"
