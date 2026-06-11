# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend
WORKDIR /src/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --quiet --no-progress
COPY client ./
COPY .twosky.json /src/.twosky.json
RUN npm run build-prod

FROM --platform=$BUILDPLATFORM golang:1.26.4-alpine AS build
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=v0.0.0-gdns
ARG CHANNEL=development
WORKDIR /src
RUN apk --no-cache add git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /src/build ./build
ENV CGO_ENABLED=0
RUN GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-arm64} go build \
    -ldflags="-s -w -X github.com/AdguardTeam/AdGuardHome/internal/version.version=${VERSION} -X github.com/AdguardTeam/AdGuardHome/internal/version.channel=${CHANNEL}" \
    -trimpath \
    -o /out/AdGuardHome .

FROM alpine:3.23
RUN apk --no-cache add ca-certificates gettext libcap tzdata \
    && mkdir -p /opt/adguardhome/conf /opt/adguardhome/work /opt/adguardhome/certs /opt/adguardhome/templates \
    && chown -R nobody:nogroup /opt/adguardhome
COPY --from=build --chown=nobody:nogroup /out/AdGuardHome /opt/adguardhome/AdGuardHome
COPY --chmod=0755 docker/adguardhome-entrypoint.sh /usr/local/bin/gdns-adguardhome-entrypoint
COPY deploy/agh/AdGuardHome.yaml.tmpl /opt/adguardhome/templates/AdGuardHome.yaml.tmpl
RUN setcap 'cap_net_bind_service=+eip' /opt/adguardhome/AdGuardHome
USER nobody
WORKDIR /opt/adguardhome/work
EXPOSE 53/tcp 53/udp 853/tcp 784/udp 3000/tcp
ENTRYPOINT ["gdns-adguardhome-entrypoint"]
CMD ["--no-check-update", "-c", "/opt/adguardhome/conf/AdGuardHome.yaml", "-w", "/opt/adguardhome/work"]
