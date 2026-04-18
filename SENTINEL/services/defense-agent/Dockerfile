FROM python:3.11-slim AS builder
WORKDIR /app
RUN pip install --no-cache-dir poetry==1.7.1
COPY services/defense-agent/pyproject.toml services/defense-agent/poetry.lock* services/defense-agent/
WORKDIR /app/services/defense-agent
RUN poetry export -f requirements.txt -o requirements.txt --without-hashes || poetry install --no-root && poetry export -f requirements.txt -o requirements.txt --without-hashes

FROM python:3.11-slim
WORKDIR /app
RUN groupadd -r sentinel && useradd -r -g sentinel sentinel
COPY --from=builder /app/services/defense-agent/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY services/defense-agent/src ./src
COPY services/shared-python/sentinel_streams ./sentinel_streams
ENV PYTHONPATH=/app/src:/app
USER sentinel
HEALTHCHECK --interval=10s --timeout=3s CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:9004/health')" || exit 1
CMD ["python3", "-m", "defense_agent"]
