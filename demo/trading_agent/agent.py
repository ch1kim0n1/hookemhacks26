"""Demo financial agent — reads news and places paper trades via Alpaca sandbox.
Demonstrates ClawGuard protecting against injection attacks."""

import json
import os
import sys
from pathlib import Path
from datetime import datetime

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

try:
    from alpaca.trading.client import TradingClient
    from alpaca.trading.requests import MarketOrderRequest
    from alpaca.trading.enums import OrderSide, TimeInForce
    HAS_ALPACA = True
except ImportError:
    HAS_ALPACA = False

from skill.handler import intercept, ContentBlocked


class TradingAgent:
    """Simple agent that reads news and makes trade decisions.

    With ClawGuard disabled, it follows injected instructions.
    With ClawGuard enabled, attacks are caught and blocked.
    """

    def __init__(self, clawguard_enabled: bool = True):
        self.clawguard_enabled = clawguard_enabled
        self.trades: list[dict] = []  # paper trade log
        self.alerts: list[dict] = []  # security alerts

        if HAS_ALPACA and os.getenv("ALPACA_API_KEY"):
            self.alpaca = TradingClient(
                os.getenv("ALPACA_API_KEY"),
                os.getenv("ALPACA_SECRET_KEY"),
                paper=True,
            )
        else:
            self.alpaca = None

    def process_content(self, content: str | bytes, source: str,
                        content_type: str | None = None,
                        filename: str | None = None) -> dict:
        """Process incoming content through ClawGuard, then act on it.

        Args:
            content: raw content (email, image bytes, pdf bytes, etc.)
            source: description of where content came from
            content_type: MIME type
            filename: filename if applicable

        Returns:
            {
                "source": str,
                "clawguard_enabled": bool,
                "action_taken": str,
                "clawguard_result": dict | None,
                "trade": dict | None,
            }
        """
        result = {
            "source": source,
            "clawguard_enabled": self.clawguard_enabled,
            "action_taken": None,
            "clawguard_result": None,
            "trade": None,
            "timestamp": datetime.now().isoformat(),
        }

        # Run through ClawGuard
        try:
            guard_result = intercept(
                tool_name="email_read" if "email" in source.lower() else
                          "image_view" if content_type and "image" in content_type else
                          "file_read",
                content=content,
                content_type=content_type,
                filename=filename,
                enabled=self.clawguard_enabled,
            )
            result["clawguard_result"] = {
                "action": guard_result["action"],
                "verdict": guard_result["verdict"]["verdict"],
                "confidence": guard_result["verdict"]["confidence"],
                "reasons": guard_result["verdict"]["reasons"],
            }

            # Use the (possibly sanitized) content
            safe_content = guard_result["content"]

        except ContentBlocked as e:
            result["clawguard_result"] = {
                "action": "block",
                "verdict": "block",
                "confidence": e.verdict["confidence"],
                "reasons": e.verdict["reasons"],
            }
            result["action_taken"] = "BLOCKED by ClawGuard"
            self.alerts.append(result.copy())
            return result

        # Agent "reasoning" — naive keyword-based for demo purposes
        trade = self._decide_trade(safe_content, source)
        if trade:
            result["trade"] = trade
            result["action_taken"] = f"{trade['side']} {trade['qty']} {trade['symbol']}"
            self.trades.append(trade)

            # Execute via Alpaca if available
            if self.alpaca:
                self._execute_trade(trade)
        else:
            result["action_taken"] = "No trade signal detected"

        return result

    def _decide_trade(self, content: str, source: str) -> dict | None:
        """Naive trade decision based on keywords. In a real agent this would be LLM-driven."""
        content_lower = content.lower()

        # Look for trade signals (intentionally naive — the point is showing injection)
        if any(word in content_lower for word in ["sell all", "liquidate", "dump everything"]):
            return {
                "symbol": "AAPL",
                "side": "SELL",
                "qty": 100,
                "reason": f"Signal from {source}: liquidation instruction",
                "timestamp": datetime.now().isoformat(),
            }

        if any(word in content_lower for word in ["buy", "strong buy", "accumulate"]):
            return {
                "symbol": "AAPL",
                "side": "BUY",
                "qty": 10,
                "reason": f"Signal from {source}: buy signal",
                "timestamp": datetime.now().isoformat(),
            }

        if "sell" in content_lower and ("urgent" in content_lower or "immediately" in content_lower):
            return {
                "symbol": "AAPL",
                "side": "SELL",
                "qty": 50,
                "reason": f"Signal from {source}: urgent sell",
                "timestamp": datetime.now().isoformat(),
            }

        return None

    def _execute_trade(self, trade: dict):
        """Execute a paper trade via Alpaca."""
        try:
            order = MarketOrderRequest(
                symbol=trade["symbol"],
                qty=trade["qty"],
                side=OrderSide.BUY if trade["side"] == "BUY" else OrderSide.SELL,
                time_in_force=TimeInForce.DAY,
            )
            self.alpaca.submit_order(order)
            trade["executed"] = True
        except Exception as e:
            trade["executed"] = False
            trade["error"] = str(e)


def run_demo():
    """Run the full demo with all three attack vectors, ClawGuard on and off."""
    attacks_dir = Path(__file__).parent.parent / "attacks"

    attack_files = [
        {
            "name": "Bloomberg Email Injection",
            "file": "bloomberg_email.eml",
            "content_type": "message/rfc822",
            "source": "Bloomberg Terminal Email",
        },
        {
            "name": "White-on-White Chart Image",
            "file": "chart_injection.png",
            "content_type": "image/png",
            "source": "Trading Chart Image",
        },
        {
            "name": "Hidden PDF Layer",
            "file": "earnings_report.pdf",
            "content_type": "application/pdf",
            "source": "Earnings Report PDF",
        },
    ]

    for enabled in [False, True]:
        status = "ON" if enabled else "OFF"
        print(f"\n{'='*60}")
        print(f"  ClawGuard: {status}")
        print(f"{'='*60}\n")

        agent = TradingAgent(clawguard_enabled=enabled)

        for attack in attack_files:
            filepath = attacks_dir / attack["file"]
            if not filepath.exists():
                print(f"  [!] Missing fixture: {filepath}")
                print(f"      Run: python demo/attacks/generate_fixtures.py\n")
                continue

            content = filepath.read_bytes()
            print(f"  --- {attack['name']} ---")

            result = agent.process_content(
                content=content,
                source=attack["source"],
                content_type=attack["content_type"],
                filename=attack["file"],
            )

            print(f"  Action: {result['action_taken']}")
            if result["clawguard_result"]:
                cg = result["clawguard_result"]
                print(f"  Verdict: {cg['verdict']} (confidence: {cg['confidence']:.2f})")
                if cg["reasons"]:
                    for r in cg["reasons"][:3]:
                        print(f"    - {r}")
            if result["trade"]:
                t = result["trade"]
                print(f"  Trade: {t['side']} {t['qty']} {t['symbol']}")
            print()

        print(f"  Total trades executed: {len(agent.trades)}")
        print(f"  Alerts raised: {len(agent.alerts)}")


if __name__ == "__main__":
    run_demo()
