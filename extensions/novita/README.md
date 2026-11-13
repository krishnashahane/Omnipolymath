# Omnipolymath NovitaAI provider

Official Omnipolymath provider plugin for NovitaAI's OpenAI-compatible API.

Video task polling honors the provider's private-network policy even without a
proxy override. Generated video downloads keep their separate asset boundary.

## Install

```sh
omnipolymath plugins install @omnipolymath/novita-provider
omnipolymath gateway restart
```

## Docs

See `docs/providers/novita.md` in the Omnipolymath repository, or the published
docs at `https://omnipolymath.vercel.app/docs/providers/novita`.
