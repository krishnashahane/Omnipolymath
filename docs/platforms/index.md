---
summary: "Platform support overview (Gateway + companion apps)"
read_when:
  - Looking for OS support or install paths
  - Deciding where to run the Gateway
title: "Platforms"
---

Omnipolymath core is written in TypeScript. **Node is the primary, default, and
recommended runtime**. Bun 1.4.4+ builds with WAL-reset-safe `node:sqlite` can run
the CLI, Gateway, and managed node host as an explicit opt-in; see
[Bun](/install/bun).

Companion apps exist for Linux, Windows Hub, macOS (menu bar app), and mobile
nodes (iOS/Android). Desktop apps aren't published for Omnipolymath yet. On Windows, choose the native PowerShell install for terminal-first use, or
WSL2 for the most Linux-compatible Gateway runtime.

## Choose your OS

- Android: [Android](/platforms/android)
- ChromeOS: [ChromeOS (Crostini)](/platforms/chromeos)
- iOS: [iOS](/platforms/ios)
- Linux: [Linux](/platforms/linux)
- macOS: [macOS](/platforms/macos)
- Omarchy: [Omarchy](/platforms/omarchy)
- Windows: [Windows](/platforms/windows)

## VPS and hosting

- VPS hub: [VPS hosting](/vps)
- Azure (Linux VM): [Azure](/install/azure)
- Daytona (cloud sandbox): [Daytona](/install/daytona)
- EasyRunner (Podman + Caddy): [EasyRunner](/platforms/easyrunner)
- exe.dev (VM + HTTPS proxy): [exe.dev](/install/exe-dev)
- Fly.io: [Fly.io](/install/fly)
- GCP (Compute Engine): [GCP](/install/gcp)
- Hetzner (Docker): [Hetzner](/install/hetzner)

## Common links

- Install guide: [Getting Started](/start/getting-started)
- Windows Hub: [Windows](/platforms/windows)
- Gateway runbook: [Gateway](/gateway)
- Gateway configuration: [Configuration](/gateway/configuration)
- Service status: `omnipolymath gateway status`

## Gateway service install (CLI)

Use one of these (all supported):

- Wizard (recommended): `omnipolymath onboard --install-daemon`
- Direct: `omnipolymath gateway install`
- Configure flow: `omnipolymath configure` → select **Gateway service**
- Repair/migrate: `omnipolymath doctor` (offers to install or fix the service)

The service target depends on OS:

- macOS: LaunchAgent (`ai.omnipolymath.gateway`, or `ai.omnipolymath.<profile>` for a named profile)
- Linux/WSL2: systemd user service (`omnipolymath-gateway[-<profile>].service`)
- Native Windows: Scheduled Task (`Omnipolymath Gateway` or `Omnipolymath Gateway (<profile>)`), with a per-user Startup-folder login item fallback if task creation is denied

## Related

- [Install overview](/install)
- [Windows Hub](/platforms/windows)
- [macOS app](/platforms/macos)
- [iOS app](/platforms/ios)
