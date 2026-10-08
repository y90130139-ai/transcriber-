FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app
COPY . /app

RUN python -m pip install --no-cache-dir playwright==1.55.0 \
    && python -m playwright install --with-deps chromium \
    && mkdir -p /data/secrets

CMD ["python", "-m", "src.railway_worker"]
