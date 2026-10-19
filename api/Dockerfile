# Imagem única para os dois processos do serviço:
#   api    -> node src/server.js  (padrão)
#   worker -> node src/worker.js  (o docker compose troca o comando)
FROM node:22-bookworm-slim

# git: o worker clona e atualiza os repositórios indexados.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Dependências primeiro: a camada fica em cache enquanto o package.json não muda.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# Pasta dos clones, gravável pelo usuário sem privilégios.
RUN mkdir -p /data/repos && chown -R node:node /data
USER node

ENV PORTA=4000 REPOS_DIR=/data/repos
EXPOSE 4000
CMD ["node", "src/server.js"]
