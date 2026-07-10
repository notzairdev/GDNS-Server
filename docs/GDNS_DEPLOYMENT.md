# GDNS Deployment

Runbook del despliegue actual de Goat DNS. El objetivo es mantener una VM sana,
con DNS estable, dashboard disponible, backups y un camino claro para actualizar
sin tocar otros proyectos de la maquina.

## Topologia Actual

Servicios Docker:

- `gdns-adguardhome`: DNS, DoT, DoQ/DoH backend y clientes por perfil.
- `gdns-api`: API de perfiles, reglas, dashboard, logs y APK.
- `gdns-caddy`: HTTPS, dashboard, DoH reverse proxy y rutas publicas.
- `certbot`: perfil temporal para emitir certificados wildcard de DoT.

Puertos estandar:

```text
53/tcp    DNS interno, no publicado en modo seguro
53/udp    DNS interno, no publicado en modo seguro
853/tcp   Android Private DNS / DoT
784/udp   DoQ
80/tcp    Caddy HTTP
443/tcp   Caddy HTTPS
443/udp   HTTP/3
```

En VM compartida, el dashboard/API puede usar puertos alternos:

```env
HTTP_PORT=127.0.0.1:8088
HTTPS_PORT=8448
```

Esto deja el listener HTTP solo en localhost y expone publicamente el dashboard,
API y heartbeat por HTTPS en `8448`. No cambia Android Private DNS; los
dispositivos siguen usando `<profile-id>.dns.<DNS_DOMAIN>` en `853/tcp`.

## DNS Records

Cloudflare debe apuntar al IP publico de la VM:

```text
<DNS_DOMAIN>          A/AAAA  <VM_PUBLIC_IP>
dns.<DNS_DOMAIN>      A/AAAA  <VM_PUBLIC_IP>
*.dns.<DNS_DOMAIN>    A/AAAA  <VM_PUBLIC_IP>
```

El wildcard es obligatorio para hosts por perfil como:

```text
abc123.dns.gdns.goat-tool.com
```

Cloudflare debe estar en DNS only, sin proxy, para los registros DNS del
producto.

## Variables De Produccion

La base esta en [../deploy/env.prod.example](../deploy/env.prod.example).

Variables clave:

- `DNS_DOMAIN`: dominio base, por ejemplo `gdns.goat-tool.com`.
- `PUBLIC_BASE_URL`: URL publica del dashboard/API, por ejemplo
  `https://gdns.goat-tool.com:8448` en VM compartida.
- `NEXTDNS_DOT_DOMAIN`: normalmente `dns.nextdns.io`.
- `API_SECRET`: token largo para `/api/*`.
- `AGH_USER`, `AGH_PASS`, `AGH_PASS_HASH`: credenciales del motor.
- `DASHBOARD_USER`, `DASHBOARD_PASS_HASH`: login inicial del dashboard.
- `CF_API_TOKEN`: token Cloudflare con permisos DNS edit para certificados.
- `PLAIN_DNS_IP`: debe quedar vacio si no queremos exponer DNS plano.
- `DNS_BIND_IP`: IP local para bind de DNS; en OCI puede ser la IP privada.

Ejemplo para modo compartido:

```env
DNS_DOMAIN=gdns.goat-tool.com
PUBLIC_BASE_URL=https://gdns.goat-tool.com:8448
NEXTDNS_DOT_DOMAIN=dns.nextdns.io
HTTP_PORT=127.0.0.1:8088
HTTPS_PORT=8448
PLAIN_DNS_IP=
```

Asi no queda `8088/tcp` expuesto publicamente.

## Bootstrap De VM

En Ubuntu:

```bash
sudo APP_DIR=/opt/gdns bash deploy/scripts/bootstrap-ubuntu.sh
```

Con UFW administrado por el script:

```bash
sudo CONFIGURE_UFW=1 APP_DIR=/opt/gdns bash deploy/scripts/bootstrap-ubuntu.sh
```

En OCI, abre en Security List o NSG solo lo necesario:

```text
22/tcp, 80/tcp, 443/tcp, 853/tcp
```

Si usas dashboard en `8448`, abre tambien `8448/tcp` y `8448/udp`. No abras
`8088/tcp` cuando `HTTP_PORT` este ligado a `127.0.0.1:8088`. Abre `784/udp`
solo si vas a publicar DoQ y `443/udp` solo si el proxy de ese puerto sirve
HTTP/3. Con `PLAIN_DNS_IP` vacio, `53/tcp` y `53/udp` deben quedar cerrados.

## Preflight

En la VM:

```bash
cd /opt/gdns
sudo nano .env
./deploy/scripts/preflight.sh
./deploy/scripts/caddy-check.sh
```

`preflight.sh` debe terminar con:

```text
GDNS preflight passed
```

## Deploy Manual Controlado

Para cambios de API o dashboard:

```bash
cd /opt/gdns
sudo tar -xzf /tmp/gdns-bundle.tgz -C /opt/gdns

api_image="$(sudo docker compose --env-file .env -f docker-compose.prod.yml config \
  | awk '/image: .*gdns-api/{print $2; exit}')"

sudo docker build -t "$api_image" ./api
sudo docker compose --env-file .env -f docker-compose.prod.yml up -d --no-deps --force-recreate api
sudo docker compose --env-file .env -f docker-compose.prod.yml up -d --no-deps --force-recreate caddy
sudo bash ./deploy/scripts/healthcheck.sh
```

Para cambios solo del dashboard, basta reconstruir `dashboard/dist`, copiarlo y
recrear `caddy`.

## Healthcheck

```bash
cd /opt/gdns
sudo bash ./deploy/scripts/healthcheck.sh
```

Verificaciones publicas:

```bash
curl -fsS "$PUBLIC_BASE_URL/health"
curl -fsS "$PUBLIC_BASE_URL/apk/heartbeat/testapi"
```

Si el perfil no existe, el heartbeat debe devolver `404 profile_not_found`.
Eso confirma que la ruta esta viva.

## Hardening De VM

El procedimiento completo, controles y rollback estan en
[GDNS_SECURITY.md](GDNS_SECURITY.md).

Estado recomendado para una VM compartida:

```text
HTTP_PORT=127.0.0.1:8088
HTTPS_PORT=8448
PLAIN_DNS_IP=
```

Aplica el baseline idempotente:

```bash
cd /opt/gdns
sudo APPLY_UPGRADES=1 bash ./deploy/scripts/harden-host.sh
```

El script instala auditoria, limita el journal, configura SSH y Fail2ban,
aplica sysctls defensivos y protege los puertos publicados por Docker. No
reinicia automaticamente la VM ni modifica rutas o payloads del API.

Permisos esperados:

```bash
sudo chmod -R go-w /opt/gdns
sudo chmod 600 /opt/gdns/.env
sudo find /opt/gdns/deploy/scripts -type f -name '*.sh' -exec chmod 755 {} +
```

Verificaciones:

```bash
sudo find /opt/gdns -xdev \( -type f -o -type d \) -perm -0002 | wc -l
sudo fail2ban-client status sshd
sudo fail2ban-client status recidive
sudo sshd -T | egrep '^(allowusers|permitrootlogin|passwordauthentication|allowtcpforwarding|maxauthtries|logingracetime)'
sudo auditctl -l
sudo iptables -nvL DOCKER-USER
```

El contador de archivos world-writable debe ser `0`.

## Crear Un Perfil De Prueba

```bash
curl -X POST "$PUBLIC_BASE_URL/api/profiles" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "smoke-test",
    "name": "Smoke test",
    "device_name": "CLI",
    "categories": ["ads", "malware", "play_protect"],
    "rules": [
      { "type": "block", "rule": "||example.org^" }
    ]
  }'
```

Credenciales:

```bash
curl "$PUBLIC_BASE_URL/api/profiles/smoke-test/credentials" \
  -H "Authorization: Bearer $API_SECRET"
```

Cleanup:

```bash
curl -X DELETE "$PUBLIC_BASE_URL/api/profiles/smoke-test" \
  -H "Authorization: Bearer $API_SECRET"
```

## Certificados

Emitir o renovar wildcard para DoT:

```bash
cd /opt/gdns
sudo bash ./deploy/scripts/renew-certs.sh
```

El certificado debe cubrir:

```text
dns.<DNS_DOMAIN>
*.dns.<DNS_DOMAIN>
```

## Backups

```bash
cd /opt/gdns
sudo bash ./deploy/scripts/backup.sh
```

Incluye SQLite y configuracion del motor. Los backups quedan bajo:

```text
/opt/gdns/backups
```

Retencion por defecto: 14 dias. Override:

```bash
RETENTION_DAYS=30 sudo bash ./deploy/scripts/backup.sh
```

## GitHub Actions

Workflows esperados:

- `GDNS CI`: valida compose, API y dashboard.
- `GDNS Images`: publica imagenes.
- `GDNS Deploy`: sube bundle y levanta stack.
- `GDNS Blocklists Sync`: refresca listas remotas.
- `GDNS Maintenance`: backup, cert renew, healthcheck y limpieza.

En `GDNS Deploy`, usa como `image_tag` el SHA completo del commit construido.
Produccion no debe desplegar la etiqueta mutable `latest`.

Secrets importantes:

- `VM_HOST`
- `VM_PORT`
- `VM_USER`
- `VM_SSH_KEY`
- `VM_SSH_HOST_KEY`
- `GHCR_TOKEN`
- `PROD_ENV_FILE`
- `API_BASE_URL`
- `API_SECRET`

## Notas De VM Compartida

Si otro proyecto usa `80/443`, no lo muevas a ciegas. Usa `8088/8448` para
GDNS mientras sea entorno compartido, pero liga `8088` a localhost si no
necesitas HTTP publico. El proyecto externo debe seguir respondiendo despues de
cada deploy.

Checklist rapido:

```bash
curl -I https://rutatierraadentro.mx/
curl -fsS https://gdns.goat-tool.com:8448/health
```

## Limite Actual

OCI CLI puede usarse con una sesion o API key vigente, pero el despliegue actual
no depende de crear VMs desde automatizacion. La operacion estable sigue siendo:
VM existente, `/opt/gdns`, Docker Compose y healthchecks.
