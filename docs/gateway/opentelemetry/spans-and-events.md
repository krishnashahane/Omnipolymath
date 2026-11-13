---
summary: "The exported span catalog with its attributes, and the diagnostic event catalog behind the metrics and spans"
title: "Exported spans and diagnostic events"
sidebarTitle: "Spans and events"
read_when:
  - You need the exact span names or attribute shapes to build dashboards or alerts
  - You are subscribing a plugin to public diagnostic events
  - You need session-correlated usage that the exported metrics intentionally omit
---

## Exported spans

- `omnipolymath.gateway.rpc.response`, `omnipolymath.gateway.rpc.handler`, `omnipolymath.gateway.rpc.dispatch`
  - Completed phase observations with `omnipolymath.gateway.rpc.method`, `omnipolymath.gateway.rpc.phase`, and `omnipolymath.gateway.rpc.outcome`
  - Handler spans include `omnipolymath.gateway.rpc.admission_ms`; dispatch spans include `omnipolymath.gateway.rpc.response`, the response state at dispatch settlement
  - Preserve a supplied upstream request parent; they do not introduce a long-lived RPC parent span or change downstream trace propagation

- `omnipolymath.model.usage`
  - `omnipolymath.channel`, `omnipolymath.provider`, `omnipolymath.model`, optional `omnipolymath.agent` (the agent that owns the run when known)
  - Optional host-derived `omnipolymath.plugin` only for trusted plugin runtime completions
  - `omnipolymath.tokens.*` (input/output/cache_read/cache_write/total)
  - `gen_ai.system` by default, or `gen_ai.provider.name` when the latest GenAI semantic conventions are opted in
  - `gen_ai.request.model`, `gen_ai.operation.name`, `gen_ai.usage.*`

Plugin attribution is span-only. It does not add a plugin dimension to shared
OpenTelemetry metrics or change Prometheus metric labels.

Embedded and simple model requests compute prompt component sizes only when a
diagnostic subscriber requests them. Activity tracking, the stability recorder,
Prometheus, and metrics-only OpenTelemetry do not request these sizes. Tracing
retains the same pre-provider JSON character counts; these are distinct from the
encoded request's UTF-8 byte count. Internal diagnostic subscribers can set
`includePromptStats: false` in their event filter to avoid requesting this work.
Omitting the option preserves prompt statistics for interested subscribers.

- `omnipolymath.run`
  - `omnipolymath.outcome`, `omnipolymath.channel`, `omnipolymath.provider`, `omnipolymath.model`, `omnipolymath.errorCategory`, optional `omnipolymath.agent`
- `omnipolymath.model.call`
  - `gen_ai.system` by default, or `gen_ai.provider.name` when the latest GenAI semantic conventions are opted in
  - `gen_ai.request.model`, `gen_ai.operation.name`, `omnipolymath.provider`, `omnipolymath.model`, `omnipolymath.api`, `omnipolymath.transport`, `omnipolymath.model_call.observation_unit` (`request` or `turn`), optional `omnipolymath.agent`
  - `gen_ai.response.model` on terminal request spans (completed and error) when the provider reported the model that actually served the request — e.g. routed OpenRouter presets, `openrouter/auto`, or alias models. `gen_ai.request.model` and `omnipolymath.model` keep the requested id; the response model is observed from the terminal message, omitted when absent, and never attached to aggregate usage or turn spans, used for Omnipolymath pricing, or exported as a metric label (unbounded cardinality). `model.call.started` is emitted before the provider responds and never carries it.
  - `omnipolymath.errorCategory`, `error.type`, and optional `omnipolymath.failureKind` on errors
  - `omnipolymath.model_call.request_bytes`, `omnipolymath.model_call.response_bytes`, `omnipolymath.model_call.time_to_first_byte_ms`
  - `omnipolymath.model_call.prompt.input_messages_count`, `omnipolymath.model_call.prompt.input_messages_chars`, `omnipolymath.model_call.prompt.system_prompt_chars`, `omnipolymath.model_call.prompt.tool_definitions_count`, `omnipolymath.model_call.prompt.tool_definitions_chars`, `omnipolymath.model_call.prompt.total_chars` (safe component sizes only, no prompt text)
  - `omnipolymath.model_call.usage.*` and `gen_ai.usage.*` when the result carries usage for that request or aggregate turn
  - Cache-write totals remain in `omnipolymath.model_call.usage.cache_creation_input_tokens` and `gen_ai.usage.cache_creation.input_tokens`. When reported, `omnipolymath.model_call.usage.cache_creation_input_tokens_1h` and `omnipolymath.model_call.usage.cache_creation_input_tokens_5m` carry the provider’s TTL buckets verbatim, including zero; unreported buckets stay absent. TTL subsets are Omnipolymath-specific so generic usage consumers do not price both the total and its breakdown.
  - Span event `omnipolymath.provider.request` with attribute `omnipolymath.upstreamRequestIdHash` (bounded, hash-based) when the upstream provider result exposes a request id; raw ids are never exported
  - Codex turn span event `omnipolymath.model.response.observed` with `omnipolymath.upstreamRequestIdHash`, `omnipolymath.model_response.timestamp_source = receipt`, `omnipolymath.model_response.usage_source = native-normalized`, `omnipolymath.model_response.usage_scope = response`, and known `omnipolymath.model_call.usage.*` / `gen_ai.usage.*` fields. It records an untimed native response observation and does not increment usage metrics.
  - With `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`, request spans use the latest GenAI inference span name `{gen_ai.operation.name} {gen_ai.request.model}`. Turn spans use `invoke_agent` because Omnipolymath does not claim a native agent name from the opaque CLI boundary. Both use `CLIENT` span kind instead of `omnipolymath.model.call`.
- `omnipolymath.harness.run`
  - `omnipolymath.harness.id`, `omnipolymath.harness.plugin`, `omnipolymath.outcome`, `omnipolymath.provider`, `omnipolymath.model`, `omnipolymath.channel`, optional `omnipolymath.agent`
  - On completion: `omnipolymath.harness.result_classification`, `omnipolymath.harness.yield_detected`, `omnipolymath.harness.items.started`, `omnipolymath.harness.items.completed`, `omnipolymath.harness.items.active`
  - On error: `omnipolymath.harness.phase`, `omnipolymath.errorCategory`, optional `omnipolymath.harness.cleanup_failed`
  - Span event `omnipolymath.agent.commentary` for completed preambles from supported harnesses, including the built-in runtime, Codex, and Claude CLI. Attributes include `omnipolymath.commentary.sequence`, `omnipolymath.commentary.text_length`, and `omnipolymath.commentary.content_truncated`. The existing `diagnostics.otel.captureContent` setting controls bounded, redacted output-message content.
  - With `captureContent: true`: bounded, redacted `input.value` on start and `output.value` (the runtime's final message text) on completion. For the Claude CLI backend, `input.value` is the exact composed prompt the CLI received, after history reseeding, plugin input text transforms, and prompt context; the Codex harness records the turn prompt Omnipolymath handed it. The Gemini CLI backend publishes captured content on `omnipolymath.message.processed` (inbound message and the model's final response); it does not record its composed CLI prompt on these run-level spans.
- `omnipolymath.tool.execution`
  - `gen_ai.tool.name`, `gen_ai.operation.name` (`execute_tool`), `omnipolymath.toolName`, `omnipolymath.tool.source`, optional `gen_ai.tool.call.id`, `omnipolymath.tool.owner`, `omnipolymath.tool.params.*`, optional `omnipolymath.agent`
  - Optional `omnipolymath.errorCategory`/`omnipolymath.errorCode` on errors, `omnipolymath.deniedReason` and `omnipolymath.outcome=blocked` when denied by policy or sandbox
- `omnipolymath.skill.used`
  - `omnipolymath.skill.name`, `omnipolymath.skill.source`, `omnipolymath.skill.activation`, optional `omnipolymath.agent` and `omnipolymath.toolName`
  - Optional `omnipolymath.skill.fingerprint`: SHA-256 of the complete instruction body actually delivered by `read` or `skills_read`. Cached reads reuse the delivered identity; unread support files and discovery results do not contribute. The fingerprint is omitted when no traced instruction delivery is known and never labels metrics.
- `omnipolymath.exec`
  - `omnipolymath.exec.target`, `omnipolymath.exec.mode`, `omnipolymath.outcome`, `omnipolymath.failureKind`, `omnipolymath.exec.command_length`, `omnipolymath.exec.exit_code`, `omnipolymath.exec.exit_signal`, `omnipolymath.exec.timed_out`
- `omnipolymath.webhook.processed`
  - `omnipolymath.channel`, `omnipolymath.webhook`
- `omnipolymath.webhook.error`
  - `omnipolymath.channel`, `omnipolymath.webhook`, `omnipolymath.error`
- `omnipolymath.message.processed`
  - `omnipolymath.channel`, `omnipolymath.outcome`, `omnipolymath.reason`, optional `omnipolymath.agent` (the agent that initially ingested the prompt)
  - Isolated cron agent turns use this span as the parent of their harness spans, keeping model calls, tools, and usage on the same trace through completion or failure.
  - With `captureContent: true`: bounded, redacted `input.value` (inbound message text) and `output.value` (the model's own response text; hook replies and host notices are never captured)
- `omnipolymath.message.delivery`
  - `omnipolymath.channel`, `omnipolymath.delivery.kind`, `omnipolymath.outcome`, `omnipolymath.errorCategory`, `omnipolymath.delivery.result_count`
- `omnipolymath.session.stuck`
  - `omnipolymath.state`, `omnipolymath.ageMs`, `omnipolymath.queueDepth`
- `omnipolymath.context.assembled`
  - `omnipolymath.prompt.size`, `omnipolymath.history.size`, `omnipolymath.context.tokens`, `omnipolymath.errorCategory` (no prompt, history, or response content; session identity only with `captureContent: true`, see [Session identity](/gateway/opentelemetry/privacy-and-trace-context#session-identity))
- `omnipolymath.tool.loop`
  - `omnipolymath.toolName`, `omnipolymath.loop.level`, `omnipolymath.loop.action`, `omnipolymath.loop.detector`, `omnipolymath.loop.count`, optional `omnipolymath.loop.paired_tool`, optional `omnipolymath.agent` (no loop messages, params, or tool output)
- `omnipolymath.memory.pressure`
  - `omnipolymath.memory.level`, `omnipolymath.memory.reason`, `omnipolymath.memory.rss_bytes`, `omnipolymath.memory.heap_used_bytes`, `omnipolymath.memory.heap_total_bytes`, `omnipolymath.memory.external_bytes`, `omnipolymath.memory.array_buffers_bytes`, optional `omnipolymath.memory.threshold_bytes`/`omnipolymath.memory.rss_growth_bytes`/`omnipolymath.memory.window_ms`

Run-scoped spans (run, message and prompt processing, model call, model usage,
harness, tool execution, and skill use) additionally carry
`gen_ai.conversation.id` and `omnipolymath.session.id` — the session id, so trace
backends group every turn of a session into one conversation — but only
while `diagnostics.otel.captureContent` is `true`; the attributes are absent
by default and never label metrics. The value is the session id, not the
session key: a `/new` reset clears history but preserves the durable session
id, so reset continuations stay grouped in the same backend conversation, and
a fresh id arises when a session is first created. The raw key (which can
embed channel peer ids) is
never exported. See
[privacy and trace context](/gateway/opentelemetry/privacy-and-trace-context#session-identity).

When content capture is explicitly enabled, model and tool spans can also
include bounded, redacted `omnipolymath.content.*` attributes for the specific
content classes you opted into.

`omnipolymath.message.processed` and `omnipolymath.harness.run` spans follow the same
existing `captureContent` setting. When it is `true`, `input.value` and
`output.value` carry the inbound message or turn prompt and the model's final
response text, bounded to 128 KiB (131072 UTF-16
code units) per field and redacted through the same sensitive-text filter as
other exported content. `output.value` records what the LLM actually responded
with — the model's own final response, before delivery filtering — so sentinel
replies such as `NO_REPLY` appear verbatim; this is LLM-observability data, not
a delivery record. Only the text of the model's last message counts. Text the
model passed to the `message` tool is an argument to a tool call, not its final
message, so tool-only turns record the model's closing message (usually
`NO_REPLY`) or nothing; the sent text is on the child `omnipolymath.model.call`
output messages and, for the built-in runtime, the `omnipolymath.tool.execution`
span (`gen_ai.tool.call.arguments`). CLI backends do not export tool arguments,
so their message-tool text is not captured on any span. Earlier narration in
the turn ("Checking now…") is never reported as the final response: a message
that ended in a tool call is not final, and CLI turns record only the final
message, never the cumulative reply text. Text the
model did not write is never captured, even when it was delivered to the chat:
plugin hook replies (`before_dispatch`, `before_agent_reply`), no-visible-reply
fallbacks, continuation statuses, failure texts, and Gateway restart notices.
Turns where no model produced text carry no `output.value`.
The captured content is routed as private listener-only payload data to
trusted diagnostics exporters only; it never appears on public event
payloads.

**Upgrade note:** if you already run with `diagnostics.otel.captureContent:
true`, these message and run span attributes are new — your existing setting
now also exports this prompt and reply content with no further configuration
change, and stamps `gen_ai.conversation.id` / `omnipolymath.session.id` (the session
id) on run-scoped spans. Nothing new is exported while `captureContent` is
unset or `false`.

## Diagnostic event catalog

The events below back the
[metrics](/gateway/opentelemetry/model-calls-and-metrics#exported-metrics) and
spans above. Public events are also
available for direct plugin subscription; trusted core events such as
`model.usage` are restricted to authorized internal consumers.
`run.progress` and `run.execution_phase` are direct-only lifecycle signals;
the diagnostics-otel plugin does not export them as standalone OTLP signals.
Event kinds and `run.execution_phase.phase` values are additive. TypeScript
consumers should keep default branches instead of assuming either union is
permanently exhaustive.

Events with no interested subscriber or tracing exporter are discarded before
payload enrichment and queuing; they are not buffered for future subscribers.
Queued events capture their payloads when emitted, so later producer changes do
not change delivery. Listeners share immutable plain-data snapshots; opaque
values such as maps and typed arrays retain separate listener copies.

`agent.commentary` records completed preambles, not text deltas. It carries the
original agent-event sequence and timestamp and attaches to the active harness
span. Recent duplicate completions are suppressed per attempt. Like other
queued diagnostics, commentary may be dropped under queue pressure; the session
transcript remains the durable conversation record. At debug level, the
`diagnostic` logger also records completion metadata without commentary text.

**Model usage**

`model.usage` is a trusted, in-process diagnostic event, not a JSONL log
record. A representative event has this shape:

```json
{
  "type": "model.usage",
  "ts": 1735689600000,
  "seq": 42,
  "provider": "openai",
  "model": "gpt-5.4",
  "channel": "webchat",
  "agentId": "main",
  "sessionId": "session-123",
  "sessionKey": "agent:main:main",
  "usage": {
    "input": 120,
    "output": 40,
    "cacheRead": 30,
    "cacheWrite": 10,
    "promptTokens": 160,
    "total": 200
  },
  "lastCallUsage": {
    "input": 120,
    "output": 40,
    "cacheRead": 30,
    "cacheWrite": 10,
    "total": 200
  },
  "context": { "limit": 128000, "used": 160 },
  "costUsd": 0.0012,
  "durationMs": 850,
  "trace": {
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
    "spanId": "00f067aa0ba902b7",
    "traceFlags": "01"
  }
}
```

- `ts` is a Unix timestamp in milliseconds; `seq` is process-local.
- `usage` holds turn-level token counts. `promptTokens` includes `input`,
  `cacheRead`, and `cacheWrite`; `lastCallUsage`, when available, describes the
  final model call.
- `context.used` is the current prompt/context snapshot and can be lower than
  `usage.total` when cached input or tool-loop calls are involved.
- Provider/model/session identifiers, token buckets, `lastCallUsage`,
  `context`, `costUsd`, `durationMs`, and `trace` fields are optional.
  `costUsd` is an estimate and can be absent when model pricing is unavailable;
  it is not provider-reported billing. Trace context can also include
  `parentSpanId`.

The Gateway's `/tmp/omnipolymath/omnipolymath-YYYY-MM-DD.log` JSONL file and
`diagnostics.otel.logsExporter: "stdout"` contain ordinary log records, not raw
`model.usage` events. Public diagnostic subscriptions and
`diagnostics.stability` do not expose trusted core usage events. The
diagnostics-otel plugin converts them to metrics such as `omnipolymath.tokens` and
`omnipolymath.cost.usd` and to `omnipolymath.model.usage` spans; those usage metrics
intentionally omit session identifiers, and the spans omit them unless
`diagnostics.otel.captureContent` is `true` (see
[Session identity](/gateway/opentelemetry/privacy-and-trace-context#session-identity)).

Completed memory-flush and Skill Workshop review inference records its own usage
and available cost estimate. These internal runs do not add their usage to the
foreground conversation's totals.

For an external integration that needs session-correlated usage, query the
authenticated Gateway instead:

```bash
omnipolymath gateway call sessions.usage --params '{"range":"30d","agentScope":"all"}' --json
omnipolymath gateway usage-cost --days 30 --all-agents --json
```

Both commands require `operator.read`. `sessions.usage` can include per-session
`sessionId`, provider/model details, and token/cost summaries; per-session usage
can be temporarily `null` while its cache refreshes. `usage-cost` provides
aggregate estimates. Omit `agentScope` or `--all-agents` to scope the report
to the default agent. For continuously updated clients,
[subscribe to session changes instead of polling usage reports](/gateway/clients#subscribe-instead-of-polling-usage).
See the [Gateway RPC method reference](/gateway/protocol/rpc-methods#rpc-method-families)
for usage methods and request options.

**Message flow**

- `webhook.received` / `webhook.processed` / `webhook.error`
- `message.queued` / `message.processed`
- `message.delivery.started` / `message.delivery.completed` / `message.delivery.error`

**Gateway RPC**

- `gateway.rpc` - trusted request observations with phases `received`, `response`,
  `handler`, and `dispatch`. Response outcomes are `ok`, `error`, `unavailable`,
  or `suppressed`; handler outcomes are `returned` or `threw`; dispatch outcomes
  are `returned`, `threw`, `rejected`, or `cancelled`. Dispatch records its response
  state (`none`, `sent`, `unavailable`, or `suppressed`) at settlement; a later
  response can still arrive. Durations and queue/admission semantics are described
  in [Gateway RPC metrics](/gateway/opentelemetry#gateway-rpc).

**Queue and session**

- `queue.lane.enqueue` / `queue.lane.dequeue`
- `session.state` / `session.long_running` / `session.stalled` / `session.stuck`
- `run.attempt` / `run.progress`
- `run.execution_phase` (public, session-correlated embedded-runner startup milestones)
- `diagnostic.heartbeat` (aggregate counters: webhooks/queue/session)
- `gateway.event_loop.sample` (internal metrics-only completed window: `intervalMs`, `delayMaxMs`; no reader identity)

**Harness lifecycle**

- `harness.run.started` / `harness.run.completed` / `harness.run.error` -
  per-run lifecycle for the agent harness. Includes `harnessId`, optional
  `pluginId`, provider/model/channel, and run id. Completion adds
  `durationMs`, `outcome`, optional `resultClassification`, `yieldDetected`,
  and `itemLifecycle` counts. Errors add `phase`
  (`prepare`/`start`/`send`/`resolve`/`cleanup`), `errorCategory`, and
  optional `cleanupFailed`. With `captureContent: true`, started and completed
  events also carry bounded, redacted turn prompt and final assistant text
  as private listener-only data exported on spans, never on public payloads.

**Exec**

- `exec.process.completed` - terminal outcome, duration, target, mode, exit
  code, and failure kind. Command text and working directories are not
  included.
- `exec.approval.followup_suppressed` - stale approval follow-up dropped
  after a session rebound. Includes `approvalId`, `reason`
  (`session_rebound`), `phase` (`direct_delivery` or `gateway_preflight`),
  and the dispatcher timestamp. Session keys, routes, and command text are
  not included.
