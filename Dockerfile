FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PORT=3000

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN python3 -m venv "$VIRTUAL_ENV" \
    && pip install --no-cache-dir -r requirements.txt

COPY ui/package.json ui/package-lock.json ./ui/
WORKDIR /app/ui
RUN npm ci

WORKDIR /app
COPY . .

WORKDIR /app/ui
RUN npm run build

WORKDIR /app
RUN chmod +x /app/docker/start-prod.sh

EXPOSE 3000

CMD ["/app/docker/start-prod.sh"]
