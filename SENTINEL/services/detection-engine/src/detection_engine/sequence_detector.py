"""LSTM neural-network sequence detector.

Classifies per-EOA transaction sequences as attack (1) or normal (0).
Architecture: 2-layer unidirectional LSTM (hidden=64) → Linear(64,1) → Sigmoid.
Processes the 5-tx window as a true time series — preserves temporal ordering
that the earlier MLP (which flattened the window) could not model.

Trains from scratch at service startup in ~3s on CPU.
"""
from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

from .tx_features import FEATURE_DIM, extract

SEQ_LEN = 5  # number of txs per sequence window


def _to_tensor(txs: list[dict]) -> torch.Tensor:
    """Convert list of tx dicts to a (SEQ_LEN, FEATURE_DIM) float32 tensor.

    Truncates to the last SEQ_LEN txs; zero-pads shorter sequences on the left.
    """
    feats = [extract(t) for t in txs[-SEQ_LEN:]]
    while len(feats) < SEQ_LEN:
        feats.insert(0, [0.0] * FEATURE_DIM)
    return torch.tensor(feats, dtype=torch.float32)


class _LSTMNet(nn.Module):
    def __init__(self, input_size: int, hidden_size: int, num_layers: int) -> None:
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=0.2 if num_layers > 1 else 0.0,
        )
        self.head = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, seq_len, features)
        _, (h_n, _) = self.lstm(x)
        # h_n: (num_layers, batch, hidden_size) — take last layer
        return self.head(h_n[-1]).squeeze(1)


class SequenceDetector:
    """LSTM neural network for tx-sequence classification.

    Usage:
        det = SequenceDetector()
        det.train()                # call once at service startup (~3s on CPU)
        p = det.predict(seq)       # list of tx dicts, returns float in [0,1]
    """

    def __init__(self, *, seed: int = 0) -> None:
        # Deterministic torch init per-operator.
        torch.manual_seed(seed)
        self._seed = seed
        self._net = _LSTMNet(input_size=FEATURE_DIM, hidden_size=64, num_layers=2)
        self._trained = False

    @property
    def trained(self) -> bool:
        return self._trained

    @property
    def seed(self) -> int:
        return self._seed

    def train(self, n_attack: int = 300, n_normal: int = 700) -> None:
        """Generate synthetic training data and fit the LSTM.

        Attack sequences follow the flash-loan oracle-manipulation pattern:
          tx1 large loan → tx2 oracle dump → tx3-4 filler → tx5 attack call.
        Normal sequences are low-value random transfers with variable length.
        """
        rng = np.random.default_rng(self._seed)

        sequences: list[np.ndarray] = []
        labels: list[int] = []

        for _ in range(n_attack):
            seq = np.array([
                [rng.uniform(0.5, 10.0), 0.0,                  rng.uniform(0.2, 0.5),  0.0, 0.0],
                [0.0,                    rng.uniform(5.0, 15.0), rng.uniform(0.3, 0.6), 0.0, 1.0],
                [0.0,                    0.0,                    rng.uniform(0.15, 0.25), 0.0, 0.0],
                [0.0,                    0.0,                    rng.uniform(0.15, 0.25), 0.0, 0.0],
                [0.0,                    0.0,                    rng.uniform(0.4, 0.8),  1.0, 0.0],
            ], dtype=np.float32)
            sequences.append(seq)
            labels.append(1)

        for _ in range(n_normal):
            seq_len = int(rng.integers(1, SEQ_LEN + 1))
            seq = np.zeros((SEQ_LEN, FEATURE_DIM), dtype=np.float32)
            for i in range(SEQ_LEN - seq_len, SEQ_LEN):
                seq[i] = [
                    rng.uniform(0.0, 0.03),
                    rng.uniform(0.0, 0.5),
                    rng.uniform(0.1, 0.3),
                    0.0,
                    0.0,
                ]
            sequences.append(seq)
            labels.append(0)

        X = torch.tensor(np.array(sequences), dtype=torch.float32)
        y = torch.tensor(labels, dtype=torch.float32)
        idx = torch.randperm(len(y), generator=torch.Generator().manual_seed(self._seed))
        X, y = X[idx], y[idx]

        dataset = TensorDataset(X, y)
        loader = DataLoader(dataset, batch_size=32, shuffle=False)

        optimizer = torch.optim.Adam(self._net.parameters(), lr=1e-3)
        loss_fn = nn.BCELoss()

        self._net.train()
        for _ in range(80):
            for xb, yb in loader:
                optimizer.zero_grad()
                loss_fn(self._net(xb), yb).backward()
                optimizer.step()

        self._net.eval()
        self._trained = True

    def predict(self, tx_sequence: list[dict]) -> float:
        """Return P(attack sequence) in [0, 1].

        Returns 0.0 if train() has not been called or sequence is empty.
        """
        if not self._trained or len(tx_sequence) == 0:
            return 0.0
        x = _to_tensor(tx_sequence).unsqueeze(0)  # (1, SEQ_LEN, FEATURE_DIM)
        with torch.no_grad():
            return float(self._net(x).item())
