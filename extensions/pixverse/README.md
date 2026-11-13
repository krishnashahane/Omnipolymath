# @omnipolymath/pixverse-provider

Official PixVerse video generation provider plugin for Omnipolymath.

This plugin registers PixVerse as a `video_generate` provider for text-to-video and image-to-video workflows.

## Install

```bash
omnipolymath plugins install @omnipolymath/pixverse-provider
```

Restart the Gateway after installing or updating the plugin.

## Configure

Store your PixVerse API key in Omnipolymath config or expose the supported environment variable to the Gateway. Then select PixVerse as a video generation provider.

Full setup and model/provider examples:

- https://omnipolymath.vercel.app/docs/providers/pixverse

## Package

- Plugin id: `pixverse`
- Package: `@omnipolymath/pixverse-provider`
- Minimum Omnipolymath host: `2026.5.26`
