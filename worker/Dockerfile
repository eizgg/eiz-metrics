# Worker de análisis de video. Construir desde la raíz del repo:
#   docker build -f worker/Dockerfile -t eiz-analysis-worker .
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng ca-certificates \
    && pip3 install --no-cache-dir --break-system-packages faster-whisper yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm i --no-save tsx
COPY lib ./lib
COPY worker ./worker

# Variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY (+ ANTHROPIC_MODEL, precios opcionales)
CMD ["npx", "tsx", "worker/src/main.ts"]
