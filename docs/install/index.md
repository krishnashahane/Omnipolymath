---
summary: "Install Omnipolymath from source with the installer script, by hand, or with Docker"
read_when:
  - You need an install method other than the Getting Started quickstart
  - You want to deploy to a cloud platform
  - You need to update, migrate, or uninstall
title: "Install"
---

## System requirements

- **git**, **pnpm**, and **Node 24.16.0+ on 24.x, or 26.1.0+** (24.22.1+/26.12.1+ strongly recommended for security). See [Node.js compatibility](/install/node-compatibility). The installer checks for all three and tells you what is missing; it does not install them for you.
- **macOS or Linux.** On Windows, run Omnipolymath inside WSL2. See [Windows](/platforms/windows).

Omnipolymath isn't published to npm yet, and there are no desktop app downloads, so every method on this page builds from source.

## Recommended: installer script

The installer clones the repository to `~/.omnipolymath-src`, installs dependencies with pnpm, builds the CLI and Control UI, links the `omnipolymath` command into `~/.local/bin`, and starts onboarding. It never runs as root.

```bash
curl -fsSL https://omnipolymath.vercel.app/install.sh | bash
```

To install without running onboarding:

```bash
curl -fsSL https://omnipolymath.vercel.app/install.sh | bash -s -- --no-onboard
```

Run it again at any time to update to the latest `main`. Environment overrides:

| Variable            | Default                                              | Purpose                                    |
| ------------------- | ---------------------------------------------------- | ------------------------------------------ |
| `OMNIPOLYMATH_DIR`  | `~/.omnipolymath-src`                                | Where the source checkout lives            |
| `OMNIPOLYMATH_REPO` | `https://github.com/krishnashahane/Omnipolymath.git` | Repository to clone                        |
| `OMNIPOLYMATH_REF`  | `main`                                               | Branch or tag to build                     |
| `OMNIPOLYMATH_BIN`  | `~/.local/bin`                                       | Where the `omnipolymath` command is linked |

On Windows, `iwr -useb https://omnipolymath.vercel.app/install.ps1 | iex` checks for WSL2 and prints the exact next steps; it doesn't change your system.

## Alternative install methods

### From source

For contributors or anyone who wants to run from a local checkout:

```bash
git clone https://github.com/krishnashahane/Omnipolymath.git
cd omnipolymath
corepack enable
pnpm install && pnpm build && pnpm ui:build
pnpm add --global "omnipolymath@link:$PWD"
omnipolymath onboard --install-daemon
```

`pnpm add --global "omnipolymath@link:$PWD"` links the CLI to this checkout without changing its package files. If pnpm reports that its global bin directory is not on `PATH`, run `pnpm setup`, reopen your shell, and retry.

For a server checkout that only runs Omnipolymath, use `pnpm build:runtime` to build
the JavaScript, plugins, Control UI, and metadata without TypeScript declarations.
Use `pnpm build` for development or packaging that needs declarations and their
validation; CI typechecks still apply to runtime-only builds.

Corepack selects the exact pnpm version from `package.json` (currently pnpm 12).
If Corepack is unavailable, read that version from the checkout and install it explicitly:

```bash
pnpm_spec=$(node -p "require('./package.json').packageManager.split('+')[0]")
npm install -g "$pnpm_spec" --allow-scripts="$pnpm_spec"
```

The `+` suffix records Corepack's integrity hash and is not part of the npm package specifier.
Keep npm install scripts and optional dependencies enabled so pnpm can provision its native executable.

Or skip the global install and use `pnpm omnipolymath ...` from inside the repo. See [Setup](/start/setup) for full development workflows.

### Standalone builds

For application packaging or a deployment without a separate Node or Bun
installation, build an executable and companion runtime directory from source.
See [Standalone builds](/install/standalone) for modes, output files, signing,
and the update boundary.

### Containers and package managers

<CardGroup cols={2}>
  <Card title="Ansible" href="/install/ansible" icon="server">
    Not available yet; how to run on a server today.
  </Card>
  <Card title="Bun" href="/install/bun" icon="zap">
    Optional dependency installer and package-script runner.
  </Card>
  <Card title="Docker" href="/install/docker" icon="container">
    Containerized or headless deployments.
  </Card>
  <Card title="Nix" href="/install/nix" icon="snowflake">
    Nix mode for declaratively managed configs.
  </Card>
  <Card title="Podman" href="/install/podman" icon="container">
    Rootless container alternative to Docker.
  </Card>
</CardGroup>

## Verify the install

```bash
omnipolymath --version      # confirm the CLI is available
omnipolymath doctor         # check for config issues
omnipolymath gateway status # verify the Gateway is running
```

If you want managed startup after install:

- macOS: LaunchAgent via `omnipolymath onboard --install-daemon` or `omnipolymath gateway install`
- Linux/WSL2: systemd user service via the same commands
- Native Windows: Scheduled Task first, with a per-user Startup-folder login item fallback if task creation is denied

## Next: run onboarding and connect a channel

<CardGroup cols={2}>
  <Card title="Getting started" href="/start/getting-started" icon="rocket">
    Run onboarding, install the Gateway service, and open the dashboard.
  </Card>
  <Card title="Connect a channel" href="/channels" icon="message-square">
    Message your agent from Telegram, Discord, Slack, WhatsApp, and more.
  </Card>
</CardGroup>

## Hosting and deployment

Deploy Omnipolymath on a cloud server or VPS. See [Linux server](/vps) for the full
provider picker (DigitalOcean, Hetzner, Hostinger, Fly.io, GCP, Azure, Railway,
Northflank, Oracle Cloud, Raspberry Pi, and more), deploy declaratively on
[Render](/install/render), or try the experimental [Cloudflare Containers](/install/cloudflare)
template.

<CardGroup cols={3}>
  <Card title="Cloudflare" href="/install/cloudflare">
    Experimental Worker + Container deployment.
  </Card>
  <Card title="Docker VM" href="/install/docker-vm-runtime">
    Shared Docker steps.
  </Card>
  <Card title="Kubernetes" href="/install/kubernetes">
    K8s deployment.
  </Card>
  <Card title="macOS VM" href="/install/macos-vm">
    Isolated local or hosted macOS deployment.
  </Card>
  <Card title="Upstash Box" href="/install/upstash">
    Managed Linux host with SSH-tunneled access.
  </Card>
  <Card title="VPS" href="/vps">
    Pick a provider.
  </Card>
</CardGroup>

## Back up, update, migrate, or uninstall

<CardGroup cols={3}>
  <Card title="Backups" href="/install/backups" icon="archive">
    Create, verify, and restore state archives.
  </Card>
  <Card title="Updating" href="/install/updating" icon="refresh-cw">
    Keep Omnipolymath up to date.
  </Card>
  <Card title="Migrating" href="/install/migrating" icon="arrow-right">
    Move to a new machine.
  </Card>
  <Card title="Uninstall" href="/install/uninstall" icon="trash-2">
    Remove Omnipolymath completely.
  </Card>
</CardGroup>

## Troubleshooting: `omnipolymath` not found

Almost always a PATH issue: npm's global bin directory isn't on your shell's `PATH`. See [Node.js troubleshooting](/install/node#troubleshooting) for the full fix, including the Windows path.

```bash
node -v           # Node installed?
npm prefix -g     # Where are global packages?
echo "$PATH"      # Is the global bin dir in PATH?
```
