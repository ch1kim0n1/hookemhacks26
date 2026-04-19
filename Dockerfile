FROM python:3.11-slim-bookworm AS builder

WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md /build/
COPY skill/ /build/skill/
COPY detector/ /build/detector/
COPY extractor/ /build/extractor/
COPY blockchain/ /build/blockchain/
COPY network/ /build/network/
COPY learning/ /build/learning/
COPY zk/ /build/zk/
COPY api/ /build/api/
COPY alembic.ini /build/

RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir --prefix=/install ".[chain,aws,observability]"

# ---------------------------------------------------------------------------

FROM python:3.11-slim-bookworm AS runtime

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /usr/sbin/nologin clawguard

COPY --from=builder /install /usr/local
COPY skill/ /app/skill/
COPY detector/ /app/detector/
COPY extractor/ /app/extractor/
COPY blockchain/ /app/blockchain/
COPY network/ /app/network/
COPY learning/ /app/learning/
COPY zk/ /app/zk/
COPY api/ /app/api/
COPY alembic.ini /app/
COPY pyproject.toml /app/

ENV PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    CLAWGUARD_ZK_PREWARM=0 \
    CLAWGUARD_DISABLE_SIGNAL_HANDLERS=1

USER clawguard
EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8000${CLAWGUARD_PATH_PREFIX:-}/api/health || exit 1

CMD ["uvicorn", "skill.api:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
