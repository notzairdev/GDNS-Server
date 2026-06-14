# GDNS Profile API

Esta API administra perfiles Goat DNS en SQLite y sincroniza cada cambio con el
motor DNS. El dashboard usa estas mismas rutas.

## Autenticacion

`/health` y `/apk/heartbeat/:id` son publicos. Toda ruta bajo `/api/*` requiere:

```http
Authorization: Bearer <API_SECRET>
```

En desarrollo local, si `API_SECRET` esta vacio, la autenticacion se omite.
En produccion no debe estar vacio.

## Modelo De Perfil

Un perfil representa una politica DNS. Normalmente corresponde a un dispositivo
o grupo.

Campos principales:

- `id`: identificador DNS-safe. Debe cumplir `[a-z0-9-]{3,63}`.
- `name`: nombre visible.
- `device_name`: dispositivo o grupo asociado.
- `active`: si el perfil sincroniza filtros activos.
- `categories`: categorias predefinidas activas.
- `rules`: reglas personales del perfil.

El `id` tambien es el ClientID usado por el motor DNS. Por eso las reglas se
sincronizan con alcance por cliente y no contaminan otros perfiles.

## Crear Perfil Basico

```bash
curl -X POST "$API_BASE_URL/api/profiles" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "pixel-8",
    "name": "Pixel 8",
    "device_name": "Pixel 8",
    "categories": ["ads", "malware", "play_protect"]
  }'
```

La respuesta incluye el perfil normalizado. Despues de crear, el API sincroniza
el cliente y los filtros del perfil.

## Crear Perfil Con Reglas Personales

Esta es la ruta mas importante para customizar el producto sin depender solo de
plantillas.

```bash
curl -X POST "$API_BASE_URL/api/profiles" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "familia-tablet",
    "name": "Tablet familiar",
    "device_name": "Samsung Tab",
    "active": true,
    "categories": ["ads", "malware", "play_protect"],
    "rules": [
      { "type": "block", "rule": "||tiktok.com^" },
      { "type": "block", "rule": "||instagram.com^" },
      { "type": "block", "rule": "||facebook.com^" },
      { "type": "allow", "rule": "||play.googleapis.com^" },
      { "type": "allow", "rule": "||play-fe.googleapis.com^" }
    ]
  }'
```

Reglas aceptadas:

- `type: "block"` bloquea la regla.
- `type: "allow"` permite la regla. El backend la transforma en excepcion si
  hace falta.
- `rule` acepta sintaxis compatible con AdGuard, como `||domain.com^`,
  `@@||domain.com^` o reglas con opciones.

Comportamiento importante:

- Las reglas personales se guardan en SQLite.
- En sincronizacion, el backend agrega `$client=<profile-id>`.
- El filtro generado vive como archivo por perfil.
- Las reglas personales conviven con categorias y servicios nativos.
- Si el perfil esta pausado, el cliente queda sin filtros activos.

Ejemplo de filtro sincronizado:

```text
# gdns:profile:familia-tablet
||tiktok.com^$client=familia-tablet
||instagram.com^$client=familia-tablet
@@||play.googleapis.com^$client=familia-tablet
```

## Perfil Solo Con Reglas Personales

Usa categorias vacias:

```bash
curl -X POST "$API_BASE_URL/api/profiles" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "personal-test",
    "name": "Perfil manual",
    "device_name": "Android",
    "categories": [],
    "rules": [
      { "type": "block", "rule": "||example.org^" },
      { "type": "allow", "rule": "||safe.example.org^" }
    ]
  }'
```

En dashboard, esto equivale a elegir la plantilla `Personalizado` o activar
"Solo reglas personales".

## Actualizar Perfil Y Reglas

`PUT /api/profiles/:id` reemplaza categorias y reglas con lo enviado.

```bash
curl -X PUT "$API_BASE_URL/api/profiles/familia-tablet" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Tablet familiar",
    "device_name": "Samsung Tab",
    "active": true,
    "categories": {
      "ads": true,
      "malware": true,
      "play_protect": true,
      "social_media": false,
      "streaming": true
    },
    "rules": [
      { "type": "block", "rule": "||youtube.com^" },
      { "type": "allow", "rule": "||play.googleapis.com^" }
    ]
  }'
```

Usa el dashboard si quieres editar reglas como texto; internamente convierte
lineas a objetos `rules`.

## Plantillas

El endpoint devuelve las plantillas activas:

```bash
curl "$API_BASE_URL/api/profile-templates" \
  -H "Authorization: Bearer $API_SECRET"
```

Plantillas actuales:

- `basic_safe`: `ads`, `malware`, `play_protect`.
- `no_social`: base segura, `social_media`, `messaging`.
- `focus`: redes, mensajeria, streaming, juegos, compras, citas y apuestas.
- `school`: perfil estricto para menores o equipos supervisados.
- `streaming_blocked`: base segura mas streaming.
- `personal`: vacio.

## Provisionamiento C# Para APK

Cuando el agente C# ya creo el perfil en NextDNS, debe llamar:

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

Tambien acepta reglas personales adicionales:

```json
{
  "profile_id": "abc123",
  "template_id": "no_social",
  "nextdns_private_dns": "abc123.dns.nextdns.io",
  "rules": [
    { "type": "block", "rule": "||custom-block.example^" },
    { "type": "allow", "rule": "||required-service.example^" }
  ]
}
```

En `/api/apk/provision`, las reglas de la plantilla se combinan con las reglas
enviadas en `rules`. Si mandas `categories`, reemplazas las categorias de la
plantilla para ese provisionamiento.

La respuesta trae:

- `provisioning.action`: `created` o `updated`.
- `nextdns.private_dns`: DNS privado principal.
- `credentials.dot`: DNS privado GoatDNS.
- `apk.setup_uri`: payload completo para el APK.
- `apk.heartbeat.url`: endpoint publico para monitoreo.

## Credenciales

```bash
curl "$API_BASE_URL/api/profiles/familia-tablet/credentials" \
  -H "Authorization: Bearer $API_SECRET"
```

Respuesta esperada:

```json
{
  "profile_id": "familia-tablet",
  "dot": "familia-tablet.dns.gdns.goat-tool.com",
  "doh": "https://familia-tablet.dns.gdns.goat-tool.com/dns-query",
  "doh_path": "https://dns.gdns.goat-tool.com/dns-query/familia-tablet",
  "plain_dns": null
}
```

`plain_dns` debe ser `null` en el producto normal para no exponer la IP plana.

## Auditoria Y Pruebas

Auditar reglas del perfil:

```bash
curl "$API_BASE_URL/api/profiles/familia-tablet/audit" \
  -H "Authorization: Bearer $API_SECRET"
```

Probar un dominio con el ClientID del perfil:

```bash
curl "$API_BASE_URL/api/profiles/familia-tablet/check?domain=tiktok.com&qtype=A" \
  -H "Authorization: Bearer $API_SECRET"
```

Ver logs recientes:

```bash
curl "$API_BASE_URL/api/profiles/familia-tablet/logs?limit=120" \
  -H "Authorization: Bearer $API_SECRET"
```

Sincronizar manualmente:

```bash
curl -X POST "$API_BASE_URL/api/profiles/familia-tablet/sync" \
  -H "Authorization: Bearer $API_SECRET"
```

Eliminar:

```bash
curl -X DELETE "$API_BASE_URL/api/profiles/familia-tablet" \
  -H "Authorization: Bearer $API_SECRET"
```

## Categorias Y Reglas Predefinidas

Categorias disponibles:

```bash
curl "$API_BASE_URL/api/blocklists/categories" \
  -H "Authorization: Bearer $API_SECRET"
```

Ver reglas de una categoria:

```bash
curl "$API_BASE_URL/api/blocklists/categories/play_protect/rules?limit=500" \
  -H "Authorization: Bearer $API_SECRET"
```

Refrescar listas remotas:

```bash
curl -X POST "$API_BASE_URL/api/blocklists/refresh" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Categorias con `blocked_services` usan el catalogo nativo del motor DNS. Por
eso `social_media`, `streaming`, `gaming` y similares cubren mas dominios que
una lista manual pequena.

`play_protect` es especial: agrega excepciones para Google Play Protect y Play
Store, util cuando otras categorias son agresivas.

## Estado Y Dashboard

Estado operativo:

```bash
curl "$API_BASE_URL/api/status" \
  -H "Authorization: Bearer $API_SECRET"
```

El dashboard cambia el `API_SECRET` por una cookie firmada `HttpOnly` y
`SameSite=Strict`. Los assets estaticos no contienen datos sensibles.

## Contrato APK

El APK usa el heartbeat publico y el payload `gdns://profile?...` documentado
en [GDNS_APK_CONTRACT.md](GDNS_APK_CONTRACT.md).
