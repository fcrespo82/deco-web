# syntax=docker/dockerfile:1

# --- build: compila backend (tsc) e frontend (vite) -------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Ferramentas para compilar o better-sqlite3 caso não haja binário pronto
# para esta plataforma (ex.: ARM de alguns NAS).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY web ./web
RUN npm run build && npm prune --omit=dev

# --- runtime -----------------------------------------------------------------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY package.json THIRD_PARTY_NOTICES.md ./
# Fixture anonimizada: só é usada com DECO_MOCK=1 (demonstração).
COPY fixtures ./fixtures

# Usuário sem privilégios (uid 1000 da imagem oficial) dono do volume.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080

# Saudável = processo de pé e banco acessível. O Deco fora do ar não torna o
# container doente (isso aparece na interface).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT||8080}/api/health`).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# SIGTERM: o servidor espera o poll em andamento fazer logout no Deco
# (até 60 s) antes de sair. Use stop_grace_period >= 75s.
STOPSIGNAL SIGTERM
CMD ["node", "dist/main.js"]
