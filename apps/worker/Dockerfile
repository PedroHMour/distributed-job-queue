# =============================================================================
# Estágio 1: base
# =============================================================================
FROM node:20-alpine AS base

RUN apk add --no-cache openssl libc6-compat

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nodeapp

WORKDIR /app

# =============================================================================
# Estágio 2: deps
# =============================================================================
FROM base AS deps

COPY package.json package-lock.json* ./
COPY packages/shared/package.json    ./packages/shared/package.json
COPY apps/api/package.json           ./apps/api/package.json
COPY apps/worker/package.json        ./apps/worker/package.json

RUN npm ci --workspace=packages/shared \
            --workspace=apps/worker \
            --include-workspace-root

COPY packages/shared/prisma ./packages/shared/prisma
RUN npx prisma generate --schema=packages/shared/prisma/schema.prisma

# =============================================================================
# Estágio 3: builder
# =============================================================================
FROM deps AS builder

COPY tsconfig.base.json               ./
COPY packages/shared/tsconfig.json    ./packages/shared/tsconfig.json
COPY packages/shared/src              ./packages/shared/src
COPY apps/worker/tsconfig.json        ./apps/worker/tsconfig.json
COPY apps/worker/src                  ./apps/worker/src

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/worker

# =============================================================================
# Estágio 4: runner
# =============================================================================
FROM base AS runner

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder --chown=nodeapp:nodejs /app/node_modules               ./node_modules


COPY --from=builder --chown=nodeapp:nodejs /app/packages/shared/dist       ./packages/shared/dist
COPY --from=builder --chown=nodeapp:nodejs /app/apps/worker/dist           ./apps/worker/dist

COPY --from=builder --chown=nodeapp:nodejs /app/packages/shared/prisma     ./packages/shared/prisma

COPY --from=builder --chown=nodeapp:nodejs /app/package.json               ./package.json
COPY --from=builder --chown=nodeapp:nodejs /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=nodeapp:nodejs /app/apps/worker/package.json   ./apps/worker/package.json

USER nodeapp

# Workers não expõem portas — comunicação é exclusivamente via Redis/Postgres

# Stalled job detection: se o container morrer sem graceful shutdown, o BullMQ
# detecta jobs travados em ACTIVE após stalledInterval (configurado no worker)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "var fs=require('fs');var t=parseInt(fs.readFileSync('/tmp/worker-alive','utf8'));process.exit(Date.now()-t<60000?0:1)"

# Sem migration — apenas o processo worker
CMD ["node", "apps/worker/dist/apps/worker/src/index.js"]