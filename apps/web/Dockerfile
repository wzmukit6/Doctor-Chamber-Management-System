# syntax=docker/dockerfile:1
# Chamber Assistant web — static SPA served by Caddy, which also proxies /api
# to the API container and terminates TLS. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t chamber-web .
# NODE_IMAGE can point at an internal mirror (or an image with a corporate CA).
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @chamber/shared --workspace @chamber/web --include-workspace-root --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @chamber/shared && npm run build -w @chamber/web

FROM caddy:2-alpine AS runtime
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 80 443
