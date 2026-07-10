# GDNS-Server

GDNS-Server es el servidor DNS administrado para Goat DNS. Parte de
AdGuard Home, pero el producto operativo es propio: perfiles por dispositivo,
dashboard, API de provisionamiento, credenciales para Android Private DNS y un
contrato para el APK de failover NextDNS -> GoatDNS.

El objetivo actual es mantener un despliegue sano y repetible antes de
personalizar reglas de negocio mas avanzadas.

## Que Corre

- `gdns-adguardhome`: motor DNS, DoT en `853/tcp`, DNS en `53/tcp` y `53/udp`.
- `gdns-api`: API de perfiles, reglas, metricas, logs, credenciales y APK.
- `gdns-caddy`: dashboard, HTTPS, DoH, rutas `/api/*` y `/apk/*`.
- `dashboard/`: consola React para administrar perfiles sin tocar el motor DNS.

Los usuarios no usan una IP plana. Cada perfil obtiene hosts propios:

```text
Android Private DNS: <profile-id>.dns.<DNS_DOMAIN>
DoH directo:         https://<profile-id>.dns.<DNS_DOMAIN>/dns-query
DoH por path:        https://dns.<DNS_DOMAIN>/dns-query/<profile-id>
```

## Perfiles

Un perfil representa un dispositivo, grupo o politica. El `id` debe ser el
mismo que el ID de NextDNS cuando el perfil venga del agente C#, porque el APK
usa esa identidad para alternar entre NextDNS y GoatDNS.

Reglas del ID:

- Solo minusculas, numeros y guiones.
- Entre 3 y 63 caracteres.
- Ejemplo valido: `pixel-8`, `abc123`, `aula-secundaria-1`.

## Crear Perfiles Con Reglas Personales

La forma mas simple es usar el dashboard: en "Nuevo perfil", elige una
plantilla, escribe reglas personales y crea el perfil. Si quieres que solo
apliquen tus reglas, selecciona la plantilla `Personalizado` o activa "Solo
reglas personales".

Desde API, las reglas personales van en `rules`:

```bash
curl -X POST "$API_BASE_URL/api/profiles" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "pixel-8",
    "name": "Pixel 8",
    "device_name": "Pixel 8",
    "categories": [],
    "rules": [
      { "type": "block", "rule": "||tiktok.com^" },
      { "type": "block", "rule": "||instagram.com^" },
      { "type": "allow", "rule": "||play.googleapis.com^" }
    ]
  }'
```

`type: "block"` bloquea una regla. `type: "allow"` crea una excepcion; el
servidor la sincroniza como regla permitida para el perfil. Las reglas aceptan
formato compatible con AdGuard, por ejemplo:

```text
||example.com^
||subdomain.example.org^
@@||safe.example.com^
```

El servidor agrega automaticamente el alcance del cliente:

```text
||example.com^$client=pixel-8
```

Eso significa que una regla personal solo afecta al perfil que la contiene.

## Plantillas Disponibles

Las plantillas son atajos para crear perfiles con categorias base:

- `basic_safe`: publicidad, malware y excepciones esenciales de Android.
- `no_social`: base segura, redes sociales, mensajeria y Play Protect.
- `focus`: redes, mensajeria, streaming, juegos, compras, citas y apuestas.
- `school`: perfil estricto para equipos supervisados.
- `streaming_blocked`: base segura mas bloqueo de streaming.
- `personal`: vacio, pensado para reglas propias.

Las categorias reales se documentan y se pueden inspeccionar desde:

```bash
curl "$API_BASE_URL/api/blocklists/categories" \
  -H "Authorization: Bearer $API_SECRET"
```

Para ver reglas predefinidas de una categoria:

```bash
curl "$API_BASE_URL/api/blocklists/categories/play_protect/rules?limit=200" \
  -H "Authorization: Bearer $API_SECRET"
```

## Provisionamiento Para C# Y APK

Despues de crear o actualizar el perfil en NextDNS, el agente C# debe llamar a
GDNS con el mismo `profile_id`:

```bash
curl -X POST "$API_BASE_URL/api/apk/provision" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "profile_id": "abc123",
    "name": "Pixel 8",
    "device_name": "Pixel 8",
    "template_id": "no_social",
    "nextdns_private_dns": "abc123.dns.nextdns.io"
  }'
```

La respuesta incluye:

- `nextdns.private_dns`: host primario.
- `credentials.dot`: host GoatDNS de respaldo.
- `apk.setup_uri`: payload `gdns://profile?...` para el APK.
- `apk.heartbeat.url`: URL publica que el APK debe consultar.

Ver [docs/GDNS_APK_CONTRACT.md](docs/GDNS_APK_CONTRACT.md).

## Operacion Rapida

Dashboard:

```text
https://<DNS_DOMAIN>
```

En VM compartida de pruebas:

```text
https://<DNS_DOMAIN>:8448
```

Healthcheck:

```bash
cd /opt/gdns
sudo bash ./deploy/scripts/healthcheck.sh
```

Backup:

```bash
cd /opt/gdns
sudo bash ./deploy/scripts/backup.sh
```

Documentos principales:

- [docs/GDNS_PROFILE_API.md](docs/GDNS_PROFILE_API.md)
- [docs/GDNS_APK_CONTRACT.md](docs/GDNS_APK_CONTRACT.md)
- [docs/GDNS_DEPLOYMENT.md](docs/GDNS_DEPLOYMENT.md)
- [docs/GDNS_SECURITY.md](docs/GDNS_SECURITY.md)
- [docs/GDNS_SECURITY_AUDIT_2026-07-10.md](docs/GDNS_SECURITY_AUDIT_2026-07-10.md)
- [docs/GDNS_PHASE_0.md](docs/GDNS_PHASE_0.md)

## Licencia

Este repositorio incluye codigo derivado de AdGuard Home. Ver
[LICENSE.txt](LICENSE.txt).
