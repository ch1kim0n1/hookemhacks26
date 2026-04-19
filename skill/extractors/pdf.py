"""Extract text from PDFs: visible text, hidden layers, metadata, embedded files."""

from io import BytesIO
from pathlib import Path

try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False

try:
    from pypdf import PdfReader
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False


def extract_pdf(pdf_path: str | bytes) -> dict:
    """Extract all text from a PDF across multiple layers.

    Returns:
        {"text": str, "manifest": list}
    """
    manifest = []
    texts = []

    pdf_bytes = (
        Path(pdf_path).read_bytes() if isinstance(pdf_path, str) else pdf_path
    )

    # --- pdfplumber: visible/rendered text ---
    if HAS_PDFPLUMBER:
        try:
            with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
                for i, page in enumerate(pdf.pages):
                    text = page.extract_text() or ""
                    if text.strip():
                        texts.append(text)
                        manifest.append({
                            "source": "pdfplumber_visible",
                            "page": i + 1,
                            "length": len(text),
                        })

                    # Check for annotations
                    if page.annots:
                        for annot in page.annots:
                            content = annot.get("contents", "")
                            if content:
                                texts.append(f"[PDF_ANNOTATION p{i+1}: {content}]")
                                manifest.append({
                                    "source": "pdf_annotation",
                                    "page": i + 1,
                                    "content": content,
                                })
        except Exception as e:
            manifest.append({"source": "pdfplumber_error", "error": str(e)})
    else:
        manifest.append({"source": "pdfplumber_skipped", "reason": "not installed"})

    # --- pypdf: hidden layers, metadata, embedded files ---
    if HAS_PYPDF:
        try:
            reader = PdfReader(BytesIO(pdf_bytes))

            # Metadata
            meta = reader.metadata
            if meta:
                meta_parts = []
                for key in ["/Title", "/Author", "/Subject", "/Keywords",
                            "/Creator", "/Producer"]:
                    val = meta.get(key, "")
                    if val:
                        meta_parts.append(f"{key}: {val}")
                if meta_parts:
                    meta_text = "\n".join(meta_parts)
                    texts.append(f"[PDF_METADATA:\n{meta_text}]")
                    manifest.append({"source": "pdf_metadata", "fields": meta_parts})

            # Hidden text layers (text that pdfplumber might miss)
            for i, page in enumerate(reader.pages):
                raw = page.extract_text() or ""
                # Compare with pdfplumber output — if there's extra text, flag it
                if raw.strip() and raw.strip() not in "\n".join(texts):
                    texts.append(f"[PDF_HIDDEN_LAYER p{i+1}: {raw}]")
                    manifest.append({
                        "source": "pdf_hidden_layer",
                        "page": i + 1,
                        "length": len(raw),
                    })

            # Embedded files
            if "/Names" in reader.trailer.get("/Root", {}):
                try:
                    root = reader.trailer["/Root"]
                    names = root.get("/Names", {})
                    ef = names.get("/EmbeddedFiles", {})
                    if ef:
                        texts.append("[PDF_EMBEDDED_FILES_DETECTED]")
                        manifest.append({"source": "pdf_embedded_files"})
                except Exception:
                    pass

            # JavaScript actions (very suspicious in a document)
            for i, page in enumerate(reader.pages):
                if "/AA" in page or "/JS" in page:
                    texts.append("[PDF_JAVASCRIPT_DETECTED]")
                    manifest.append({"source": "pdf_javascript", "page": i + 1})
                    break

        except Exception as e:
            manifest.append({"source": "pypdf_error", "error": str(e)})
    else:
        manifest.append({"source": "pypdf_skipped", "reason": "not installed"})

    return {"text": "\n".join(texts), "manifest": manifest}
