# @omnipolymath/tokenjuice

Official Tokenjuice output compaction plugin for Omnipolymath.

Tokenjuice compacts noisy Omnipolymath `exec` and `bash` tool results in embedded runs and Omnipolymath dynamic tools in the Codex app-server harness. Native codex-rs shell results returned to the model stay unchanged. It does not rewrite commands, rerun commands, or change exit codes.

## Install

```bash
omnipolymath plugins install @omnipolymath/tokenjuice
```

Restart the Gateway after installing or updating the plugin.

## Enable

```bash
omnipolymath config set plugins.entries.tokenjuice.enabled true
```

Equivalent:

```bash
omnipolymath plugins enable tokenjuice
```

## Docs

- https://omnipolymath.vercel.app/docs/tools/tokenjuice

## Package

- Plugin id: `tokenjuice`
- Package: `@omnipolymath/tokenjuice`
- Minimum Omnipolymath host: `2026.5.28`
