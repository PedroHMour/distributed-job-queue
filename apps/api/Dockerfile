FROM node:20-alpine AS base

RUN apk add --no-cache openssl libc6-compat

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nodeapp

WORKDIR /app

FROM base AS deps

COPY package.json package-lock.json* ./
COPY packages/shared/package.json  ./packages/shared/package.json
COPY apps/api/package.json          ./apps/api/package.json
COPY apps/worker/package.json       ./apps/worker/package.json

RUN npm ci --workspace=packages/shared \
            --workspace=apps/api \
            --include-workspace-root

COPY packages/shared/prisma ./packages/shared/prisma
RUN npx prisma generate --schema=packages/shared/prisma/schema.prisma

FROM deps AS builder

COPY tsconfig.base.json             ./
COPY packages/shared/tsconfig.json  ./packages/shared/tsconfig.json
COPY packages/shared/src            ./packages/shared/src
COPY apps/api/tsconfig.json         ./apps/api/tsconfig.json
COPY apps/api/src                   ./apps/api/src

RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=apps/api

FROM base AS runner

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder --chown=nodeapp:nodejs /app/node_modules             ./node_modules
COPY --from=builder --chown=nodeapp:nodejs /app/packages/shared/dist     ./packages/shared/dist
COPY --from=builder --chown=nodeapp:nodejs /app/apps/api/dist            ./apps/api/dist
COPY --from=builder --chown=nodeapp:nodejs /app/packages/shared/prisma   ./packages/shared/prisma
COPY --from=builder --chown=nodeapp:nodejs /app/package.json             ./package.json
COPY --from=builder --chown=nodeapp:nodejs /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=nodeapp:nodejs /app/apps/api/package.json    ./apps/api/package.json

USER nodeapp

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy --schema=packages/shared/prisma/schema.prisma && node apps/api/dist/apps/api/src/index.js"]