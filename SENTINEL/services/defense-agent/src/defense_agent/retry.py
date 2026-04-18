import asyncio
import structlog

log = structlog.get_logger()


async def with_retry(fn, max_retries=3, base_delay=1.0, description="operation"):
    """Execute fn with exponential backoff retry."""
    last_error = None
    for attempt in range(max_retries):
        try:
            return await fn()
        except Exception as exc:
            last_error = exc
            delay = base_delay * (2 ** attempt)
            log.warning(
                f"{description}.retry",
                attempt=attempt + 1,
                max_retries=max_retries,
                delay=delay,
                error=str(exc),
            )
            if attempt < max_retries - 1:
                await asyncio.sleep(delay)
    raise last_error
