# syntax=docker/dockerfile:1.6
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POETRY_VIRTUALENVS_CREATE=false \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        wget curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY services/federation-coordinator/pyproject.toml /app/pyproject.toml
RUN pip install poetry==1.7.1 && poetry install --no-interaction --no-ansi --no-root --without dev

COPY services/federation-coordinator/src /app/src
COPY services/shared-python /opt/shared-python

ENV PYTHONPATH=/app/src:/opt/shared-python

EXPOSE 9010

CMD ["python", "-m", "federation_coordinator"]
