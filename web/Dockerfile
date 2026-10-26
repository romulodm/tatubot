# Front + autenticação (Next.js, saída standalone).
FROM node:22-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
# os rewrites de /api/* ficam gravados no build, então o endereço da api entra aqui
ARG API_URL=http://api:4000
ENV API_URL=$API_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# a chave privada do JWT é gerada no primeiro boot, no volume /data/chaves
RUN mkdir -p /data/chaves && chown -R node:node /data /app
USER node
ENV JWT_PRIVATE_KEY_PATH=/data/chaves/jwt-privada.pem
EXPOSE 3000
CMD ["node", "server.js"]
