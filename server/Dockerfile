# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the onboarding_platform server image.
#
# One image, two runtime targets. The same binary serves as the HTTP API
# and as the BullMQ worker; APP_TARGET selects the branch at runtime in
# src/index.ts (§6). This keeps the ECR image count at one and makes
# image-pin rollbacks trivial — whatever api runs, worker runs.
#
# Build context MUST be the repo root, not server/. The server's
# tsconfig.json sets rootDir:.. so the compiler reads shared contracts
# from ../client/src/types/index.ts; docker would not see that file if
# the context were scoped to server/. docker-compose and CI both pin the
# context with `context: .` and `dockerfile: server/Dockerfile`.
#
# Stage 1 (builder): full dev dependencies, tsc + migrations copy step,
# then `npm prune --omit=dev` so the runtime stage can copy a slim
# node_modules without re-downloading anything.
#
# Stage 2 (runtime): alpine node:22 with the built-in unprivileged `node`
# user. No shell tools, no build toolchain, no dev deps. HEALTHCHECK pings
# /health — the API answers from boot; the worker doesn't expose HTTP, so
# the health check is API-specific (overridden to NONE for the worker
# service in compose).

# ---------- builder ----------
FROM node:22-alpine AS builder

WORKDIR /build

# Install deps first for layer caching. package-lock.json is the source
# of truth; `npm ci` refuses to run without it, which catches missing
# lockfile problems at build time rather than production.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --no-audit --no-fund

# Copy only what the TypeScript compiler needs. Keeping this narrow
# avoids cache-busting on unrelated file changes (e.g. README edits).
COPY client/src/types ./client/src/types
COPY server/tsconfig.json server/eslint.config.mjs ./server/
COPY server/src ./server/src

# `npm run build` runs `tsc` then a tiny node script that copies SQL
# migrations into dist/server/src/db/migrations (see server/package.json).
# Afterwards, prune dev dependencies so the runtime stage carries only
# production modules.
RUN cd server && npm run build && npm prune --omit=dev

# ---------- runtime ----------
FROM node:22-alpine AS runtime

# Tini forwards SIGTERM cleanly to node so graceful shutdown in
# src/index.ts actually runs. Without it, PID 1 is node and signal
# delivery is inconsistent on some container runtimes.
RUN apk add --no-cache tini

ENV NODE_ENV=production
ENV PORT=4000

WORKDIR /app

COPY --from=builder --chown=node:node /build/server/dist ./dist
COPY --from=builder --chown=node:node /build/server/node_modules ./node_modules
COPY --from=builder --chown=node:node /build/server/package.json ./package.json

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server/src/index.js"]
