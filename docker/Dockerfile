# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the whole npm workspace. Only @lumantite/server actually runs in the
# final image; it depends at build time on @lumantite/schema, @lumantite/engine (transitively,
# via other workspace packages), @lumantite/project and @lumantite/catalog, so their compiled
# dist/ output (and the catalog package's data directories) has to ship too. apps/web's built SPA
# is copied in for static hosting; apps/cli is not needed by the server and is left out.

FROM node:22-alpine AS builder
WORKDIR /app

# Copy just the manifests first so `npm ci` is cached across source-only changes.
COPY package.json package-lock.json ./
COPY packages/schema/package.json packages/schema/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/project/package.json packages/project/package.json
COPY packages/catalog/package.json packages/catalog/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci --no-audit --no-fund

COPY . .

RUN npm run build

# Drop devDependencies (typescript, vitest, tsx, vite, ...) but keep the workspace symlinks and
# the production dependency tree, so the final stage can copy node_modules as-is.
RUN npm prune --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/packages/schema/package.json packages/schema/package.json
COPY --from=builder /app/packages/schema/dist packages/schema/dist

COPY --from=builder /app/packages/engine/package.json packages/engine/package.json
COPY --from=builder /app/packages/engine/dist packages/engine/dist

COPY --from=builder /app/packages/project/package.json packages/project/package.json
COPY --from=builder /app/packages/project/dist packages/project/dist

COPY --from=builder /app/packages/catalog/package.json packages/catalog/package.json
COPY --from=builder /app/packages/catalog/dist packages/catalog/dist
COPY --from=builder /app/packages/catalog/catalog packages/catalog/catalog
COPY --from=builder /app/packages/catalog/examples packages/catalog/examples

COPY --from=builder /app/apps/server/package.json apps/server/package.json
COPY --from=builder /app/apps/server/dist apps/server/dist

COPY --from=builder /app/apps/web/dist apps/web/dist

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/config').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
