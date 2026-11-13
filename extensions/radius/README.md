# Omnipolymath Radius Provider

Connect Omnipolymath to Earendil's Radius gateway with browser sign-in or an
organization API key. The plugin discovers account-visible models and supports
native Pi message streaming, reasoning, images on supported models, and tool calls.

```bash
omnipolymath plugins install @omnipolymath/radius-provider
omnipolymath models auth login --provider radius --method oauth --set-default
omnipolymath models list --provider radius --refresh
```

For API-key setups, use `--method api-key` or `RADIUS_API_KEY`.
Requests use the selected organization's credits and policies.

See [Radius setup and configuration](https://omnipolymath.vercel.app/docs/providers/radius).
