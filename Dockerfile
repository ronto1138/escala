# Escala on WhatsApp. Node 22 runs the TypeScript sources directly (type stripping); no build step.
FROM node:22.15.0-slim
ENV NODE_ENV=production
# ffmpeg turns WhatsApp voice notes (OGG/Opus) into the WAV that Muse Voice Transcribe accepts, and back for the card.
# Python runs Kokoro (Apache 2.0) through kokoro-onnx (MIT) to read the immigration card aloud, on this server.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY services/tts/requirements.txt /opt/tts/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /opt/tts/requirements.txt
# The int8 weights and the voices, pinned by hash: a changed file fails the build.
RUN curl -fsSL -o /opt/tts/kokoro-v1.0.int8.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx \
 && curl -fsSL -o /opt/tts/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin \
 && printf '%s\n' "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb  /opt/tts/kokoro-v1.0.int8.onnx" \
      "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d  /opt/tts/voices-v1.0.bin" | sha256sum -c - \
 && chmod -R a+rX /opt/tts
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services ./services
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# /data is the volume for the encrypted memory and the usage log. Hosts mount volumes as root, so the container
# starts as root only to hand /data to the unprivileged "node" user, then drops privileges for good.
RUN mkdir -p /data
ENV HOST=0.0.0.0 MEMORY_DB=/data/memory.db USAGE_LOG=/data/usage.jsonl
EXPOSE 8080
CMD ["sh", "-c", "chown node:node /data && exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all --bounding-set=-all --no-new-privs node --experimental-strip-types --no-warnings packages/server/src/main.ts"]
