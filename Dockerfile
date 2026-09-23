# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# OficinaOS em containers (deploy).
#
# Duas imagens saem daqui:
#   api  → Fastify + o trabalhador de fundo (pg-boss), com as migrations junto
#   web  → Caddy servindo o painel, as páginas públicas e a landing, e fazendo
#          proxy de /api para a API (mesma origem: sem CORS, cookie funciona)
#
# Base Debian slim, e não Alpine, por causa do `@node-rs/argon2`: ele é
# compilado, e o binário musl do Alpine é um caminho a menos que precisa ser
# testado — a senha de todo mundo passa por ele.
# ---------------------------------------------------------------------------

FROM node:24-slim AS deps
WORKDIR /app
# só os manifestos primeiro: mudou código, o cache das dependências continua
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/landing/package.json apps/landing/
COPY packages/shared/package.json packages/shared/
RUN npm ci

# --------------------------------- build ----------------------------------
FROM deps AS build
WORKDIR /app
COPY . .
# a API vira um bundle (tsup), o painel e a landing viram arquivos estáticos
RUN npm run build

# ----------------------- dependências de produção --------------------------
FROM node:24-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/landing/package.json apps/landing/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev --ignore-scripts=false

# ----------------------------------- API -----------------------------------
FROM node:24-slim AS api
WORKDIR /app/apps/api
ENV NODE_ENV=production
# o Postgres é o único serviço externo obrigatório; o resto é configuração
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/api/node_modules /app/apps/api/node_modules
COPY --from=build /app/apps/api/dist ./dist
# as migrations são lidas do disco em tempo de execução (scripts/migrate.ts)
COPY --from=build /app/apps/api/src/db/migrations ./src/db/migrations
COPY apps/api/package.json ./package.json

# as fotos do check-in vivem aqui: no compose isto é um volume com backup
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node
EXPOSE 3333
ENV API_HOST=0.0.0.0 STORAGE_DIR=/app/storage

# o orquestrador pergunta se o processo está vivo; /ready diz se o banco responde
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3333)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]

# ----------------------------------- WEB -----------------------------------
FROM caddy:2-alpine AS web
# o painel e as quatro páginas públicas (uma entrada cada, ARCHITECTURE §8.2)
COPY --from=build /app/apps/web/dist /srv/painel
# a landing, que é HTML estático de verdade (Astro)
COPY --from=build /app/apps/landing/dist /srv/site
COPY deploy/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
