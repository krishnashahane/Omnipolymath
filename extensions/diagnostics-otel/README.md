# @omnipolymath/diagnostics-otel

Official OpenTelemetry diagnostics exporter for Omnipolymath.

This plugin exports Omnipolymath Gateway traces, metrics, and logs to an OTLP collector for observability stacks such as Grafana, Datadog, Honeycomb, New Relic, Tempo, and compatible collectors. It can also write diagnostic log records as stdout JSONL for container log pipelines.

## Install

```bash
omnipolymath plugins install @omnipolymath/diagnostics-otel
```

Restart the Gateway after installing or updating the plugin.

## Configure

Enable the plugin, set `diagnostics.otel.enabled` to `true`, and set the collector URL in `diagnostics.otel.endpoint`.

The full config surface, metric names, span names, and collector examples live in the docs:

- https://omnipolymath.vercel.app/docs/gateway/opentelemetry

## Package

- Plugin id: `diagnostics-otel`
- Package: `@omnipolymath/diagnostics-otel`
- Minimum Omnipolymath host: `2026.4.25`
