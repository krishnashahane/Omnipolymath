---
summary: "Advanced setup and development workflows for Omnipolymath"
read_when:
  - Setting up a new machine
  - You want "latest + greatest" without breaking your personal setup
title: "Setup"
---

<Note>
If you are setting up for the first time, start with [Getting Started](/start/getting-started).
For onboarding details, see [Onboarding (CLI)](/start/wizard).
</Note>

## TL;DR

Pick a setup workflow based on how often you want updates and whether you want to run the Gateway yourself:

- **Tailoring lives outside the repo:** keep your config and workspace in `~/.omnipolymath/omnipolymath.json` and `~/.omnipolymath/workspace/` so repo updates don't touch them.
- **Stable workflow (recommended for most):** install the macOS app and let it run the bundled Gateway.
- **Bleeding edge workflow (dev):** run the Gateway yourself via `pnpm gateway:watch`, then let the macOS app attach in Local mode.

## Prereqs (from source)

- Node 24.22.1+ LTS or Node 26.12.1+ (recommended)
- `pnpm` required for source checkouts. Omnipolymath loads bundled plugins from the
  `extensions/*` pnpm workspace packages in dev mode, so root `npm install` does
  not prepare the full source tree.
- Docker (optional; only for containerized setup/e2e - see [Docker](/install/docker))

Use the pnpm version pinned in `package.json`. The workspace applies a seven-day
publication cooldown to npm dependencies, with trusted `@openai/codex` and
`@openai/codex-*` packages exempt. The standalone pnpm toolchain is managed separately.

For npm tooling that reads the project's `.npmrc`, use npm **11.19 or newer** for
install and `npm pack` cooldowns and Codex exclusions. Node runtime support does
not imply support for its bundled npm as a source resolver. [Published/global installs](/install) do not
inherit the repository's `.npmrc`. Source installs continue to use pnpm.

pnpm owns root and plugin-local dependencies, including workspace links and
versions that differ between packages. Postinstall and build preparation preserve
those trees. If an older checkout pruned plugin-local dependencies, run
`pnpm install --frozen-lockfile` after updating to restore them before testing.

## Tailoring strategy (so updates do not hurt)

If you want "100% tailored to me" _and_ easy updates, keep your customization in:

- **Config:** `~/.omnipolymath/omnipolymath.json` (JSON/JSON5-ish)
- **Workspace:** `~/.omnipolymath/workspace` (skills, prompts, memories; make it a private git repo)

Bootstrap the config/workspace folders once, without running the full onboarding wizard:

```bash
omnipolymath setup --baseline
```

No global install yet? Run it from this repo instead:

```bash
pnpm omnipolymath setup --baseline
```

(Bare `omnipolymath setup`, without `--baseline`, opens an interactive Omnipolymath chat on a configured system and falls through to guided onboarding on a fresh one. See [Setup CLI](/cli/setup) for the full routing order.)

## Run the Gateway from this repo

After `pnpm build`, you can run the packaged CLI directly:

```bash
node omnipolymath.mjs gateway --port 18789 --verbose
```

## Stable workflow (macOS app first)

1. Install + launch **Omnipolymath.app** (menu bar).
2. Complete the onboarding/permissions checklist (TCC prompts).
3. Check that Gateway is **Local** and running (the app manages it).
4. Link surfaces (example: WhatsApp):

```bash
omnipolymath channels login
```

5. Sanity check:

```bash
omnipolymath health
```

If onboarding is not available in your build:

- Run `omnipolymath setup`, then `omnipolymath channels login`, then start the Gateway manually (`omnipolymath gateway`).

## Bleeding edge workflow (Gateway in a terminal)

Goal: work on the TypeScript Gateway, get hot reload, keep the macOS app UI attached.

### 0) (Optional) Run the macOS app from source too

If you also want the macOS app on the bleeding edge:

```bash
./scripts/restart-mac.sh
```

### 1) Start the dev Gateway

```bash
pnpm install
# First run only (or after resetting local Omnipolymath config/workspace)
pnpm omnipolymath setup
pnpm gateway:watch
```

What `gateway:watch` does:

- It starts or restarts the Gateway watch process in a named tmux session,
  `omnipolymath-gateway-watch-main`, and auto-attaches from interactive terminals.
- Non-interactive shells stay detached and print
  `tmux attach -t omnipolymath-gateway-watch-main`. Run
  `OMNIPOLYMATH_GATEWAY_WATCH_ATTACH=0 pnpm gateway:watch` to keep an interactive
  run detached, or `pnpm gateway:watch:raw` for foreground watch mode.
- It stops the active profile's installed Gateway service before it takes over
  that service's configured or default port. This prevents the service
  supervisor from replacing the source process. The service stays installed.
  Run `pnpm omnipolymath gateway start` when you finish watching.
- The tmux pane remains available after a startup failure, so another terminal
  or agent can attach to it or capture its logs.
- It reloads on relevant source, config, and bundled-plugin metadata changes.
- If the watched Gateway exits during startup, `gateway:watch` runs
  `omnipolymath doctor --fix --non-interactive` once and retries. Set
  `OMNIPOLYMATH_GATEWAY_WATCH_AUTO_DOCTOR=0` to disable that dev-only repair pass.

`pnpm omnipolymath ...` reuses the existing `dist` when its recorded build-input bytes still match, even if Git marks those inputs dirty, so a second source command in the same checkout does not replace the build a running source Gateway executes. Changed inputs still rebuild, and a foreground Gateway from that checkout then exits on installation replacement.

TypeScript rebuilds triggered by `pnpm omnipolymath ...` or `pnpm gateway:watch` preserve existing `dist/control-ui` assets. When the Gateway starts, it rebuilds missing, incomplete, or stale bundled UI assets before serving them. UI builds replace `dist/control-ui` only after the complete bundle passes validation, so a failed build leaves the previous bundle in place. If a build is killed while swapping in its output, the next build restores the previous bundle first. Headless commands do not rebuild the UI. Run `pnpm ui:build` after `ui/` changes, or use `pnpm ui:dev` while developing the Control UI.

### 2) Point the macOS app at your running Gateway

In **Omnipolymath.app**:

- Connection Mode: **Local**
  The app will attach to the running gateway on the configured port.

### 3) Verify

- In-app Gateway status should read **"Using existing gateway …"**
- Or via CLI:

```bash
omnipolymath health
```

### Common footguns

- **Wrong port:** Gateway WS defaults to `ws://127.0.0.1:18789`; keep app + CLI on the same port.
- **Wrong developer CLI:** When `PATH` includes `node_modules/.bin`, `codex` can
  resolve to the workspace-pinned CLI instead of your standalone installation.
  For developer workers, use the intended executable's absolute path for both
  `--version` and `exec`, and confirm the worker's startup version. A package
  manifest or a version check in another shell does not identify a running worker.
  Omnipolymath's [managed Codex app-server](/plugins/codex-harness-reference#app-server-transport)
  has a separate pinned-version contract; do not change that pin or your model/auth
  settings to fix developer CLI selection. If the installed workspace package and
  native executable disagree with the lockfile, repair the install with `pnpm install`
  rather than editing `node_modules`.
- **Where state lives:**
  - Channel/provider state: `~/.omnipolymath/credentials/`
  - Model auth profiles: SQLite auth stores (shared: `~/.omnipolymath/state/omnipolymath.sqlite`; agent-local: `~/.omnipolymath/agents/<agentId>/agent/omnipolymath-agent.sqlite`)
  - Sessions and transcripts: `~/.omnipolymath/agents/<agentId>/agent/omnipolymath-agent.sqlite`
  - Legacy/archive session artifacts: `~/.omnipolymath/agents/<agentId>/sessions/`
  - Logs: `/tmp/omnipolymath/`

## Credential storage map

Use this when debugging auth or deciding what to back up:

- **WhatsApp**: `~/.omnipolymath/credentials/whatsapp/<accountId>/creds.json`
- **Telegram bot token**: config/env or `channels.telegram.tokenFile` (regular file only; symlinks rejected)
- **Discord bot token**: config/env or SecretRef (env/file/exec/store providers)
- **Slack tokens**: config/env (`channels.slack.*`)
- **Pairing allowlists**: shared database (by default, `~/.omnipolymath/state/omnipolymath.sqlite`), scoped by channel and account; see [Pairing state](/channels/pairing#where-the-state-lives) and [Database engines](/reference/database-engines)
- **Model auth profiles**: shared and agent-local SQLite auth stores; see [Auth credential semantics](/auth-credential-semantics#agent-copy-portability) for inheritance and legacy shared-store relocation
- **File-backed secrets payload (optional)**: `~/.omnipolymath/secrets.json`
- **Legacy OAuth import**: `~/.omnipolymath/credentials/oauth.json`
  More detail: [Security](/gateway/security/secrets-and-storage#credential-storage-map).

## Updating (without wrecking your setup)

- Keep `~/.omnipolymath/workspace` and `~/.omnipolymath/` as "your stuff"; don't put personal prompts/config into the `omnipolymath` repo.
- Updating source: `git pull` + `pnpm install` + keep using `pnpm gateway:watch`.

## Linux (systemd user service)

Linux installs use a systemd **user** service. By default, systemd stops user
services on logout/idle, which kills the Gateway. Onboarding attempts to enable
lingering for you (may prompt for sudo). If it's still off, run:

```bash
sudo loginctl enable-linger $USER
```

For always-on or multi-user servers, consider a **system** service instead of a
user service (no lingering needed). See [Gateway runbook](/gateway) for the systemd notes.

## Related docs

- [Gateway runbook](/gateway) (flags, supervision, ports)
- [Gateway configuration](/gateway/configuration) (config schema + examples)
- [Discord](/channels/discord) and [Telegram](/channels/telegram) (reply tags + replyToMode settings)
- [Omnipolymath assistant setup](/start/omnipolymath)
- [macOS app](/platforms/macos) (gateway lifecycle)
