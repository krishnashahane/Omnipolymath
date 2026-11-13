---
summary: "The @omnipolymath/ai npm package: reusable model transports, isolated runtimes, and host policy ports"
title: "@omnipolymath/ai package"
read_when:
  - You want to reuse Omnipolymath's model transports in another application
  - You are changing packages/ai or the AI transport host ports
  - You are reviewing what the omnipolymath release publishes to npm besides the root package
---

`@omnipolymath/ai` is the publishable library form of Omnipolymath's model execution
layer: provider-neutral message/tool/stream contracts, validation, diagnostics,
event streams, an isolated runtime registry, and lazy adapters for the eight
built-in API families (Anthropic Messages, OpenAI Completions, OpenAI
Responses, Azure OpenAI Responses, ChatGPT/Codex Responses, Google Generative
AI, Google Vertex, Mistral Conversations).

It publishes alongside the root `omnipolymath` package on every release, pinned to
the same version. Its exact-pinned direct dependencies resolve at install time;
the package ships no npm lockfile. Installing `omnipolymath` installs the matching
`@omnipolymath/ai` automatically, and library consumers can depend on it directly
without any Omnipolymath application code.

## Quick start

```js
import { createLlmRuntime } from "@omnipolymath/ai";
import { registerBuiltInApiProviders } from "@omnipolymath/ai/providers";

const runtime = createLlmRuntime();
registerBuiltInApiProviders(runtime.registry);

// `model` (a model descriptor), `messages`, and `apiKey` are supplied by you;
// see `examples/ai-chat` for concrete values.
const stream = runtime.streamSimple(model, { messages }, { apiKey });
for await (const event of stream) {
  if (event.type === "text_delta") process.stdout.write(event.delta);
}
const result = await stream.result();
```

A runnable version lives in the repository at `examples/ai-chat`.

## Design contract

- **Instance-scoped by default.** Importing the package registers nothing
  globally. `createApiRegistry()` / `createLlmRuntime()` return isolated
  instances; `registerBuiltInApiProviders(registry)` opts one registry into the
  built-in transports. Provider SDK modules load lazily on first use.
- **Host policy is injected, not bundled.** Request fetch guarding (for
  example SSRF policy), credential masking for diagnostics, OpenAI
  strict-tool defaults, and diagnostics logging are `AiTransportHost` ports
  configured with `configureAiTransportHost`. The library defaults are inert;
  Omnipolymath installs its real implementations in its stream facade.
- **One event-stream identity.** `@omnipolymath/ai/event-stream` is the shared
  `EventStream` constructor shared by Omnipolymath core, agent-core, and external
  consumers.
- **`internal/*` subpaths are not API.** They exist for the Omnipolymath
  application itself and carry no semver guarantee.
- Provider ids, credentials, model catalogs, retries, and failover remain
  application concerns. Omnipolymath layers those around this package; a library
  consumer supplies a `Model` object and options directly.

## Subpath exports

| Subpath          | Contents                                                                       |
| ---------------- | ------------------------------------------------------------------------------ |
| `.`              | Contracts, `createApiRegistry`, `createLlmRuntime`, `configureAiTransportHost` |
| `./providers`    | `registerBuiltInApiProviders`, `resetApiProviders`                             |
| `./types`        | Model/message/tool/stream types                                                |
| `./validation`   | Tool argument validation                                                       |
| `./diagnostics`  | Diagnostics contracts, transport logging, and sanitized URL formatting         |
| `./event-stream` | Shared `EventStream` implementation                                            |
| `./internal/*`   | Omnipolymath-internal, no semver guarantee                                     |

Use `@omnipolymath/ai/diagnostics` for `emitModelTransportDebug`,
`formatModelTransportDebugUrl`, and `formatModelTransportDebugBaseUrl` when
you only need logging helpers. This entrypoint keeps provider transport
implementations out of the import graph.
