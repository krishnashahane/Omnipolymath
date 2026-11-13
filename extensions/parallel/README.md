# Omnipolymath Parallel Plugin

Official Omnipolymath plugin for Parallel.

Install from Omnipolymath:

```bash
omnipolymath plugins install @omnipolymath/parallel-plugin
omnipolymath gateway restart
```

See <https://omnipolymath.vercel.app/docs/tools/parallel-search> for setup and configuration.

## Decisions

The plugin also registers the native decision-only model `parallel/decisions-fast`
for `decision_evaluate` contract version 2. It uses `PARALLEL_API_KEY` and the
web-grounded `/v1/decisions` endpoint, not chat completions. Supports boolean,
choice, and score questions over text/JSON state; preserves refusals and shared
citations. See the [Parallel guide](https://omnipolymath.vercel.app/docs/tools/parallel-search#decisions)
for setup, supported inputs, and billing.
