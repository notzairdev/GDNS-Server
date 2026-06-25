# GDNS APK Contract

Este documento define la frontera estable entre el servidor GDNS, el agente C#
de provisionamiento y el APK Android Device Owner.

El servidor no expone credenciales administrativas, listas completas de perfiles
ni logs en rutas publicas. La unica ruta publica del contrato APK es el
heartbeat por perfil.

## Flujo Completo

1. El agente C# crea o actualiza el perfil en NextDNS con sus plantillas.
2. El agente llama `POST /api/apk/provision` en GDNS con el mismo `profile_id`.
3. GDNS crea o actualiza el perfil equivalente con la plantilla Goat DNS.
4. GDNS devuelve `nextdns.private_dns`, `credentials.dot` y `apk.setup_uri`.
5. El agente instala el APK por ADB, lo configura como Device Owner y entrega
   el payload al APK.
6. El APK guarda dos DNS:
   - Primario: NextDNS.
   - Respaldo: GoatDNS.
7. El APK monitorea el primario. Si falla, aplica blackhole, cambia a GoatDNS y
   restaura conectividad. Cuando NextDNS vuelve, repite el proceso hacia el
   primario.

## Provisionamiento Desde C#

```http
POST /api/apk/provision
Authorization: Bearer <API_SECRET>
Content-Type: application/json
```

Payload minimo:

```json
{
  "profile_id": "abc123",
  "name": "Pixel 8",
  "device_name": "Pixel 8",
  "template_id": "no_social",
  "nextdns_private_dns": "abc123.dns.nextdns.io"
}
```

El endpoint es idempotente:

- Si el perfil no existe, responde `201` y `provisioning.action = "created"`.
- Si ya existe, responde `200` y `provisioning.action = "updated"`.
- Siempre resincroniza cliente, categorias, reglas y filtro del perfil.

## Provisionamiento Con Reglas Personales

El agente C# puede crear un perfil basado en plantilla y agregar reglas propias:

```json
{
  "profile_id": "abc123",
  "name": "Pixel 8",
  "device_name": "Pixel 8",
  "template_id": "no_social",
  "nextdns_private_dns": "abc123.dns.nextdns.io",
  "rules": [
    { "type": "block", "rule": "||custom-block.example^" },
    { "type": "allow", "rule": "||required-service.example^" }
  ]
}
```

Comportamiento:

- `rules` se combina con las reglas definidas por la plantilla.
- `type: "block"` bloquea.
- `type: "allow"` permite o crea excepcion.
- Las reglas se aplican solo al perfil porque el servidor agrega
  `$client=<profile_id>` al sincronizar.

Para crear un perfil totalmente personal:

```json
{
  "profile_id": "abc123",
  "template_id": "personal",
  "nextdns_private_dns": "abc123.dns.nextdns.io",
  "categories": [],
  "rules": [
    { "type": "block", "rule": "||tiktok.com^" },
    { "type": "block", "rule": "||instagram.com^" },
    { "type": "allow", "rule": "||play.googleapis.com^" }
  ]
}
```

Si `categories` se envia, reemplaza las categorias de la plantilla para ese
provisionamiento.

## Plantillas Para El Agente

IDs actuales:

- `basic_safe`: publicidad, malware y Play Protect.
- `no_social`: base segura, redes sociales y mensajeria.
- `focus`: perfil de productividad con bloqueos amplios.
- `school`: perfil estricto para menores o equipos supervisados.
- `streaming_blocked`: bloquea streaming manteniendo una base ligera.
- `personal`: sin categorias, pensado para reglas propias.

El agente puede consultar plantillas desde:

```http
GET /api/profile-templates
Authorization: Bearer <API_SECRET>
```

## Respuesta De Provisionamiento

```json
{
  "provisioning": {
    "action": "created",
    "profile_id": "abc123",
    "template_id": "no_social",
    "template_name": "Sin redes"
  },
  "nextdns": {
    "private_dns": "abc123.dns.nextdns.io"
  },
  "credentials": {
    "profile_id": "abc123",
    "dot": "abc123.dns.gdns.goat-tool.com",
    "doh": "https://abc123.dns.gdns.goat-tool.com/dns-query",
    "doh_path": "https://dns.gdns.goat-tool.com/dns-query/abc123",
    "plain_dns": null
  },
  "apk": {
    "profile": {
      "id": "abc123",
      "active": true,
      "updated_at": 1781375000000
    },
    "failover": {
      "available": true,
      "reason": null,
      "primary_private_dns": "abc123.dns.nextdns.io",
      "fallback_private_dns": "abc123.dns.gdns.goat-tool.com",
      "fallback_doh": "https://abc123.dns.gdns.goat-tool.com/dns-query",
      "fallback_doh_path": "https://dns.gdns.goat-tool.com/dns-query/abc123"
    },
    "heartbeat": {
      "interval_ms": 1000,
      "timeout_ms": 1200,
      "failure_threshold": 2,
      "restore_threshold": 3,
      "backoff_ms": [250, 500, 1000, 2000, 5000, 10000],
      "path": "/apk/heartbeat/abc123",
      "url": "https://gdns.goat-tool.com:8448/apk/heartbeat/abc123",
      "checked_at": 1781375000000
    },
    "switching": {
      "blackhole_required": true,
      "restore_requires_positive_primary": true,
      "device_owner_required": true
    },
    "setup_uri": "gdns://profile?..."
  }
}
```

`apk.setup_uri` incluye:

- `profile_id`
- `nextdns_dot`
- `gdns_dot`
- `gdns_doh`
- `gdns_doh_path`
- `heartbeat`: URL absoluta.
- `heartbeat_path`: path local del servidor.

El APK debe persistir `heartbeat` como URL de polling. `heartbeat_path` sirve
para diagnostico o reconstruccion si el host base cambia.

## Heartbeat Publico

```http
GET /apk/heartbeat/{profile_id}
```

Respuesta exitosa:

```json
{
  "ok": true,
  "service": "gdns-profile-api",
  "profile": {
    "id": "abc123",
    "active": true,
    "updated_at": 1781375000000
  },
  "failover": {
    "available": true,
    "reason": null,
    "primary_private_dns": "abc123.dns.nextdns.io",
    "fallback_private_dns": "abc123.dns.gdns.goat-tool.com",
    "fallback_doh": "https://abc123.dns.gdns.goat-tool.com/dns-query",
    "fallback_doh_path": "https://dns.gdns.goat-tool.com/dns-query/abc123"
  },
  "heartbeat": {
    "interval_ms": 1000,
    "timeout_ms": 1200,
    "failure_threshold": 2,
    "restore_threshold": 3,
    "backoff_ms": [250, 500, 1000, 2000, 5000, 10000],
    "path": "/apk/heartbeat/abc123",
    "url": "https://gdns.goat-tool.com:8448/apk/heartbeat/abc123",
    "checked_at": 1781375000000
  },
  "switching": {
    "blackhole_required": true,
    "restore_requires_positive_primary": true,
    "device_owner_required": true
  },
  "setup_uri": "gdns://profile?..."
}
```

Errores:

- `404 profile_not_found`: el perfil no existe.
- `400 invalid_profile_id`: el ID no cumple el patron.

La respuesta usa `Cache-Control: no-store`.

## Maquina De Estados Recomendada

- `NORMAL`: Android Private DNS apunta a `primary_private_dns`.
- `VERIFYING_FAILOVER`: el primario fallo; confirmar con el umbral definido.
- `BLACKHOLE_TO_FALLBACK`: cortar internet global antes de cambiar DNS.
- `FAILOVER_ACTIVE`: Android Private DNS apunta a `fallback_private_dns`.
- `VERIFYING_PRIMARY`: el primario parece volver; esperar
  `restore_threshold` positivos.
- `BLACKHOLE_TO_PRIMARY`: cortar internet antes de volver a NextDNS.
- `RESTORED`: Android Private DNS vuelve a `primary_private_dns`.

El APK debe tratar `failover.available: false` como parada dura. En ese caso no
debe intentar cambiar hacia GoatDNS y debe mostrar `failover.reason`.

## Seguridad

- El heartbeat publico no revela `API_SECRET`, dashboard session, logs ni reglas.
- El endpoint de provisionamiento siempre va protegido por Bearer.
- El APK no debe almacenar el `API_SECRET`; solo debe guardar el payload de
  runtime que recibe del agente.
- La decision de blackhole pertenece al APK Device Owner, no al servidor.

## Smoke Test

```bash
curl "$API_BASE_URL/apk/heartbeat/testapi"
```

Para probar provisionamiento sin dejar basura:

```bash
curl -X POST "$API_BASE_URL/api/apk/provision" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "profile_id": "codex-apk-test",
    "template_id": "personal",
    "nextdns_private_dns": "codex-apk-test.dns.nextdns.io",
    "rules": [
      { "type": "block", "rule": "||example.org^" }
    ]
  }'

curl -X DELETE "$API_BASE_URL/api/profiles/codex-apk-test" \
  -H "Authorization: Bearer $API_SECRET"
```
