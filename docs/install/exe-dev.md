---
summary: "Run Omnipolymath Gateway on exe.dev (VM + HTTPS proxy) for remote access"
read_when:
  - You want a cheap always-on Linux host for the Gateway
  - You want remote Control UI access without running your own VPS
title: "exe.dev"
---

**Goal:** Omnipolymath Gateway running on an [exe.dev](https://exe.dev) VM, reachable at `https://<vm-name>.exe.xyz`.

This guide assumes exe.dev's default **exeuntu** image. Map packages accordingly on other distros.

## What you need

- exe.dev account
- `ssh exe.dev` access to exe.dev VMs (optional, for manual setup)

## Automated install with Shelley

Shelley, exe.dev's agent, can install Omnipolymath from a prompt:

```text
Set up Omnipolymath (https://omnipolymath.vercel.app/docs/install) on this VM. Use the non-interactive and accept-risk flags for omnipolymath onboarding. Add the supplied auth or token as needed. Configure nginx to forward from the default port 18789 to the root location on the default enabled site config, making sure to enable Websocket support. Set gateway.controlUi.allowedOrigins to the exact https://<vm-name>.exe.xyz origin, and set gateway.trustedProxies to ["127.0.0.1"] because nginx connects to the Gateway over loopback and overwrites X-Forwarded-For. Pairing is done by "omnipolymath devices list" and "omnipolymath devices approve <request id>". Make sure the dashboard shows that Omnipolymath's health is OK. exe.dev handles forwarding from port 8000 to port 80/443 and HTTPS for us, so the final "reachable" should be <vm-name>.exe.xyz, without port specification.
```

## Manual installation

<Steps>
  <Step title="Create the VM">
    From your device:

    ```bash
    ssh exe.dev new
    ```

    Then connect:

    ```bash
    ssh <vm-name>.exe.xyz
    ```

    <Tip>
    Keep this VM **stateful**. Omnipolymath stores `omnipolymath.json`, shared and per-agent SQLite auth stores, sessions, and channel/provider state under `~/.omnipolymath/`, plus the workspace under `~/.omnipolymath/workspace/`.
    </Tip>

  </Step>

  <Step title="Install prerequisites (on the VM)">
    ```bash
    sudo apt-get update
    sudo apt-get install -y git curl jq ca-certificates openssl
    ```
  </Step>

  <Step title="Install Omnipolymath">
    ```bash
    curl -fsSL https://omnipolymath.vercel.app/install.sh | bash
    ```
  </Step>

  <Step title="Configure nginx to proxy to port 8000">
    Edit `/etc/nginx/sites-enabled/default`:

    ```nginx
    server {
        listen 80 default_server;
        listen [::]:80 default_server;
        listen 8000;
        listen [::]:8000;

        server_name _;

        location / {
            proxy_pass http://127.0.0.1:18789;
            proxy_http_version 1.1;

            # WebSocket support
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";

            # Standard proxy headers
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_set_header X-Forwarded-Proto $scheme;

            # Timeout settings for long-lived connections
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
        }
    }
    ```

    Overwrite forwarding headers instead of preserving client-supplied chains. Omnipolymath trusts forwarded IP metadata only from explicitly configured proxies, and append-style `X-Forwarded-For` chains are treated as a hardening risk.

  </Step>

  <Step title="Trust nginx and allow the public browser origin">
    Configure the exact public origin and trust only the loopback nginx hop:

    ```bash
    omnipolymath config set gateway.controlUi.allowedOrigins '["https://<vm-name>.exe.xyz"]' --strict-json
    omnipolymath config set gateway.trustedProxies '["127.0.0.1"]' --strict-json
    omnipolymath gateway restart
    ```

    The browser origin check rejects public hostnames that are not allowed. The proxy
    allowlist lets Omnipolymath use nginx's overwritten `X-Forwarded-For` value
    instead of treating every request as if it originated from the loopback
    proxy. Keep this list limited to proxies you control.

  </Step>

  <Step title="Access Omnipolymath and approve devices">
    Open `https://<vm-name>.exe.xyz/` (see the Control UI output from onboarding). If it prompts for auth, paste the configured shared secret from the VM.

    This guide uses token auth by default, so run `omnipolymath gateway auth-token --show` in an interactive terminal to retrieve the configured token. If no token is configured, generate one with `omnipolymath doctor --generate-gateway-token` and restart the Gateway. If you switched the gateway to password auth, use `gateway.auth.password` / `OMNIPOLYMATH_GATEWAY_PASSWORD` instead.

    Approve devices with `omnipolymath devices list` and `omnipolymath devices approve <requestId>`. When in doubt, use Shelley from your browser.

  </Step>
</Steps>

## Remote channel setup

For remote hosts, prefer one `config patch` call over many SSH calls to `config set`. Keep real tokens in the VM environment or `~/.omnipolymath/.env`, and put only SecretRefs in `omnipolymath.json`. See [Secrets management](/gateway/secrets) for the full SecretRef contract.

On the VM, make the service environment contain the secrets it needs:

```bash
cat >> ~/.omnipolymath/.env <<'EOF'
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
DISCORD_BOT_TOKEN=...
OPENAI_API_KEY=sk-...
EOF
```

From your local machine, create a patch file and pipe it to the VM:

```json5
// omnipolymath.remote.patch.json5
{
  secrets: {
    providers: {
      default: { source: "env" },
    },
  },
  channels: {
    slack: {
      enabled: true,
      mode: "socket",
      botToken: { source: "env", provider: "default", id: "SLACK_BOT_TOKEN" },
      appToken: { source: "env", provider: "default", id: "SLACK_APP_TOKEN" },
      groupPolicy: "open",
      requireMention: false,
    },
    discord: {
      enabled: true,
      token: { source: "env", provider: "default", id: "DISCORD_BOT_TOKEN" },
      dmPolicy: "disabled",
      dm: { enabled: false },
      groupPolicy: "allowlist",
    },
  },
  agents: {
    defaults: {
      model: { primary: "openai/gpt-6-astra" },
      models: {
        "openai/gpt-6-astra": { params: { fastMode: true } },
      },
    },
  },
}
```

```bash
ssh <vm-name>.exe.xyz 'omnipolymath config patch --stdin --dry-run' < ./omnipolymath.remote.patch.json5
ssh <vm-name>.exe.xyz 'omnipolymath config patch --stdin' < ./omnipolymath.remote.patch.json5
ssh <vm-name>.exe.xyz 'omnipolymath gateway restart && omnipolymath health'
```

Use `--replace-path` when a nested allowlist should become exactly the patch value, for example replacing a Discord channel allowlist:

```bash
ssh <vm-name>.exe.xyz 'omnipolymath config patch --stdin --replace-path "channels.discord.guilds[\"123\"].channels"' < ./discord.patch.json5
```

See [Discord](/channels/discord) and [Slack](/channels/slack) for full channel config reference.

## Remote access

exe.dev handles authentication for remote access. By default, HTTP traffic from port 8000 is forwarded to `https://<vm-name>.exe.xyz` with email auth.

## Updating

```bash
omnipolymath update
```

See [Updating](/install/updating) for channel switches and manual recovery.

## Related

- [Remote gateway](/gateway/remote)
- [Install overview](/install)
