# GDNS Security Baseline

Este runbook protege la VM compartida sin cambiar contratos, rutas, payloads ni
autenticacion del API consumido por el APK y el agente C#.

## Superficie Esperada

Puertos publicos necesarios en el despliegue actual:

```text
22/tcp      SSH para administracion y GitHub Actions
80/tcp      Sitio nginx existente
443/tcp     Sitio nginx existente
853/tcp    Android Private DNS mediante DoT
8448/tcp   Dashboard, API, DoH y heartbeat de GDNS
8448/udp   HTTP/3 de Caddy
```

`53/tcp` y `53/udp` no se publican desde Docker y quedan bloqueados tambien en
UFW y `DOCKER-USER` como defensa en profundidad. Docker desvia los puertos
publicados antes de las cadenas de entrada de UFW, por lo que una regla UFW por
si sola no basta si alguien vuelve a publicar esos listeners. `784/udp` queda
disponible para DoQ; puede cerrarse en OCI cuando no se use.

`8088/tcp` solo escucha en `127.0.0.1`. No debe existir una regla publica para
ese puerto. Los puertos internos `3000/tcp` y `4000/tcp` tampoco se publican.

## Aplicacion

Antes de aplicar, crea una copia de datos:

```bash
cd /opt/gdns
sudo bash ./deploy/scripts/backup.sh
```

Aplica configuracion y actualizaciones disponibles:

```bash
sudo APPLY_UPGRADES=1 bash ./deploy/scripts/harden-host.sh
```

Cada ejecucion guarda la configuracion previa bajo:

```text
/root/gdns-hardening/<timestamp>/
```

El script deja estos controles:

- SSH solo por clave y para `ubuntu`, sin root, passwords, agent forwarding ni
  TCP forwarding.
- Limites de conexiones previas a autenticacion y sesiones SSH.
- Fail2ban agresivo, bans incrementales y jail `recidive` de una semana.
- `auditd` con vigilancia de identidades, sudo, SSH, systemd y archivos
  sensibles de GDNS.
- Journal persistente con 30 dias de retencion y maximo de 512 MiB.
- Core dumps desactivados para evitar persistir memoria con secretos.
- Sysctls contra redirects, source routing, core dumps privilegiados y otros
  abusos de red comunes.
- Nginx restaura la IP real solo desde rangos Cloudflare validados, limita
  fuerza bruta contra WordPress y acepta unicamente TLS 1.2/1.3.
- DNS plano bloqueado antes de las reglas de forwarding de Docker, sin bloquear
  DoT ni DoQ.
- Actualizaciones de seguridad automaticas sin reinicios automaticos.

## Contenedores

Los servicios GDNS usan el perfil seccomp y AppArmor predeterminados de Docker,
filesystem raiz de solo lectura, limites de memoria/PIDs y un conjunto minimo
de capabilities. El API y Caddy usan ademas `no-new-privileges`.

`gdns-api` corre como UID/GID `1000:1000`. El servicio temporal
`api-permissions` prepara unicamente sus dos volumenes y termina antes del API.
AdGuardHome conserva solo `CAP_NET_BIND_SERVICE`; esa capability proviene del
binario y por ello ese contenedor no usa `no-new-privileges`. Caddy conserva la
misma capability para escuchar dentro del contenedor.

## GitHub Actions

La conexion de despliegue exige `VM_SSH_HOST_KEY`. El secreto debe contener la
linea `known_hosts` obtenida a traves de una sesion SSH ya confiable, no mediante
un `ssh-keyscan` ejecutado dentro del workflow.

Variables del environment `production`:

```text
VM_HOST
VM_PORT
VM_USER
VM_SSH_KEY
VM_SSH_HOST_KEY
```

## OCI

En la Security List o NSG conserva solo los puertos que realmente se publican.
No abras `53/tcp`, `53/udp` ni `8088/tcp` para este modo. Cuando el acceso de CI
migre a una red privada, cierra tambien `22/tcp` publico.

Configura la instancia con IMDSv2 solamente:

```bash
oci compute instance update \
  --instance-id <instance-ocid> \
  --instance-options '{"areLegacyImdsEndpointsDisabled":true}'
```

Antes de hacerlo, comprueba que cloud-init y los agentes de Oracle funcionan
con `/opc/v2`.

## Verificacion

```bash
sudo sshd -t
sudo sshd -T | grep -E \
  '^(allowusers|permitrootlogin|passwordauthentication|allowtcpforwarding|maxstartups|persourcemaxstartups)'
sudo fail2ban-client status sshd
sudo fail2ban-client status recidive
sudo auditctl -l
sudo journalctl --disk-usage
sudo iptables -nvL DOCKER-USER
sudo docker inspect gdns-api gdns-adguardhome gdns-caddy \
  --format '{{.Name}} readonly={{.HostConfig.ReadonlyRootfs}} security={{json .HostConfig.SecurityOpt}} caps={{json .HostConfig.CapAdd}}'
sudo bash /opt/gdns/deploy/scripts/healthcheck.sh
```

Desde otra red:

```bash
curl -fsS https://gdns.goat-tool.com:8448/health
openssl s_client \
  -connect gdns.goat-tool.com:853 \
  -servername testapi.dns.gdns.goat-tool.com </dev/null
curl -fsS -o /dev/null https://rutatierraadentro.mx/
```

Tambien confirma que `53`, `8088`, `3000` y `4000` no acepten conexiones
publicas.

## Riesgos De La VM Compartida

Los servicios ajenos a GDNS conservan su propiedad y configuracion. Un
contenedor privilegiado o con acceso de escritura a `docker.sock` equivale a
acceso root sobre el host; debe aislarse en otra VM cuando el proyecto lo
permita. Un servicio HTTP publico en `8080` tambien debe revisarse con su
propietario antes de cerrarlo, para no interrumpir otro proyecto.

Mientras exista esa convivencia, una vulnerabilidad en esos servicios puede
afectar GDNS aunque los contenedores propios esten endurecidos. La separacion en
VMs distintas sigue siendo el cierre correcto de ese riesgo.
