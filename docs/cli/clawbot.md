---
summary: "CLI reference for `omnipolymath clawbot` (legacy alias namespace)"
read_when:
  - You maintain older scripts using `omnipolymath clawbot ...`
  - You need migration guidance to current commands
title: "Clawbot"
---

# `omnipolymath clawbot`

Legacy alias namespace kept for backward compatibility. It registers the same QR command as the top-level CLI, so `omnipolymath clawbot qr` accepts every [`omnipolymath qr`](/cli/qr) flag. No removal is scheduled; prefer the top-level commands in new scripts.

## Migration

Prefer the modern top-level command:

- `omnipolymath clawbot qr` -> `omnipolymath qr`

## Related

- [CLI reference](/cli)
