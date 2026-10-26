# Escala on WhatsApp. Node 22 runs the TypeScript sources directly (type stripping); no build step.
FROM node:22.15.0-slim
ENV NODE_ENV=production
# ffmpeg turns WhatsApp voice notes (OGG/Opus) into the WAV that Muse Voice Transcribe accepts.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# /data is the volume for the encrypted memory and the usage log. Hosts mount volumes as root, so the container
# starts as root only to hand /data to the unprivileged "node" user, then drops privileges for good.
RUN mkdir -p /data
ENV HOST=0.0.0.0 MEMORY_DB=/data/memory.db USAGE_LOG=/data/usage.jsonl
EXPOSE 8080
CMD ["sh", "-c", "chown node:node /data && exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all --bounding-set=-all --no-new-privs node --experimental-strip-types --no-warnings packages/server/src/main.ts"]
