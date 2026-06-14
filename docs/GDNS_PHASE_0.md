# GDNS Phase 0

Phase 0 establecio la base operativa de Goat DNS sobre el fork de AdGuard Home.
El repositorio sigue siendo el fork raiz, pero ahora tiene una capa propia de
producto: Docker Compose, Caddy, API de perfiles, dashboard, despliegue,
backups y contrato para APK.

## Estado Actual

Completado:

- Compose productivo con `gdns-adguardhome`, `gdns-api` y `gdns-caddy`.
- Dashboard React/Vite con shadcn/ui, sesion segura y administracion de
  perfiles.
- API de perfiles con CRUD, categorias, reglas personales, logs, auditoria y
  checks por dominio.
- Plantillas de perfil:
  `basic_safe`, `no_social`, `focus`, `school`, `streaming_blocked`,
  `personal`.
- Categorias con listas remotas, reglas manuales y servicios nativos del motor.
- Categoria `play_protect` para excepciones esenciales de Android.
- Endpoint de credenciales por perfil sin DNS plano por defecto.
- Heartbeat publico para APK:
  `/apk/heartbeat/:profile_id`.
- Provisionamiento idempotente para agente C#:
  `/api/apk/provision`.
- Payload `gdns://profile?...` con NextDNS, GoatDNS y heartbeat absoluto.
- Healthcheck, backup, cert renewal y workflow de CI alineado.
- Despliegue validado en VM OCI compartida usando `8088/8448` para no tocar
  otros proyectos.

## Arquitectura Base

Android Private DNS usa DoT. Por eso el motor DNS escucha directamente en
`853/tcp` y Caddy se queda con HTTPS, dashboard, API y DoH reverse proxy.

Los perfiles se resuelven asi:

```text
<profile-id>.dns.<DNS_DOMAIN>
```

El `profile-id` tambien es ClientID. El API crea clientes del motor con:

```text
name = <profile-id>
ids = [<profile-id>]
```

Las reglas de cada perfil se sincronizan con `$client=<profile-id>`, de modo
que el bloqueo es aislado por perfil.

## Reglas Personales

Este es el punto central para customizacion.

Un perfil puede tener:

- categorias predefinidas;
- reglas personales;
- ambas cosas;
- o solo reglas personales.

Ejemplo API:

```bash
curl -X POST "$API_BASE_URL/api/profiles" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "perfil-manual",
    "name": "Perfil manual",
    "device_name": "Android",
    "categories": [],
    "rules": [
      { "type": "block", "rule": "||tiktok.com^" },
      { "type": "block", "rule": "||instagram.com^" },
      { "type": "allow", "rule": "||play.googleapis.com^" }
    ]
  }'
```

El dashboard ofrece el mismo flujo con textarea de reglas y la opcion
`Personalizado` / `Solo reglas personales`.

Referencia completa: [GDNS_PROFILE_API.md](GDNS_PROFILE_API.md).

## Contrato C# / APK

El agente C# ya no debe depender solo de NextDNS. Despues de crear el perfil
NextDNS, debe provisionar GDNS:

```bash
curl -X POST "$API_BASE_URL/api/apk/provision" \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "profile_id": "abc123",
    "template_id": "no_social",
    "nextdns_private_dns": "abc123.dns.nextdns.io"
  }'
```

La respuesta da al APK:

- DNS principal NextDNS.
- DNS respaldo GoatDNS.
- URL heartbeat publica.
- `setup_uri` con todo el payload.

Referencia completa: [GDNS_APK_CONTRACT.md](GDNS_APK_CONTRACT.md).

## Always Free OCI

Configuracion recomendada para MVP:

- 1 VM Ampere A1 activa.
- 2 OCPU.
- 6 GB RAM.
- Ubuntu ARM64.

Mantener otra VM o capacidad como standby, pero no dividir estado hasta tener
replicacion o restauracion automatizada.

## Validaciones Minimas

Servidor:

```bash
cd /opt/gdns
sudo bash ./deploy/scripts/healthcheck.sh
```

API:

```bash
curl -fsS "$API_BASE_URL/health"
```

Heartbeat:

```bash
curl -fsS "$API_BASE_URL/apk/heartbeat/<profile-id>"
```

Perfil con reglas:

```bash
curl "$API_BASE_URL/api/profiles/<profile-id>/audit" \
  -H "Authorization: Bearer $API_SECRET"
```

Dominio:

```bash
curl "$API_BASE_URL/api/profiles/<profile-id>/check?domain=tiktok.com&qtype=A" \
  -H "Authorization: Bearer $API_SECRET"
```

## Siguientes Pasos Naturales

1. Conectar el agente C# a `/api/apk/provision`.
2. Implementar en el APK el servicio Device Owner de failover:
   blackhole, switch DNS, restore.
3. Crear una tabla de equivalencias NextDNS template -> GDNS `template_id`.
4. Mejorar observabilidad: metricas historicas, eventos de failover y estado
   por dispositivo.
5. Endurecer despliegue: restauracion de backup probada y, despues,
   automatizacion OCI si realmente aporta.

Phase 0 se considera util cuando el stack puede desplegarse, crear perfiles,
sincronizar reglas, entregar credenciales y responder al contrato APK.
