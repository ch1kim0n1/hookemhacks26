FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./

# Install only the sentinel extras; keep torch out of the default image
# to shrink footprint — learning service installs it explicitly below.
RUN pip install --upgrade pip && \
    pip install \
        "fastapi>=0.115.0" "uvicorn[standard]>=0.32.0" \
        "web3>=6.15.0,<8" "redis[hiredis]>=5.0.0" \
        "pydantic>=2.6.0" "orjson>=3.9.0" "structlog>=24.0.0" \
        "eth-utils>=4.0.0" "eth-account>=0.11.0" "eth-abi>=5.0.0" \
        "aiohttp>=3.9.0" "websockets>=12.0" \
        "prometheus-client>=0.20.0" \
        "scikit-learn>=1.4.0" "numpy>=1.26.0"

COPY . .

CMD ["python", "-m", "detector.on_chain"]
