import asyncio
import pytest
import redis.asyncio as redis
from .publisher import StreamPublisher
from .consumer import StreamConsumer

REDIS_URL = "redis://127.0.0.1:6379"

@pytest.fixture
async def r():
    client = redis.from_url(REDIS_URL, decode_responses=True)
    yield client
    await client.aclose()

@pytest.mark.asyncio
async def test_consumer_receives_messages(r):
    stream = "test.py.consumer"
    group = "test-py-group"
    await r.delete(stream)

    pub = StreamPublisher(r)
    await pub.publish(stream, {"val": "one"})
    await pub.publish(stream, {"val": "two"})

    received: list[dict] = []

    async def handler(msg_id: str, data: dict) -> None:
        received.append(data)

    consumer = StreamConsumer(
        redis.from_url(REDIS_URL, decode_responses=True),
        stream=stream, group=group, consumer_name="worker-1",
        handler=handler, block_ms=500,
    )
    task = asyncio.create_task(consumer.start())
    await asyncio.sleep(2)
    await consumer.stop()
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

    assert len(received) == 2
    assert received[0]["val"] == "one"
    assert received[1]["val"] == "two"
    await r.delete(stream)
