---
summary: "Hostinger has no managed Omnipolymath plan; use a Hostinger VPS with the standard VPS guide"
read_when:
  - Setting up Omnipolymath on Hostinger
  - Looking for a managed VPS for Omnipolymath
title: "Hostinger"
---

Hostinger doesn't offer a 1-Click or managed Omnipolymath plan, and there is no Omnipolymath image in its Docker Manager. Plans you may see there are for other software and won't install Omnipolymath.

You can still run Omnipolymath on any Hostinger **VPS** that you administer yourself:

1. Create an Ubuntu VPS in hPanel and connect to it over SSH.
2. Follow the [VPS hosting](/vps) guide, which installs Omnipolymath from source and keeps the Gateway running as a service.
3. Keep the Gateway bound to loopback and reach the Control UI through an SSH tunnel or [Tailscale](/gateway/tailscale) instead of opening its port to the internet.

## Verify your setup

Run `omnipolymath doctor` on the VPS, then send "Hi" to your assistant on a channel you connected.

## Related

- [Install overview](/install)
- [VPS hosting](/vps)
- [DigitalOcean](/install/digitalocean)
