"""Real-chain client for the attacker demo.

Signs and broadcasts actual transactions to a local EVM node (default Anvil
on http://127.0.0.1:8545). Each primitive corresponds to one stage the demo
scenarios fire — flash-loan, oracle swap, probe, cover transfer, exploit.

The detection engine doesn't care whether a tx lands in the mempool via
`mempool-monitor` (real chain) or by direct Redis injection (simulated).
Feature extraction keys on `to` address and selector, both of which match
whether we construct the tx by hand or call the real contract.

Env:
    RPC_URL         http://127.0.0.1:8545 (Anvil default)
    ATTACKER_KEY    0x-prefixed private key, default = Anvil account #5
                    (matches scripts/seed-demo-state.sh)
    ADDRESSES_FILE  path to config/addresses.local.json

Raises `ChainUnavailable` if the node can't be reached or the addresses
file is missing — the caller decides whether to fall back to simulated.
"""
from __future__ import annotations

import json
import os
import pathlib
from dataclasses import dataclass

# web3 and eth_account are optional — imported lazily so simulated-only
# installs don't need them.


class ChainUnavailable(Exception):
    """Raised when the real chain path can't be used."""


# Anvil account #5 — matches scripts/seed-demo-state.sh.
DEFAULT_ATTACKER_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"
DEFAULT_RPC_URL = "http://127.0.0.1:8545"


def _repo_root() -> pathlib.Path:
    return pathlib.Path(__file__).resolve().parent.parent


def _default_addresses_file() -> pathlib.Path:
    return _repo_root() / "config" / "addresses.local.json"


def load_addresses(path: str | os.PathLike | None = None) -> dict:
    p = pathlib.Path(path) if path else _default_addresses_file()
    if not p.exists():
        raise ChainUnavailable(f"addresses file not found: {p}")
    with open(p) as f:
        data = json.load(f)
    required = ["FlashLoanProvider", "OraclePair", "USDC", "WETH",
                "VictimLendingPool", "FlashLoanAttacker"]
    missing = [k for k in required if k not in data]
    if missing:
        raise ChainUnavailable(f"addresses file missing keys: {missing}")
    return data


@dataclass
class ChainClient:
    rpc_url: str
    attacker_key: str
    addresses: dict
    w3: "object"  # web3.Web3
    acct: "object"  # eth_account.Account
    chain_id: int
    _nonce: int
    _abi = {
        "flashLoan":   "flashLoan(uint256,address,bytes)",
        "swap":        "swap(address,uint256)",
        "getReserves": "getReserves()",
        "balanceOf":   "balanceOf(address)",
        "approve":     "approve(address,uint256)",
        "transfer":    "transfer(address,uint256)",
        "attack":      "attack(address,uint256)",
        "borrow":      "borrow(uint256)",
        "deposit":     "deposit(uint256)",
    }

    @classmethod
    def connect(
        cls,
        rpc_url: str | None = None,
        attacker_key: str | None = None,
        addresses_file: str | None = None,
    ) -> "ChainClient":
        try:
            from web3 import Web3
            from eth_account import Account
        except ImportError as e:
            raise ChainUnavailable(f"web3/eth-account not installed: {e}") from e

        rpc = rpc_url or os.environ.get("RPC_URL", DEFAULT_RPC_URL)
        key = attacker_key or os.environ.get("ATTACKER_KEY", DEFAULT_ATTACKER_KEY)
        addr_file = addresses_file or os.environ.get("ADDRESSES_FILE")

        addresses = load_addresses(addr_file)

        w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 3}))
        if not w3.is_connected():
            raise ChainUnavailable(f"cannot reach RPC at {rpc}")

        try:
            chain_id = w3.eth.chain_id
            acct = Account.from_key(key)
            nonce = w3.eth.get_transaction_count(acct.address)
        except Exception as e:
            raise ChainUnavailable(f"RPC handshake failed: {e}") from e

        return cls(
            rpc_url=rpc, attacker_key=key, addresses=addresses,
            w3=w3, acct=acct, chain_id=chain_id, _nonce=nonce,
        )

    @property
    def from_address(self) -> str:
        return self.acct.address

    def _selector(self, name: str) -> bytes:
        from web3 import Web3
        return Web3.keccak(text=self._abi[name])[:4]

    def _encode(self, name: str, types: list[str], args: list) -> str:
        from eth_abi import encode
        sel = self._selector(name)
        data = sel + encode(types, args)
        return "0x" + data.hex()

    def _send(self, *, to: str, data: str, gas: int, gas_price_gwei: int,
              value: int = 0) -> str:
        from web3 import Web3
        tx = {
            "from": self.acct.address,
            "to": Web3.to_checksum_address(to),
            "data": data,
            "gas": gas,
            "gasPrice": self.w3.to_wei(gas_price_gwei, "gwei"),
            "nonce": self._nonce,
            "chainId": self.chain_id,
            "value": value,
        }
        self._nonce += 1
        signed = self.acct.sign_transaction(tx)
        raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
        try:
            tx_hash = self.w3.eth.send_raw_transaction(raw)
        except Exception as e:
            # roll nonce back so the next call isn't wedged
            self._nonce -= 1
            raise ChainUnavailable(f"send_raw_transaction failed: {e}") from e
        return tx_hash.hex() if not isinstance(tx_hash, str) else tx_hash

    # ── primitives ──────────────────────────────────────────────────────────
    def flash_loan(self, amount_wei: int, gas_price_gwei: int = 45) -> str:
        from web3 import Web3
        data = self._encode(
            "flashLoan",
            ["uint256", "address", "bytes"],
            [amount_wei, Web3.to_checksum_address(self.acct.address), b""],
        )
        return self._send(
            to=self.addresses["FlashLoanProvider"],
            data=data, gas=500_000, gas_price_gwei=gas_price_gwei,
        )

    def oracle_swap(self, amount_wei: int, gas_price_gwei: int = 52) -> str:
        from web3 import Web3
        data = self._encode(
            "swap",
            ["address", "uint256"],
            [Web3.to_checksum_address(self.addresses["WETH"]), amount_wei],
        )
        return self._send(
            to=self.addresses["OraclePair"],
            data=data, gas=400_000, gas_price_gwei=gas_price_gwei,
        )

    def probe_reserves(self, gas_price_gwei: int = 19) -> str:
        """`getReserves()` call on the oracle pair — read-only on-chain
        but broadcast as a tx so it shows up in the mempool stream."""
        data = self._encode("getReserves", [], [])
        return self._send(
            to=self.addresses["OraclePair"],
            data=data, gas=100_000, gas_price_gwei=gas_price_gwei,
        )

    def probe_balance(self, gas_price_gwei: int = 18) -> str:
        """`balanceOf(victimPool)` on USDC — probe tx."""
        from web3 import Web3
        data = self._encode(
            "balanceOf",
            ["address"],
            [Web3.to_checksum_address(self.addresses["VictimLendingPool"])],
        )
        return self._send(
            to=self.addresses["USDC"],
            data=data, gas=100_000, gas_price_gwei=gas_price_gwei,
        )

    def approve_allowance(self, amount_wei: int = 10 ** 20,
                          gas_price_gwei: int = 22) -> str:
        """Approve the flash-loan provider to pull WETH — probe/setup tx."""
        from web3 import Web3
        data = self._encode(
            "approve",
            ["address", "uint256"],
            [Web3.to_checksum_address(self.addresses["FlashLoanProvider"]),
             amount_wei],
        )
        return self._send(
            to=self.addresses["WETH"],
            data=data, gas=120_000, gas_price_gwei=gas_price_gwei,
        )

    def cover_transfer(self, to_addr: str, amount: int = 1,
                       gas_price_gwei: int = 48) -> str:
        """Tiny USDC ERC20 transfer — cover / noise tx."""
        from web3 import Web3
        data = self._encode(
            "transfer",
            ["address", "uint256"],
            [Web3.to_checksum_address(to_addr), amount],
        )
        return self._send(
            to=self.addresses["USDC"],
            data=data, gas=120_000, gas_price_gwei=gas_price_gwei,
        )

    def attack(self, loan_amount_wei: int = 10 ** 21,
               gas_price_gwei: int = 89) -> str:
        """The exploit — `FlashLoanAttacker.attack(provider, amount)`."""
        from web3 import Web3
        data = self._encode(
            "attack",
            ["address", "uint256"],
            [Web3.to_checksum_address(self.addresses["FlashLoanProvider"]),
             loan_amount_wei],
        )
        return self._send(
            to=self.addresses["FlashLoanAttacker"],
            data=data, gas=2_000_000, gas_price_gwei=gas_price_gwei,
        )

    def victim_borrow(self, amount_wei: int, gas_price_gwei: int = 36) -> str:
        """`VictimLendingPool.borrow(amount)` — probably reverts without
        collateral, but the tx still lands in mempool with correct selector."""
        data = self._encode("borrow", ["uint256"], [amount_wei])
        return self._send(
            to=self.addresses["VictimLendingPool"],
            data=data, gas=400_000, gas_price_gwei=gas_price_gwei,
        )

    def victim_deposit(self, amount_wei: int, gas_price_gwei: int = 28) -> str:
        """`VictimLendingPool.deposit(usdc)` — benign LP-style tx."""
        data = self._encode("deposit", ["uint256"], [amount_wei])
        return self._send(
            to=self.addresses["VictimLendingPool"],
            data=data, gas=300_000, gas_price_gwei=gas_price_gwei,
        )
