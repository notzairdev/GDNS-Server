# GDNS Security Audit - 2026-07-10

## Scope

Audit of the shared OCI VM, host network, SSH, Docker, GDNS containers,
certificate handling, maintenance workflows, WordPress edge and repository
supply chain.

The API contract used by the APK and C# agent was an invariant. No route,
payload, authentication mechanism or provisioning behavior changed.

## Result

The VM is materially stronger and WordPress remained available. Post-deploy
validation caught a Caddy volume-ownership regression before sign-off; it was
repaired immediately and converted into an automated pre-start control. GDNS
health, authenticated API reads, APK heartbeat, Android Private DNS and
WordPress were then verified after the final changes.

Lynis reported a hardening index of `75`. Its three warnings were:

- A real pending reboot into `linux-image-6.17.0-1018-oracle`.
- A false negative for the security repository. `apt update` confirms
  `noble-security`; the OCI image declares sources in a format this Lynis
  package does not recognize.
- A transient time-synchronization warning. `timedatectl` subsequently
  confirmed `NTPSynchronized=yes`.

## Remediated Findings

| Severity | Finding | Resolution |
| --- | --- | --- |
| Critical | Public plain DNS was receiving sustained unsolicited UDP traffic. | Removed Docker publishes for `53/tcp` and `53/udp`; blocked both in UFW and `DOCKER-USER`. |
| Critical | A broad Docker firewall rule also blocked `853/tcp`, breaking Android Private DNS. | Replaced it with an idempotent rule that blocks only plain DNS. DoT was verified with a real TLS 1.3 DNS query. |
| Critical | Dependabot found critical vulnerabilities in the DNS server toolchain and upstream client build dependencies. | Updated `x/crypto`, `quic-go`, the client lockfile and the Go builder to `1.26.5`; npm audits and reachable Go vulnerability scans now pass. |
| High | GDNS API and Caddy ran as root with Docker's broad default capabilities. | API and Caddy now run as UID/GID `1000:1000`; all GDNS containers use read-only roots, PID/memory limits and minimal capabilities. |
| High | Caddy's historical TLS volumes were owned by root, which prevented the new non-root process from loading certificate keys. | Added a one-shot, networkless permissions service and made the deployment healthcheck perform a verified HTTPS request through Caddy. |
| High | The stock Certbot image contained seven fixable high-severity findings. | Built a patched, immutable Certbot image; all four production images now scan with zero HIGH or CRITICAL findings. |
| High | Public API routes had authentication but no shared request-rate ceiling. | Added a global per-IP limit with conservative defaults while retaining the stricter dashboard login lockout. |
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
| Medium | Backups containing the profile database and DNS configuration were mode `644` under a mode `755` directory. | Backups are now validated before retention, stored as `600`, and kept in a `700` directory. Existing archives were corrected. |
| Medium | Certificate publication briefly exposed root-owned files to the running DNS engine. | Certbot now prepares owner and mode on temporary files and atomically replaces both runtime certificates. |
| Medium | Deploying a private image would otherwise require a long-lived package token or public visibility. | The deploy workflow uses its short-lived `GITHUB_TOKEN` with only `packages: read`, then logs out from GHCR. |

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
- All 14 API tests pass under Node 22, including rate-limit behavior without
  changing the existing provisioning and heartbeat contracts.
- `npm audit` reports zero vulnerabilities for API, dashboard and the upstream
  client lockfiles. `govulncheck` reports zero reachable vulnerabilities with
  Go `1.26.5`.
- GitHub CodeQL completed for Actions, Go and JavaScript/TypeScript; Secret
  Scanning, push protection and Dependabot security updates are enabled.
- The final API image ran SQLite as non-root with a read-only root and no
  capabilities.
- Trivy reports zero HIGH or CRITICAL findings for the final API,
  AdGuardHome, Caddy and Certbot ARM64 images.
- Caddy storage is owned by UID/GID `1000:1000`; the one-shot permissions
  service has no network, a read-only root and only `CHOWN`/`DAC_OVERRIDE`.
- The ephemeral Certbot job has a read-only root, a bounded tmpfs and only the
  three file-management capabilities required by the mounted certificate
  directories.
- ShellCheck passed for all new and modified host scripts.
- The scheduled blocklist refresh now uses the protected `production`
  environment and completed successfully after its missing secrets were
  restored.
- Access to `production` environment secrets is restricted to workflow runs
  whose ref is `master`.
- `debsums` found only two vendor-managed OCI monitoring unit files changed;
  no GDNS or Ubuntu executable integrity mismatch was reported.
- The scheduled maintenance path completed backup, Certbot, verified HTTPS,
  verified DoT and cleanup in one successful run. Its newest archive is mode
  `600`.
- An external binary DoT query negotiated TLS 1.3 and returned a valid DNS
  answer; external TCP and UDP port 53 tests received no response.
- WordPress `7.0.1` is the current maintained release, its core checksums pass,
  `wp-config.php` is mode `640`, file editing is disabled, and no PHP file was
  found under uploads.
- Private vulnerability reporting is enabled for this repository; Secret
  Scanning and Dependabot have zero open alerts.

## Remaining Risks

1. OCI authentication expired before the audit. IMDSv1 is still enabled and
   VCN/NSG ingress has not yet been reduced. Close `53/tcp`, `53/udp` and any
   unused `784/udp` rule in OCI after reauthentication, then enable IMDSv2-only.
2. The patched kernel is installed but the VM still runs
   `6.17.0-1011-oracle`. Reboot into `6.17.0-1018-oracle` after OCI recovery
   access is restored.
3. An unrelated Grafana Alloy container is privileged, has writable access to
   `docker.sock`, and its current image has two HIGH findings. This is
   equivalent to host root if that container is compromised.
4. The unrelated running Bistrack and Crediscope images have 14 and 1 HIGH
   findings respectively. Update and re-scan them in their owning projects;
   GoatDNS did not alter those deployments.
5. An unrelated Python static server remains publicly reachable on `8080/tcp`.
   Its image scanned clean, but the direct unauthenticated listener was
   preserved because its ownership and availability requirements are outside
   GDNS.
6. Public SSH remains necessary for the current GitHub-hosted deployment flow.
   A later migration to Tailscale or an OCI bastion should close `22/tcp` from
   the public Internet.
7. The shared VM remains a common blast radius for GDNS, WordPress and other
   containers. Moving GDNS to its own Always Free Ampere VM is the strongest
   remaining isolation improvement.
8. CodeQL has 13 open findings in inherited administration, updater and
   filesystem paths. GDNS disables the built-in updater, keeps that
   administration UI behind separate credentials and does not expose arbitrary
   filter URLs in its public API; keep the findings open until they are
   resolved upstream or individually proven exploitable in this deployment.
9. Blockstudio `7.2.2` has an update to `7.4.2`. No matching public
   vulnerability was identified during this audit, so apply it only after a
   WordPress compatibility backup and test.

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
