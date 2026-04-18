"""Detection __main__ uses a simplified oracle deviation until eth_call-based pricing exists."""

from pathlib import Path


def test_main_documents_eth_call_for_real_oracle_deviation():
    main_py = Path(__file__).resolve().parents[1] / "src" / "detection_engine" / "__main__.py"
    text = main_py.read_text()
    assert "eth_call" in text
    assert "price_deviation" in text
