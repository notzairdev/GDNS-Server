FROM node:22-bookworm-slim AS dashboard
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci --quiet --no-progress
COPY dashboard ./
RUN npm run build

FROM caddy:2-builder-alpine AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2-alpine
RUN apk upgrade --no-cache c-ares
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY --from=dashboard /app/dashboard/dist /srv/dashboard
