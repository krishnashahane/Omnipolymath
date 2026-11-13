# @omnipolymath/diagnostics-prometheus

Official Prometheus diagnostics exporter for Omnipolymath.

This plugin exposes Omnipolymath Gateway runtime metrics in Prometheus text format for Prometheus, Grafana, VictoriaMetrics, and compatible scrapers.

## Install

```bash
omnipolymath plugins install @omnipolymath/diagnostics-prometheus
```

Restart the Gateway after installing or updating the plugin.

## Configure

Enable the plugin and set the scrape endpoint options in `plugins.entries.diagnostics-prometheus.config`.

The full config surface, metric names, and scrape examples live in the docs:

- https://omnipolymath.vercel.app/docs/gateway/prometheus

## Package

- Plugin id: `diagnostics-prometheus`
- Package: `@omnipolymath/diagnostics-prometheus`
- Minimum Omnipolymath host: `2026.4.25`
