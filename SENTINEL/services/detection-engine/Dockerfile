FROM python:3.11-slim AS builder
WORKDIR /app
RUN pip install --no-cache-dir poetry==1.7.1
COPY services/detection-engine/pyproject.toml services/detection-engine/poetry.lock* services/detection-engine/
WORKDIR /app/services/detection-engine
RUN poetry export -f requirements.txt -o requirements.txt --without-hashes || poetry install --no-root && poetry export -f requirements.txt -o requirements.txt --without-hashes

FROM python:3.11-slim
WORKDIR /app
RUN groupadd -r sentinel && useradd -r -g sentinel sentinel
COPY --from=builder /app/services/detection-engine/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/detection-engine/src ./src
COPY services/shared-python/sentinel_streams ./sentinel_streams
ENV PYTHONPATH=/app/src:/app
USER sentinel
HEALTHCHECK --interval=10s --timeout=3s CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:9003/health')" || exit 1
CMD ["python3", "-m", "detection_engine"]
