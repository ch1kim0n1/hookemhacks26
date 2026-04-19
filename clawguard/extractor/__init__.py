"""Multimodal text extraction — delegates to the top-level :mod:`extractor` package."""

from extractor import extract_all, extract_audio, extract_image, extract_pdf, extract_text

__all__ = ["extract_all", "extract_audio", "extract_image", "extract_pdf", "extract_text"]
