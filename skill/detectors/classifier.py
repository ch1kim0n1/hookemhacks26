"""ML classifier using deepset/prompt-injections model for injection detection."""

import os

try:
    from transformers import pipeline, AutoTokenizer, AutoModelForSequenceClassification
    HAS_TRANSFORMERS = True
except ImportError:
    HAS_TRANSFORMERS = False

MODEL_NAME = "deepset/prompt-injections"

# Lazy-loaded singleton
_classifier = None


def _get_classifier():
    global _classifier
    if _classifier is None and HAS_TRANSFORMERS:
        _classifier = pipeline(
            "text-classification",
            model=MODEL_NAME,
            tokenizer=MODEL_NAME,
            device=-1,  # CPU
        )
    return _classifier


def classify(text: str) -> dict:
    """Classify text as injection or benign.

    Returns:
        {
            "is_injection": bool,
            "confidence": float,
            "label": str,
            "available": bool,
        }
    """
    clf = _get_classifier()
    if clf is None:
        return {
            "is_injection": False,
            "confidence": 0.0,
            "label": "unavailable",
            "available": False,
        }

    # Truncate to model max length (512 tokens for distilbert)
    truncated = text[:2000]

    try:
        result = clf(truncated)[0]
        label = result["label"]
        score = result["score"]

        # deepset model labels: INJECTION / LEGIT
        is_injection = label.upper() == "INJECTION"

        return {
            "is_injection": is_injection,
            "confidence": score if is_injection else 1.0 - score,
            "label": label,
            "available": True,
        }
    except Exception as e:
        return {
            "is_injection": False,
            "confidence": 0.0,
            "label": f"error: {e}",
            "available": False,
        }
