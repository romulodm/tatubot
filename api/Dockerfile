# Mesma imagem para a api (padrão) e o worker (o compose troca o comando).
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

RUN mkdir -p /data/repos && chown -R node:node /data
USER node

ENV PORTA=4000 REPOS_DIR=/data/repos
EXPOSE 4000
CMD ["node", "src/server.js"]
