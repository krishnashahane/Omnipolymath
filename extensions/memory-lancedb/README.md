# @omnipolymath/memory-lancedb

Official LanceDB-backed long-term memory plugin for Omnipolymath.

This plugin adds persistent memory tools backed by LanceDB, vector search, auto-recall, and auto-capture.

## Install

```bash
omnipolymath plugins install @omnipolymath/memory-lancedb
```

Restart the Gateway after installing or updating the plugin.

## What it provides

- `memory_store`
- `memory_recall`
- `memory_forget`
- LanceDB vector storage and hybrid memory retrieval.
- Host memory status and authorized Gateway search and retrieval through the memory provider runtime.
- `omnipolymath ltm optimize` for offline local-table compaction, preserving rows and version history.

## Configure

Use the memory plugin docs for embedding provider setup, storage paths, indexing, and recall behavior:

- <https://omnipolymath.vercel.app/docs/plugins/memory-lancedb>

## Package

- Plugin id: `memory-lancedb`
- Package: `@omnipolymath/memory-lancedb`
- Enforced minimum Omnipolymath host (`omnipolymath.install.minHostVersion`): `>=2026.5.31`
- Enforced plugin API compatibility (`omnipolymath.compat.pluginApi`): `>=2026.9.3`

The installer checks these ranges independently. Both must be satisfied.
