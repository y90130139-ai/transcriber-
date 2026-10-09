FROM python:3.12-slim

# curl signs every R2 upload (aws-sigv4), exactly like the Mac's worker does —
# no boto3, no extra SDKs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && patchright install --with-deps chromium

COPY . .

# The browser profile lives on the volume, so the OFM Pro session survives
# redeploys — the whole point of an anti-detect profile is that it is kept.
ENV DATA_DIR=/data
VOLUME /data

CMD ["python", "main.py"]
