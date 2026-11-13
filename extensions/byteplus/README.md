# Omnipolymath BytePlus Provider

Official Omnipolymath provider plugin for BytePlus model inference and Seedance
video generation.

Install from Omnipolymath:

```bash
omnipolymath plugins install @omnipolymath/byteplus-provider
omnipolymath gateway restart
```

Set `BYTEPLUS_API_KEY`, then select a `byteplus/*` or `byteplus-plan/*` model.

See <https://omnipolymath.vercel.app/docs/concepts/model-providers#byteplus-international>
for model setup and <https://omnipolymath.vercel.app/docs/tools/video-generation> for
Seedance video generation.

Video task submission and polling use headers and proxy settings from
`models.providers.byteplus.request`. Generated video downloads do not inherit
those task credentials or transport overrides.
