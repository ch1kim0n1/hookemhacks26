"""Extract text from audio using OpenAI Whisper."""

import tempfile

try:
    import whisper
    HAS_WHISPER = True
except ImportError:
    HAS_WHISPER = False


def extract_audio(audio_path: str | bytes, model_size: str = "base") -> dict:
    """Transcribe audio and return text with manifest.

    Args:
        audio_path: file path or raw bytes
        model_size: whisper model size (tiny, base, small, medium, large)

    Returns:
        {"text": str, "manifest": list}
    """
    manifest = []
    texts = []

    if not HAS_WHISPER:
        return {
            "text": "",
            "manifest": [{"source": "whisper_skipped", "reason": "openai-whisper not installed"}],
        }

    # Write bytes to temp file if needed
    if isinstance(audio_path, bytes):
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_path)
            audio_path = f.name

    try:
        model = whisper.load_model(model_size)
        result = model.transcribe(str(audio_path))

        full_text = result["text"].strip()
        texts.append(full_text)
        manifest.append({
            "source": "whisper_transcription",
            "model": model_size,
            "language": result.get("language", "unknown"),
            "length": len(full_text),
        })

        # Also include segment-level data for better tracing
        for seg in result.get("segments", []):
            manifest.append({
                "source": "whisper_segment",
                "start": seg["start"],
                "end": seg["end"],
                "text": seg["text"].strip(),
            })

    except Exception as e:
        manifest.append({"source": "whisper_error", "error": str(e)})

    return {"text": "\n".join(texts), "manifest": manifest}
