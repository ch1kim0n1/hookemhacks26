"""Tests for defense_agent.retry — exponential backoff + failure handling."""

from __future__ import annotations

import asyncio
import time

import pytest

from defense_agent.retry import with_retry


async def test_retry_returns_on_first_success() -> None:
    calls = []

    async def fn() -> str:
        calls.append(1)
        return "ok"

    result = await with_retry(fn, max_retries=3, base_delay=0.01)
    assert result == "ok"
    assert len(calls) == 1


async def test_retry_recovers_after_transient_failure() -> None:
    calls = []

    async def fn() -> str:
        calls.append(1)
        if len(calls) < 2:
            raise RuntimeError("transient")
        return "ok"

    result = await with_retry(fn, max_retries=3, base_delay=0.01)
    assert result == "ok"
    assert len(calls) == 2


async def test_retry_raises_last_error_after_exhaustion() -> None:
    calls = []

    async def fn() -> str:
        calls.append(1)
        raise RuntimeError(f"boom-{len(calls)}")

    with pytest.raises(RuntimeError, match="boom-3"):
        await with_retry(fn, max_retries=3, base_delay=0.01)
    assert len(calls) == 3


async def test_retry_backoff_is_exponential() -> None:
    """base_delay * 2^attempt: with base=0.05, backoff = 0.05 + 0.1 = 0.15s
    before the 3rd attempt. We measure wall-clock and allow generous slack."""
    attempts = []

    async def fn() -> None:
        attempts.append(time.monotonic())
        raise RuntimeError("fail")

    t0 = time.monotonic()
    with pytest.raises(RuntimeError):
        await with_retry(fn, max_retries=3, base_delay=0.05)
    elapsed = time.monotonic() - t0

    # Expected minimum: 0.05 (after attempt 1) + 0.10 (after attempt 2) = 0.15s.
    # The final attempt's sleep is skipped, so total >= 0.15s.
    assert elapsed >= 0.14, f"expected exponential backoff, got {elapsed:.3f}s"
    assert len(attempts) == 3


async def test_retry_max_retries_one_means_no_retry() -> None:
    calls = []

    async def fn() -> None:
        calls.append(1)
        raise ValueError("only once")

    with pytest.raises(ValueError):
        await with_retry(fn, max_retries=1, base_delay=0.01)
    assert len(calls) == 1


async def test_retry_propagates_exception_type() -> None:
    class CustomError(Exception):
        pass

    async def fn() -> None:
        raise CustomError("specific")

    with pytest.raises(CustomError):
        await with_retry(fn, max_retries=2, base_delay=0.01)


async def test_retry_description_in_logs_does_not_crash() -> None:
    """The description is interpolated into log events — must not blow up on
    unicode or special chars."""

    async def fn() -> str:
        return "ok"

    result = await with_retry(
        fn,
        max_retries=2,
        base_delay=0.01,
        description="zk-prover/POST /prove/policy (⚡)",
    )
    assert result == "ok"
