---
summary: "Run the Omnipolymath Gateway on EasyRunner with Podman and Caddy"
read_when:
  - Deploying Omnipolymath on EasyRunner
  - Running the Gateway behind EasyRunner's Caddy proxy
  - Choosing persistent volumes and auth for a hosted Gateway
title: "EasyRunner"
---

EasyRunner hosts the Omnipolymath Gateway as a small containerized app behind its
Caddy proxy. This guide assumes an EasyRunner host that runs Podman-compatible
Compose apps and terminates HTTPS through Caddy.

## Before you begin

- An EasyRunner server with a domain routed to it.
- The official Omnipolymath image (`ghcr.io/openclaw/openclaw`) or your own build.
- A persistent config volume for `/home/node/.omnipolymath`.
- A persistent workspace volume for `/home/node/.omnipolymath/workspace`.
- A strong Gateway token or password.

Keep device auth enabled when possible. If your reverse proxy cannot carry
device identity correctly, fix trusted-proxy settings first (see
[Trusted proxy auth](/gateway/trusted-proxy-auth)); use dangerous auth
bypasses only on a fully private, operator-controlled network.

## Compose app

Create an EasyRunner app with a Compose file shaped like this:

```yaml
services:
  omnipolymath:
    image: ghcr.io/openclaw/openclaw:latest
    restart: unless-stopped
    environment:
      OMNIPOLYMATH_GATEWAY_TOKEN: ${OMNIPOLYMATH_GATEWAY_TOKEN}
      OMNIPOLYMATH_HOME: /home/node
      OMNIPOLYMATH_STATE_DIR: /home/node/.omnipolymath
      OMNIPOLYMATH_CONFIG_PATH: /home/node/.omnipolymath/omnipolymath.json
      OMNIPOLYMATH_WORKSPACE_DIR: /home/node/.omnipolymath/workspace
    volumes:
      - omnipolymath-config:/home/node/.omnipolymath
      - omnipolymath-workspace:/home/node/.omnipolymath/workspace
    labels:
      caddy: omnipolymath.example.com
      caddy.reverse_proxy: "{{upstreams 1455}}"
    command: ["node", "omnipolymath.mjs", "gateway", "--bind", "lan", "--port", "1455"]

volumes:
  omnipolymath-config:
  omnipolymath-workspace:
```

Replace `omnipolymath.example.com` with your Gateway hostname. Store
`OMNIPOLYMATH_GATEWAY_TOKEN` in EasyRunner's secret/environment manager instead of
committing it to the app definition. With Tailscale off, the image's
detected-container default is `auto`, which resolves to `0.0.0.0`; the explicit
`--bind lan --port 1455` pins the listener that Caddy expects instead of
depending on container detection.

## Configure Omnipolymath

Inside the persistent config volume, declare the external proxy origin and
require auth:

```json5
{
  gateway: {
    bind: "lan",
    port: 1455,
    publicOrigin: "https://omnipolymath.example.com",
    auth: {
      token: "${OMNIPOLYMATH_GATEWAY_TOKEN}",
    },
  },
}
```

Use the same exact hostname in `publicOrigin` and the Caddy label. This supplies
the browser-origin allowlist when `gateway.controlUi.allowedOrigins` is omitted.

If Caddy terminates TLS for the Gateway, configure trusted-proxy settings for
the exact proxy path rather than disabling auth checks globally. See
[Trusted proxy auth](/gateway/trusted-proxy-auth).

## Verify

From your workstation:

```bash
omnipolymath gateway probe --url https://omnipolymath.example.com --token <token>
omnipolymath gateway status --url https://omnipolymath.example.com --token <token>
```

From the EasyRunner host, `GET /healthz` (liveness) and `GET /readyz`
(readiness) need no auth and back the image's built-in container health
check. Also check the app logs for a listening Gateway and no startup
SecretRef, plugin, or channel auth failures.

## Updates and backups

- Pull or build the new Omnipolymath image, then redeploy the EasyRunner app.
- Back up the `omnipolymath-config` volume before updates. It holds
  `omnipolymath.json`, shared auth in `state/omnipolymath.sqlite`, agent-local profiles
  in `agents/<agentId>/agent/omnipolymath-agent.sqlite`, and installed plugin package state.
- Back up `omnipolymath-workspace` if agents write durable project data there.
- Run `omnipolymath doctor` after major updates to catch config migrations and
  service warnings.

## Troubleshooting

- `gateway probe` cannot connect: confirm the Caddy hostname points at the app
  and that the container listens on `0.0.0.0:1455`.
- Auth fails: rotate the token in EasyRunner secrets and the local client
  command together.
- Files are root-owned after restore: the image runs as `node` (uid 1000);
  repair the mounted volumes so that user can write
  `/home/node/.omnipolymath` and `/home/node/.omnipolymath/workspace`.
- Browser or channel plugins fail: check whether the required external
  binaries, network egress, and mounted credentials are available inside the
  container.

## Related

- [Platforms](/platforms) — the VPS and hosting index this page sits under
- [Docker](/install/docker) — the container image and environment variables this Compose file uses
- [Trusted proxy auth](/gateway/trusted-proxy-auth) — the auth mode used behind Caddy
- [Gateway runbook](/gateway) — operating the Gateway once it is up
