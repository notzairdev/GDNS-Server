# GDNS Security Audit - 2026-07-10

## Scope

Audit of the shared OCI VM, host network, SSH, Docker, GDNS containers,
certificate handling, maintenance workflows, WordPress edge and repository
supply chain.

The API contract used by the APK and C# agent was an invariant. No route,
payload, authentication mechanism or provisioning behavior changed.

## Result

The VM is materially stronger and both hosted products remained available.
GDNS health, authenticated API reads, APK heartbeat, Android Private DNS and
WordPress were verified after the changes.

Lynis reported a hardening index of `73`. Its two warnings were:

- A real pending reboot into `linux-image-6.17.0-1018-oracle`.
- A false negative for the security repository. `apt update` confirms
  `noble-security`; the OCI image declares sources in a format this Lynis
  package does not recognize.

## Remediated Findings

| Severity | Finding | Resolution |
| --- | --- | --- |
| Critical | Public plain DNS was receiving sustained unsolicited UDP traffic. | Removed Docker publishes for `53/tcp` and `53/udp`; blocked both in UFW and `DOCKER-USER`. |
| Critical | A broad Docker firewall rule also blocked `853/tcp`, breaking Android Private DNS. | Replaced it with an idempotent rule that blocks only plain DNS. DoT was verified with a real TLS 1.3 DNS query. |
| High | GDNS API and Caddy ran as root with Docker's broad default capabilities. | API and Caddy now run as UID/GID `1000:1000`; all GDNS containers use read-only roots, PID/memory limits and minimal capabilities. |
| High | GitHub Actions trusted `ssh-keyscan` output from the deployment network. | Added a pinned `VM_SSH_HOST_KEY` secret and strict host verification. |
| High | Workflow actions used mutable version tags. | Pinned official current releases to immutable commit SHAs. |
| High | Maintenance commands could consume SSH stdin and silently skip later steps. | Closed stdin for Compose `exec/run`; backup, renewal and healthcheck were proven to execute in sequence. |
| High | SSH received continuous distributed login probes. | Restricted login to `ubuntu`, disabled forwarding, reduced pre-auth/session limits and added aggressive, incremental and recidive Fail2ban jails. |
| High | WordPress logged sustained brute-force traffic and saw only Cloudflare proxy IPs. | Restored visitor IPs only from validated Cloudflare ranges, added per-IP login/XML-RPC limits and a weekly atomic range refresh. |
| Medium | Nginx origin allowed legacy TLS in its default context. | Limited the origin to TLS 1.2/1.3 and disabled version tokens. |
| Medium | Host changes and sensitive GDNS files were not audited. | Installed `auditd` and watches for identity, sudo, SSH, systemd and GDNS deployment/secrets. |
| Medium | Journal usage had reached about 1.4 GiB without an explicit policy. | Set persistent compressed logs, 30-day retention and a 512 MiB ceiling. |
| Medium | Security updates and several services were stale in memory. | Applied available updates, installed `needrestart`, and restarted affected services. |
| Medium | Core dumps could persist process memory. | Disabled core dump storage and set hard PAM limits. |

## Verified Controls

- Root, password and keyboard-interactive SSH authentication are disabled.
- `.env` is mode `600`; actual Let's Encrypt private keys are mode `600` and
  the GDNS runtime copy is mode `640`.
- AppArmor and Docker seccomp are active.
- Docker log rotation is configured for all GDNS services.
- Unauthenticated `/api/profiles` and `/agh/` return `401`.
- GDNS health and APK heartbeat return `200`.
- WordPress returns `200` after Nginx and package reloads.
- A controlled WordPress login burst produced `11` accepted requests followed
  by `4` rate-limited `429` responses.
- A spoofed `CF-Connecting-IP` from an untrusted source was ignored.
- All 13 API tests passed in the production Node 22 ARM64 build context.
- The final API image ran SQLite as non-root with a read-only root and no
  capabilities.
- ShellCheck passed for all new and modified host scripts.
- The scheduled blocklist refresh now uses the protected `production`
  environment and completed successfully after its missing secrets were
  restored.
- Access to `production` environment secrets is restricted to workflow runs
  whose ref is `master`.
- `debsums` found only two vendor-managed OCI monitoring unit files changed;
  no GDNS or Ubuntu executable integrity mismatch was reported.

## Remaining Risks

1. OCI authentication expired before the audit. IMDSv1 is still enabled and
   VCN/NSG ingress has not yet been reduced. Close `53/tcp`, `53/udp` and any
   unused `784/udp` rule in OCI after reauthentication, then enable IMDSv2-only.
2. The patched kernel is installed but the VM still runs
   `6.17.0-1011-oracle`. Reboot into `6.17.0-1018-oracle` after OCI recovery
   access is restored.
3. An unrelated Grafana Alloy container is privileged and has writable access
   to `docker.sock`; this is equivalent to host root if that container is
   compromised.
4. An unrelated Python static server remains publicly reachable on `8080/tcp`.
   It was preserved because its ownership and availability requirements are
   outside GDNS.
5. Public SSH remains necessary for the current GitHub-hosted deployment flow.
   A later migration to Tailscale or an OCI bastion should close `22/tcp` from
   the public Internet.
6. The shared VM remains a common blast radius for GDNS, WordPress and other
   containers. Moving GDNS to its own Always Free Ampere VM is the strongest
   remaining isolation improvement.

## Recovery

Host configuration copies are under:

```text
/root/gdns-hardening/
```

GDNS data backups are under:

```text
/opt/gdns/backups/
```

See [GDNS_SECURITY.md](GDNS_SECURITY.md) for the repeatable baseline,
verification commands and OCI checklist.
