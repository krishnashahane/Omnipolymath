---
summary: "Ansible deployment for Omnipolymath: not available yet; use the Linux server guide"
read_when:
  - You want automated server deployment with security hardening
  - You're deploying to remote Debian/Ubuntu servers
title: "Ansible"
---

Omnipolymath doesn't ship an Ansible playbook yet.

To run Omnipolymath on a Debian or Ubuntu server today:

1. Install it with the installer script from the [install guide](/install).
2. Follow the [Linux server guide](/vps) to run the Gateway as a service.
3. Keep the Gateway private: reach it over SSH or a VPN such as Tailscale, and
   turn on the [sandbox](/gateway/sandboxing) so shell commands run in Docker.
