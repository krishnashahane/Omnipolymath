---
summary: "Zalo ClawBot channel setup through the external omnipolymath-zaloclawbot plugin"
read_when:
  - You want a personal Zalo assistant bot with QR-code login
  - You are installing or troubleshooting the omnipolymath-zaloclawbot channel plugin
title: "Zalo ClawBot"
---

Omnipolymath connects to Zalo ClawBot through the catalog-listed external `@zalo-platforms/omnipolymath-zaloclawbot` plugin. Login uses a Zalo Mini App QR code; the plugin id in config is `omnipolymath-zaloclawbot`.

<Note>
  This plugin's runtime lives entirely in the external `@zalo-platforms/omnipolymath-zaloclawbot` package. Behavior details on this page beyond install and config are as reported by the plugin's maintainers and are not verified against Omnipolymath core source.
</Note>

## Compatibility

| Plugin Version | Omnipolymath Version | npm dist-tag | Status        |
| -------------- | -------------------- | ------------ | ------------- |
| 0.1.4          | >=2026.4.10          | `latest`     | Active / Beta |

## Prerequisites

- Node.js >= 22
- [Omnipolymath](/install) installed (`omnipolymath` CLI available)
- A Zalo account on a mobile device to scan the login QR code

## Install with onboard (recommended)

```bash
omnipolymath onboard
```

Pick **Zalo ClawBot** from the channel menu. The wizard installs the plugin from the official catalog (integrity-verified), renders the login QR in the terminal, and finishes the channel once you scan it with the Zalo app.

## Manual installation

To add the channel to an already-onboarded gateway:

### 1. Install the plugin

```bash
omnipolymath plugins install "@zalo-platforms/omnipolymath-zaloclawbot@0.1.4"
```

Use the exact pinned version so Omnipolymath verifies the package against the catalog integrity hash during install.

<a id="2-enable-the-plugin-in-config" />

### 2. Enable the plugin

```bash
omnipolymath plugins enable omnipolymath-zaloclawbot
```

Check the [application result](/plugins/manage-plugins#apply-changes-and-inspect)
before logging in. Reinstallation preserves a plugin you explicitly disabled.

### 3. Generate a QR code and log in

```bash
omnipolymath channels login --channel omnipolymath-zaloclawbot
```

Scan the terminal-rendered QR code with the Zalo mobile app, accept the Terms of Use inside the Zalo Mini App, and authorize the session.

<a id="4-restart-the-gateway" />

### 4. Verify the channel

```bash
omnipolymath channels status --probe
```

Start the Gateway if it is offline. Config changes follow
[hot reload](/gateway/configuration/hot-reload).
If the running channel has not picked up the saved login, run
`omnipolymath plugins reload omnipolymath-zaloclawbot`, then check its status again.

## How it works

Unlike the standard Zalo channel, which requires registering your own Zalo Official Account (OA) and configuring static developer credentials, Zalo ClawBot is an **owner-bound personal assistant** on shared official infrastructure:

1. **Onboarding:** the QR code resolves to a Zalo Mini App that binds a newly provisioned, private bot under a shared official OA directly to your Zalo user ID.
2. **Owner-bound privacy:** the bot only communicates with its owner. Messages from other users are dropped at the platform level.
3. **Official API path:** the plugin uses Zalo Bot Platform APIs, not browser or web-session automation.

## Under the hood

The plugin communicates with Zalo via a persistent long-polling loop (`getUpdates`). Webhooks are disabled by default for local desktop/terminal gateway runs. Messages are processed client-side and mapped to your local agent runtime.

The plugin manages bot credentials under the Omnipolymath state directory. Treat that directory as sensitive and cover it under the same access-control and backup policy as the rest of Omnipolymath state.

## Troubleshooting

- **QR login timeout:** the login token (`zbsk`) expires after 5 minutes for security. If the QR code expires before you scan it, rerun the login command to generate a new one.
- **Gateway fails to load:** confirm your Omnipolymath host version is `2026.4.10` or higher. Older versions do not support the external npm-plugin installation ledger this ID requires.

## Related

- [Channels Overview](/channels) - all supported channels
- [Zalo](/channels/zalo) - the bundled Zalo Bot Creator / Marketplace channel
- [Pairing](/channels/pairing) - DM authentication and pairing flow
- [Plugins](/tools/plugin) - installing and managing plugins
