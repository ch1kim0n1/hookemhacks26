# syntax=docker/dockerfile:1.7
# ClawGuard decentralised node — runs on ECS Fargate.
#
# The image is deliberately small: Python 3.12-slim + the subset of skill/ we
# actually need on a node (chain client, KMS signer, envelope, Bedrock judge).
# Secrets and keys arrive via env vars injected by the ECS task definition;
# nothing sensitive is baked into the image.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Build deps for coincurve / cryptography wheels that aren't pre-built for linux/arm64.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libffi-dev libssl-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY node/requirements.txt /app/node/requirements.txt
RUN pip install -r /app/node/requirements.txt

# Only copy what a node actually imports. Keeps the image free of dashboards,
# migrations, pdf-generation, transformers, etc.
COPY skill/__init__.py                    /app/skill/__init__.py
COPY skill/chain/__init__.py              /app/skill/chain/__init__.py
COPY skill/chain/kms_signer.py            /app/skill/chain/kms_signer.py
COPY skill/chain/envelope.py              /app/skill/chain/envelope.py
COPY skill/config/__init__.py             /app/skill/config/__init__.py
COPY skill/config/secrets.py              /app/skill/config/secrets.py
COPY skill/detectors/__init__.py          /app/skill/detectors/__init__.py
COPY skill/detectors/bedrock_judge.py     /app/skill/detectors/bedrock_judge.py
COPY node/entrypoint.py                   /app/node/entrypoint.py

# Drop privileges — runs as unprivileged user inside a read-only root FS
# (the ECS task def sets readonlyRootFilesystem=true).
RUN useradd --system --uid 10001 --shell /usr/sbin/nologin clawguard \
    && chown -R clawguard:clawguard /app
USER clawguard

# Build metadata — surfaced by /health for operators.
ARG GIT_SHA="unknown"
ENV CLAWGUARD_IMAGE_SHA=${GIT_SHA}

ENTRYPOINT ["python", "-m", "node.entrypoint"]
