FROM python:3.11-slim-bookworm

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml /app/
COPY skill/ /app/skill/
COPY detector/ /app/detector/
COPY extractor/ /app/extractor/

ENV PYTHONPATH=/app
RUN pip install --no-cache-dir pip setuptools wheel \
    && pip install --no-cache-dir -e ".[dev]"

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
    CMD curl -fsS http://127.0.0.1:8000/api/ready || exit 1

CMD ["uvicorn", "skill.api:app", "--host", "0.0.0.0", "--port", "8000"]
