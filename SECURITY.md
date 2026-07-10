# Security Policy

## Private Reporting

Report GoatDNS vulnerabilities through GitHub's
[private vulnerability reporting flow](https://github.com/notzairdev/GDNS-Server/security/advisories/new).

Do not open a public issue for an unpatched vulnerability. Include the affected
route or component, impact, reproduction steps, and the smallest useful proof
of concept. Redact API keys, dashboard sessions, Cloudflare tokens, private
keys, profile data, and production host details.

## Scope

This repository owns the GoatDNS API, dashboard, deployment, container images,
certificate automation, and the integration changes made on top of the DNS
engine. Reports affecting those surfaces belong here.

If a vulnerability is reproducible only in an unmodified upstream component,
follow that upstream project's disclosure policy as well. Do not send GoatDNS
deployment secrets or private infrastructure details to an upstream project.

## Supported Version

Security fixes target the current `master` branch and the immutable image tag
deployed in production. Historical image tags and abandoned development
branches are not supported.

## Disclosure

Please allow time to reproduce, patch, and deploy the issue before publishing
details. Maintainers will coordinate a security advisory when the report is
confirmed.
