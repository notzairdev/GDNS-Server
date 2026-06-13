# DNS Personal — Project Handoff

> **Propósito:** Documento de inicio para Claude Code. Contiene todos los requerimientos, decisiones de arquitectura, estructura del proyecto y orden de implementación para construir un sistema DNS personal con paridad funcional a NextDNS, desplegado en Oracle Cloud vía Docker + GitHub Actions.

---

## 1. Contexto del Proyecto

### Problema que resuelve
El usuario usa NextDNS para filtrar endpoints en múltiples dispositivos Android. Tiene una herramienta propia (APK) que configura el DNS privado y, mediante Device Owner API, bloquea el cambio de DNS en el dispositivo. Durante una caída reciente de NextDNS, múltiples dispositivos quedaron sin filtrado activo.

### Solución
Construir un servidor DNS personal que actúe como **respaldo automático** cuando NextDNS caiga. El APK será modificado para:
1. Monitorear NextDNS con heartbeat continuo
2. Al detectar falla: bloquear internet → cambiar DNS al servidor propio → desbloquear
3. Al detectar recuperación: volver a NextDNS sin intervención manual

### Restricciones importantes
- **Uso estrictamente personal** — no es un servicio público
- El profile ID debe ser **idéntico** en NextDNS y en el sistema propio para que el cambio de failover sea transparente
- Un perfil por dispositivo (no compartir perfiles entre dispositivos para no degradar performance)

---

## 2. Infraestructura Disponible

| Recurso | Detalle |
|---|---|
| VM | Oracle Cloud (Ubuntu 22.04 LTS, siempre-free tier) |
| Dominio | Propio del usuario — referenciar como `DNS_DOMAIN` en variables de entorno |
| DNS del dominio | Cloudflare (recomendado para wildcard cert vía DNS challenge) |
| Repositorio | Fork de AdGuardHome en GitHub ya creado |
| CI/CD | GitHub Actions |
| Registry | GitHub Container Registry (GHCR) |

---

## 3. Stack Tecnológico — Decisiones Tomadas

| Componente | Tecnología | Justificación |
|---|---|---|
| DNS Engine | **AdGuardHome** (fork) | Client IDs nativos, API REST, filtrado per-client, DoH/DoT/DoQ |
| Reverse Proxy | **Caddy v2** | TLS automático con Cloudflare DNS challenge, wildcard certs, config declarativa |
| Profile API | **Node.js + Fastify** | Liviano, rápido de implementar, suficiente para uso personal |
| Base de datos | **SQLite** (via better-sqlite3) | Sin overhead, suficiente para volumen personal, archivo único fácil de respaldar |
| Contenedores | **Docker Compose** | Orquestación simple sin necesidad de Kubernetes |
| CI/CD | **GitHub Actions** | Build → Push GHCR → Deploy SSH a Oracle |

---

## 4. Arquitectura General

```
Internet
    │
    ▼
[Caddy - Reverse Proxy]
    │  *.dns.DNS_DOMAIN → TLS wildcard (Cloudflare DNS challenge)
    │  Extrae {profile-id} del subdominio → header X-Profile-ID
    │
    ▼
[AdGuardHome Fork - :3000 HTTP / :53 DNS / :853 DoT / :784 DoQ]
    │  Lee X-Profile-ID header para identificar cliente
    │  Aplica reglas de filtrado por perfil
    │  Resuelve DNS upstream
    │
    ▼
[Profile API - :4000]
    │  CRUD de perfiles
    │  Sincroniza configuración con AdGuardHome vía su API REST
    │  Gestiona blocklists por categoría
    │
    ▼
[SQLite]
    Perfiles, categorías, audit log
```

### Puertos en la VM
- `53/udp` — DNS plano (fallback)
- `853/tcp` — DNS-over-TLS
- `80/tcp` — HTTP (redirect a HTTPS por Caddy)
- `443/tcp` — HTTPS (DoH + Dashboard + API)

---

## 5. Estructura del Repositorio

```
my-dns/
├── .github/
│   └── workflows/
│       ├── deploy.yml          # CI/CD principal: build + push + deploy
│       └── blocklists-sync.yml # Cron semanal: actualizar blocklists
│
├── adguardhome/                # Submodule — fork de AdGuardHome
│   └── ...                     # Ver sección 6 para modificaciones
│
├── api/                        # Profile API (Node.js + Fastify)
│   ├── src/
│   │   ├── app.js              # Entry point Fastify
│   │   ├── db/
│   │   │   ├── schema.sql      # DDL SQLite
│   │   │   └── client.js       # better-sqlite3 singleton
│   │   ├── routes/
│   │   │   ├── profiles.js     # GET/POST/PUT/DELETE /profiles
│   │   │   └── health.js       # GET /health
│   │   ├── services/
│   │   │   ├── adguard.js      # Cliente HTTP para AGH API REST
│   │   │   └── blocklists.js   # Descarga y parseo de listas
│   │   └── blocklists/
│   │       └── categories.json # Mapa categoría → URLs de listas
│   ├── package.json
│   └── Dockerfile
│
├── dashboard/                  # UI web (HTML + Alpine.js — sin framework pesado)
│   ├── index.html
│   ├── assets/
│   └── Dockerfile              # Nginx estático
│
├── caddy/
│   └── Caddyfile
│
├── docker-compose.yml          # Desarrollo local
├── docker-compose.prod.yml     # Producción (Oracle Cloud)
├── .env.example                # Variables requeridas
└── README.md
```

---

## 6. Modificaciones al Fork de AdGuardHome

### 6.1 Soporte de Client ID por Subdominio (CAMBIO PRINCIPAL)

**Archivo a modificar:** `internal/dnsforward/http.go`

AdGuardHome ya soporta client ID por path (`/dns-query/{client_id}`). Se debe extender para leer también del hostname.

```go
// Agregar función de extracción desde host
func clientIDFromHost(host, baseDomain string) (clientID string) {
    // host = "abc123.dns.example.com", baseDomain = "dns.example.com"
    host = strings.ToLower(strings.TrimSuffix(host, ":443"))
    if !strings.HasSuffix(host, "."+baseDomain) {
        return ""
    }
    sub := strings.TrimSuffix(host, "."+baseDomain)
    if strings.Contains(sub, ".") {
        return "" // más de un nivel de subdominio, ignorar
    }
    return sub
}

// Modificar el handler DoH existente para intentar subdominio primero
func (s *Server) handleDOH(w http.ResponseWriter, r *http.Request) {
    clientID := clientIDFromHost(r.Host, s.conf.BaseDNSDomain)
    if clientID == "" {
        clientID = clientIDFromPath(r.URL.Path) // comportamiento original
    }
    // ... resto del handler sin cambios
}
```

**Nuevo campo de configuración en `AdGuardHome.yaml`:**
```yaml
dns:
  base_dns_domain: "dns.example.com"  # Campo nuevo a agregar
```

### 6.2 Header X-Profile-ID como fallback

Como alternativa más simple (si no se quiere tocar Go), Caddy puede reescribir el path:

```caddyfile
# Caddy extrae subdominio y reescribe URL para usar el path-based nativo
handle {
    @has_profile header_regexp profile X-Profile-ID (.+)
    rewrite @has_profile /dns-query/{re.profile.1}
    reverse_proxy adguardhome:3000
}
```

> **Recomendación:** Implementar primero la solución Caddy (más rápida), luego el parche Go para paridad completa.

---

## 7. Profile API — Especificación

### 7.1 Esquema SQLite

```sql
-- schema.sql
CREATE TABLE profiles (
    id          TEXT PRIMARY KEY,           -- UUID v4 corto (8 chars)
    name        TEXT NOT NULL,
    device_name TEXT,                       -- nombre descriptivo del dispositivo
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE profile_categories (
    profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    category    TEXT NOT NULL,              -- 'ads', 'malware', 'adult', 'social', 'gambling'
    enabled     INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (profile_id, category)
);

CREATE TABLE profile_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    rule        TEXT NOT NULL,              -- regla AGH: "||example.com^" o "@@||example.com^"
    type        TEXT NOT NULL CHECK(type IN ('block', 'allow')),
    created_at  INTEGER NOT NULL
);

CREATE TABLE sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id  TEXT,
    action      TEXT NOT NULL,
    status      TEXT NOT NULL,
    message     TEXT,
    created_at  INTEGER NOT NULL
);
```

### 7.2 Endpoints de la API

```
POST   /api/profiles                    Crear perfil
GET    /api/profiles                    Listar todos los perfiles
GET    /api/profiles/:id                Obtener perfil con reglas y categorías
PUT    /api/profiles/:id                Actualizar perfil
DELETE /api/profiles/:id                Eliminar perfil
POST   /api/profiles/:id/sync           Forzar sincronización con AdGuardHome
GET    /api/profiles/:id/credentials    Obtener URLs DoH/DoT del perfil

GET    /api/blocklists/categories       Listar categorías disponibles
POST   /api/blocklists/refresh          Forzar actualización de todas las listas

GET    /health                          Health check (usado por APK para heartbeat)
```

### 7.3 Respuesta de Credenciales

```json
{
  "profile_id": "abc12345",
  "doh": "https://abc12345.dns.tudominio.com/dns-query",
  "dot": "abc12345.dns.tudominio.com",
  "doh_path": "https://dns.tudominio.com/dns-query/abc12345",
  "plain_dns": "IP_DE_LA_VM"
}
```

### 7.4 Sincronización con AdGuardHome

La API se comunica con AGH vía su API REST interna. Al crear/actualizar un perfil:

```javascript
// services/adguard.js
const AGH_URL = process.env.AGH_INTERNAL_URL // http://adguardhome:3000
const AGH_USER = process.env.AGH_USER
const AGH_PASS = process.env.AGH_PASS

async function syncProfile(profile) {
  // 1. Crear/actualizar cliente en AGH con el profile ID como client_id
  await fetch(`${AGH_URL}/control/clients/update`, {
    method: 'POST',
    headers: { 'Authorization': basicAuth(AGH_USER, AGH_PASS) },
    body: JSON.stringify({
      name: profile.name,
      client_id: profile.id,
      use_global_settings: false,
      filtering_enabled: true,
      // reglas específicas del perfil
    })
  })

  // 2. Construir y pushear las reglas de filtrado combinando:
  //    - Blocklists de categorías activas del perfil
  //    - Reglas manuales del perfil
  const rules = await buildRulesForProfile(profile)
  await setClientRules(profile.id, rules)
}
```

---

## 8. Blocklists por Categoría

### 8.1 categories.json

```json
{
  "ads": {
    "name": "Ads & Trackers",
    "description": "Publicidad y rastreadores",
    "lists": [
      "https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt",
      "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"
    ]
  },
  "malware": {
    "name": "Malware & Phishing",
    "description": "Dominios maliciosos y phishing",
    "lists": [
      "https://urlhaus-filter.pages.dev/urlhaus-filter-agh.txt",
      "https://phishing.army/download/phishing_army_blocklist_extended.txt"
    ]
  },
  "adult": {
    "name": "Contenido Adulto",
    "description": "Bloqueo de contenido para adultos",
    "lists": [
      "https://raw.githubusercontent.com/nichole-codes/domains/main/adult-domains.txt"
    ]
  },
  "social_media": {
    "name": "Redes Sociales",
    "description": "Facebook, Instagram, TikTok, Twitter/X, etc.",
    "lists": [],
    "manual_rules": [
      "||facebook.com^",
      "||instagram.com^",
      "||tiktok.com^",
      "||twitter.com^",
      "||x.com^"
    ]
  },
  "gambling": {
    "name": "Apuestas",
    "description": "Sitios de apuestas y casinos online",
    "lists": [
      "https://raw.githubusercontent.com/nichole-codes/domains/main/gambling.txt"
    ]
  }
}
```

---

## 9. Caddy — Configuración

```caddyfile
# caddy/Caddyfile

{
    email {$ACME_EMAIL}
}

# Wildcard para todos los perfiles DNS
*.dns.{$DNS_DOMAIN}, dns.{$DNS_DOMAIN} {
    tls {
        dns cloudflare {$CF_API_TOKEN}
    }

    # Extraer profile ID del subdominio y reescribir path para AGH
    @subdomain_profile {
        host_regexp profile ^([a-z0-9]+)\.dns\.
    }
    handle @subdomain_profile {
        rewrite * /dns-query/{re.profile.1}
        reverse_proxy adguardhome:3000
    }

    # Requests directos a dns.dominio.com (path-based nativo AGH)
    handle {
        reverse_proxy adguardhome:3000
    }
}

# Dashboard + API
{$DNS_DOMAIN} {
    # Profile API
    handle /api/* {
        reverse_proxy api:4000
    }

    # AdGuardHome dashboard (proteger con auth básica)
    handle /agh/* {
        basicauth {
            {$DASHBOARD_USER} {$DASHBOARD_PASS_HASH}
        }
        uri strip_prefix /agh
        reverse_proxy adguardhome:3000
    }

    # Dashboard propio
    handle {
        reverse_proxy dashboard:80
    }
}
```

---

## 10. Docker Compose

### 10.1 docker-compose.yml (desarrollo)

```yaml
version: '3.9'

services:
  adguardhome:
    build:
      context: ./adguardhome
      dockerfile: Dockerfile
    container_name: adguardhome
    restart: unless-stopped
    volumes:
      - agh_work:/opt/adguardhome/work
      - agh_conf:/opt/adguardhome/conf
    ports:
      - "53:53/udp"
      - "53:53/tcp"
      - "3000:3000"       # Admin UI (solo en dev)
      - "853:853/tcp"     # DoT
      - "784:784/udp"     # DoQ
    environment:
      - AGH_USER=${AGH_USER}
      - AGH_PASS=${AGH_PASS}

  api:
    build: ./api
    container_name: dns-api
    restart: unless-stopped
    volumes:
      - ./api/data:/app/data   # SQLite file
    environment:
      - AGH_INTERNAL_URL=http://adguardhome:3000
      - AGH_USER=${AGH_USER}
      - AGH_PASS=${AGH_PASS}
      - API_SECRET=${API_SECRET}
      - DNS_DOMAIN=${DNS_DOMAIN}
    depends_on:
      - adguardhome

  caddy:
    image: caddy:2-alpine
    container_name: caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"   # HTTP/3
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    environment:
      - DNS_DOMAIN=${DNS_DOMAIN}
      - CF_API_TOKEN=${CF_API_TOKEN}
      - ACME_EMAIL=${ACME_EMAIL}
      - DASHBOARD_USER=${DASHBOARD_USER}
      - DASHBOARD_PASS_HASH=${DASHBOARD_PASS_HASH}
    depends_on:
      - adguardhome
      - api

  dashboard:
    build: ./dashboard
    container_name: dns-dashboard
    restart: unless-stopped

volumes:
  agh_work:
  agh_conf:
  caddy_data:
  caddy_config:
```

### 10.2 .env.example

```bash
# Dominio base
DNS_DOMAIN=tudominio.com

# Cloudflare (para wildcard TLS cert)
CF_API_TOKEN=tu_cloudflare_api_token
ACME_EMAIL=tu@email.com

# AdGuardHome
AGH_USER=admin
AGH_PASS=password_seguro

# API
API_SECRET=secret_para_bearer_token

# Dashboard
DASHBOARD_USER=admin
DASHBOARD_PASS_HASH=hash_bcrypt_de_la_pass  # caddy hash-password
```

---

## 11. GitHub Actions — CI/CD

```yaml
# .github/workflows/deploy.yml
name: Build & Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_PREFIX: ghcr.io/${{ github.repository_owner }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout con submodules
        uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Login a GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build & Push — AdGuardHome fork
        uses: docker/build-push-action@v5
        with:
          context: ./adguardhome
          push: true
          tags: ${{ env.IMAGE_PREFIX }}/dns-adguardhome:latest

      - name: Build & Push — Profile API
        uses: docker/build-push-action@v5
        with:
          context: ./api
          push: true
          tags: ${{ env.IMAGE_PREFIX }}/dns-api:latest

      - name: Build & Push — Dashboard
        uses: docker/build-push-action@v5
        with:
          context: ./dashboard
          push: true
          tags: ${{ env.IMAGE_PREFIX }}/dns-dashboard:latest

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Copiar docker-compose.prod.yml a VM
        uses: appleboy/scp-action@v0.1.7
        with:
          host: ${{ secrets.VM_HOST }}
          username: ${{ secrets.VM_USER }}
          key: ${{ secrets.VM_SSH_KEY }}
          source: "docker-compose.prod.yml,caddy/"
          target: "/opt/my-dns"

      - name: Deploy en Oracle Cloud
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.VM_HOST }}
          username: ${{ secrets.VM_USER }}
          key: ${{ secrets.VM_SSH_KEY }}
          script: |
            cd /opt/my-dns
            echo "${{ secrets.GHCR_TOKEN }}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin
            docker compose -f docker-compose.prod.yml pull
            docker compose -f docker-compose.prod.yml up -d --remove-orphans
            docker image prune -f
```

### Secrets requeridos en GitHub

| Secret | Valor |
|---|---|
| `VM_HOST` | IP pública de la VM Oracle |
| `VM_USER` | Usuario SSH (ubuntu) |
| `VM_SSH_KEY` | Clave privada SSH |
| `GHCR_TOKEN` | GitHub PAT con `read:packages` |

---

## 12. Lógica de Failover — APK Android

### Flujo de estados

```
Estado: NORMAL
  DNS activo: {profile-id}.dns.nextdns.io
  
  → cada 30 segundos: resolver "dns.nextdns.io" 
  → si falla 3 veces consecutivas:
      → Estado: FAILING

Estado: FAILING
  1. DeviceOwner.setAlwaysOnVpnPackage / restringir internet*
  2. DeviceOwner.setPrivateDnsModeOpportunistic()
  3. DeviceOwner.setPrivateDnsHost("{profile-id}.dns.{DNS_DOMAIN}")
  4. Verificar que el nuevo DNS responde
  5. DeviceOwner.setPrivateDnsMode(PRIVATE_DNS_MODE_PROVIDER_HOSTNAME)
  → Estado: FAILOVER

Estado: FAILOVER
  DNS activo: {profile-id}.dns.{DNS_DOMAIN}
  
  → cada 60 segundos: resolver "dns.nextdns.io"
  → si responde 3 veces consecutivas:
      → Estado: RESTORING

Estado: RESTORING
  1. DeviceOwner.setPrivateDnsModeOpportunistic()
  2. DeviceOwner.setPrivateDnsHost("{profile-id}.dns.nextdns.io")
  3. DeviceOwner.setPrivateDnsMode(PRIVATE_DNS_MODE_PROVIDER_HOSTNAME)
  → Estado: NORMAL
```

*\*La restricción de internet durante el cambio de DNS evita data leaks en el gap*

### Consideración crítica — Profile ID

El profile ID en NextDNS y en el sistema propio **deben ser idénticos**. Al configurar cada dispositivo:
1. Crear perfil en NextDNS → obtener su ID (ej: `abc123`)
2. Crear perfil en la Profile API con `id: "abc123"` y las mismas categorías de bloqueo
3. El APK usa ese ID en ambos DNS hosts

---

## 13. Fases de Implementación

### Fase 1 — MVP (objetivo: tener DNS funcional en 48h)
- [x] Inicializar repositorio con estructura de carpetas
- [x] `docker-compose.yml` base con AdGuardHome + Caddy
- [x] Configurar VM Oracle: firewall, Docker, Docker Compose
- [x] Crear registro DNS wildcard `*.dns.DNS_DOMAIN → IP_VM` en Cloudflare
- [x] Caddyfile con wildcard TLS + routing por subdominio
- [x] Crear perfiles desde Profile API/Dashboard
- [x] Probar DoH/DoT desde dispositivo Android
- [x] GitHub Actions: build + deploy básico

### Fase 2 — Profile API (semana 2)
- [x] Scaffold de la API con Fastify + SQLite
- [x] Endpoints CRUD de perfiles
- [x] Sincronización con AdGuardHome API
- [x] categories.json con listas iniciales
- [x] Script de descarga y refresh de blocklists
- [x] Cron de GitHub Actions para refresh semanal

### Fase 3 — Dashboard UI (semana 3)
- [x] UI con React/Vite: lista de perfiles, crear/editar perfil
- [x] Activar/desactivar categorías por perfil
- [x] Vista de logs DNS por perfil
- [x] Página de credenciales por perfil (QR code para scan desde el APK)

### Fase 4 — Integración APK (semana 4)
- [ ] Modificar APK para implementar lógica de failover
- [x] Contrato servidor/APK: heartbeat público por perfil
- [x] Contrato agent C#: provisioning idempotente con plantilla GDNS
- [ ] Heartbeat checker con exponential backoff
- [ ] Integración con DeviceOwner API para cambio de DNS
- [ ] Notificación al usuario cuando hay failover activo

---

## 14. Notas de Seguridad

- La Profile API debe estar protegida con Bearer token (`API_SECRET`) en todas las rutas mutantes
- El dashboard de AdGuardHome solo debe ser accesible tras auth básica (ver Caddyfile)
- Los puertos internos de Docker (`:3000` de AGH, `:4000` de API) NO deben estar expuestos en el firewall de la VM — solo Caddy en 80/443/53/853
- En Oracle Cloud: configurar Security List para abrir solo los puertos 22, 53, 80, 443, 853
- Caddy maneja rotación automática de certificados TLS — no requiere mantenimiento

---

## 15. Variables de Entorno — Referencia Completa

```bash
# === REQUERIDAS ===
DNS_DOMAIN=             # tu dominio (sin subdominio)
CF_API_TOKEN=           # Cloudflare API Token con permisos Zone:DNS:Edit
ACME_EMAIL=             # email para Let's Encrypt
AGH_USER=               # usuario admin de AdGuardHome
AGH_PASS=               # password admin de AdGuardHome
API_SECRET=             # Bearer token para la Profile API

# === DASHBOARD ===
DASHBOARD_USER=         # usuario para acceso al dashboard AGH via Caddy
DASHBOARD_PASS_HASH=    # hash bcrypt (generar con: docker run caddy caddy hash-password)

# === OPCIONALES ===
AGH_INTERNAL_URL=http://adguardhome:3000   # default, cambiar si se renombra el servicio
NODE_ENV=production
PORT=4000               # puerto interno de la API
```

---

## 16. Comandos Útiles de Referencia

```bash
# Generar hash de password para Caddy
docker run --rm caddy:2-alpine caddy hash-password --plaintext "mi_password"

# Ver logs en tiempo real
docker compose logs -f adguardhome
docker compose logs -f api

# Forzar rebuild de imagen específica
docker compose build --no-cache api

# Backup de SQLite
docker compose exec api cp /app/data/profiles.db /app/data/profiles.$(date +%Y%m%d).bak

# Entrar al contenedor de AdGuardHome
docker compose exec adguardhome /bin/sh

# Probar DoH manualmente
curl -sI "https://abc123.dns.tudominio.com/dns-query?dns=AAABAAABAAAAAAAAA3d3dwdleGFtcGxlA2NvbQAAAQAB" \
  -H "Accept: application/dns-message"
```

---

*Handoff generado para uso con Claude Code. Todos los valores sensibles deben reemplazarse — no commitear `.env` real al repositorio.*
