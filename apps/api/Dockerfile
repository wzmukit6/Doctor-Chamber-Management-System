# syntax=docker/dockerfile:1
# Chamber Assistant API — production image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t chamber-api .
# NODE_IMAGE can point at an internal mirror (or an image with a corporate CA).
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS base
# OpenSSL lets Prisma detect the right engine. INSTALL_OPENSSL=false is only for
# build environments without access to the Debian mirrors.
ARG INSTALL_OPENSSL=true
RUN if [ "$INSTALL_OPENSSL" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*; \
    fi
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @chamber/shared --workspace @chamber/api --include-workspace-root --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @chamber/shared \
 && npm run build -w @chamber/api \
 && npm run build:seed -w @chamber/api \
 && npm prune --omit=dev --workspace @chamber/shared --workspace @chamber/api --include-workspace-root --no-audit --no-fund

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    LOG_FORMAT=json
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/dist-seed ./apps/api/dist-seed
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]

# Backup worker: PostgreSQL 16 client tools (official image, same major version
# as the server) plus Node and the API build for the restore verification.
FROM postgres:16-bookworm AS backup
COPY --from=base /usr/local/bin/node /usr/local/bin/node
COPY --from=runtime /app /app
COPY --chmod=0755 scripts/backup /app/scripts/backup
COPY --chmod=0755 deploy/backup-scheduler.sh /usr/local/bin/backup-scheduler.sh
RUN mkdir -p /backups && chown postgres:postgres /backups
USER postgres
ENTRYPOINT []
# Unhealthy when the last backup or its restore verification failed, or none succeeded for 26 h.
HEALTHCHECK --interval=5m --timeout=10s \
  CMD sh -c 'test ! -f /backups/.last-run || { grep -q "^ok" /backups/.last-run && test -n "$(find /backups/.last-run -mmin -1560)"; }'
CMD ["backup-scheduler.sh"]
