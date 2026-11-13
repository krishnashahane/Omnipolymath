# @omnipolymath/zalouser

Omnipolymath extension for Zalo Personal Account messaging via native `zca-js` integration.

> **Warning:** Using Zalo automation may result in account suspension or ban. Use at your own risk. This is an unofficial integration.

## Features

- Channel plugin integration with setup wizard + QR login
- In-process listener/sender via `zca-js` (no external CLI)
- Multi-account support
- Agent tool integration (`zalouser`)
- DM/group policy support

## Prerequisites

- Omnipolymath Gateway
- Zalo mobile app (for QR login)

No external `zca`, `openzca`, or `zca-cli` binary is required.

## Install

### Option A: npm

```bash
omnipolymath plugins install @omnipolymath/zalouser
```

### Option B: local source checkout

```bash
PLUGIN_SRC=./path/to/local/zalouser-plugin
omnipolymath plugins install "$PLUGIN_SRC"
cd "$PLUGIN_SRC" && pnpm install
```

Restart the Gateway after install.

## Quick start

### Login (QR)

```bash
omnipolymath channels login --channel zalouser
```

Scan the QR code with the Zalo app on your phone.

### Enable channel

```yaml
channels:
  zalouser:
    enabled: true
    dmPolicy: pairing # pairing | allowlist | open | disabled
```

### Send a message

```bash
omnipolymath message send --channel zalouser --target <threadId> --message "Hello from Omnipolymath"
```

## Configuration

Basic:

```yaml
channels:
  zalouser:
    enabled: true
    dmPolicy: pairing
```

Multi-account:

```yaml
channels:
  zalouser:
    enabled: true
    defaultAccount: default
    accounts:
      default:
        enabled: true
        profile: default
      work:
        enabled: true
        profile: work
```

## Useful commands

```bash
omnipolymath channels login --channel zalouser
omnipolymath channels login --channel zalouser --account work
omnipolymath channels status --probe
omnipolymath channels logout --channel zalouser

omnipolymath directory self --channel zalouser
omnipolymath directory peers list --channel zalouser --query "name"
omnipolymath directory groups list --channel zalouser --query "work"
omnipolymath directory groups members --channel zalouser --group-id <id>
```

## Agent tool

The extension registers a `zalouser` tool for AI agents.

Available actions: `send`, `image`, `link`, `friends`, `groups`, `me`, `status`

## Troubleshooting

- Login not persisted: `omnipolymath channels logout --channel zalouser && omnipolymath channels login --channel zalouser`
- Check status: `omnipolymath channels status --probe`
- Name resolution issues (allowlist/groups): use numeric IDs or exact Zalo names

## Runtime lifetime

Managed registrations isolate restored API sessions, pending logins, and cached group
information. Retirement releases that instance's in-memory state after admitted
channel calls settle; it does not delete saved credentials. Standalone helper use
retains process-local session reuse until explicit logout or process exit.

## Credits

Built on [zca-js](https://github.com/RFS-ADRENO/zca-js).
