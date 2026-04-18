import json
import pytest
import redis.asyncio as redis
from .publisher import StreamPublisher

REDIS_URL = "redis://127.0.0.1:6379"

@pytest.fixture
async def r():
    client = redis.from_url(REDIS_URL, decode_responses=True)
    yield client
    await client.aclose()

@pytest.mark.asyncio
async def test_publish_adds_to_stream(r):
    await r.delete("test.py.stream")
    pub = StreamPublisher(r)
    msg_id = await pub.publish("test.py.stream", {"schema": "Test@1", "n": 1})
    assert msg_id is not None
    messages = await r.xrange("test.py.stream")
    assert len(messages) >= 1
    _, fields = messages[-1]
    data = json.loads(fields["data"])
    assert data["schema"] == "Test@1"
    assert data["n"] == 1
    await r.delete("test.py.stream")

@pytest.mark.asyncio
async def test_publish_trims(r):
    stream = "test.py.trim"
    await r.delete(stream)
    pub = StreamPublisher(r, max_len=5)
    for i in range(10):
        await pub.publish(stream, {"i": i})
    length = await r.xlen(stream)
    assert length <= 7
    await r.delete(stream)
