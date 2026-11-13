# @omnipolymath/comfy-provider

Official ComfyUI image, video, and music generation provider plugin for
Omnipolymath.

## Install

```bash
omnipolymath plugins install @omnipolymath/comfy-provider
omnipolymath gateway restart
```

## Configure

Local ComfyUI workflows do not require credentials. Comfy Cloud workflows use
`COMFY_API_KEY` or `COMFY_CLOUD_API_KEY`.

Full workflow, model, and provider configuration:

- https://omnipolymath.vercel.app/docs/providers/comfy

## Package

- Plugin id: `comfy`
- Package: `@omnipolymath/comfy-provider`
- Minimum Omnipolymath host: `2026.7.2`
