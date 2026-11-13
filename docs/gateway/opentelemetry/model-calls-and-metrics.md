---
summary: "What a model-call span measures, Claude Code CLI turn fidelity, and the full exported metric catalog"
title: "Model calls and exported metrics"
sidebarTitle: "Metrics"
read_when:
  - You need the exact metric names and attribute shapes to build dashboards or alerts
  - You are comparing request-level and turn-level model-call observations
  - You are reading Claude Code CLI byte, timing, or usage numbers
---

## Model-call observation units

Every `omnipolymath.model.call` span identifies what its lifecycle measures through
`omnipolymath.model_call.observation_unit`:

- `request` - one observable model/provider request. Native embedded model
  calls use this unit, and exporters treat a missing value as `request` for
  compatibility with older or external emitters.
- `turn` - one opaque agent CLI turn that may contain hidden model requests,
  retries, tool work, or background work. Claude Code CLI and Codex app-server
  calls use this unit.

Both units remain model-call spans so trace backends can render model input,
output, usage, and hierarchy. Request spans use the API-derived GenAI operation
(`chat`, `generate_content`, or `text_completion`), while turn spans use
`gen_ai.operation.name = invoke_agent`. Both contribute to
`gen_ai.client.operation.duration`, where the operation name keeps direct
request latency separate from full-turn latency. Omnipolymath's OTEL model-call
metrics also include `omnipolymath.model_call.observation_unit`; the Prometheus
model-call metrics expose the equivalent `observation_unit` label.

Request-level telemetry also covers native background completions, including
session titles, Activity recaps, and plugin `runtime.llm.complete` calls.
Each request records a start and one completion or error with its duration;
token and cost accounting remains separate in `model.usage`.

Codex app-server turns also emit one `model.response.observed` diagnostic for
each distinct provider response received during the turn. OpenTelemetry records
it as an `omnipolymath.model.response.observed` event on the turn's model-call span,
with a hashed response identifier and token fields reported by the native
runtime (`usage_source = native-normalized`, `usage_scope = response`).
Its timestamp records receipt by Omnipolymath, not provider completion. Missing
usage stays absent, including cache-write counts or totals omitted by the native
runtime. Uncached input is derived only when every cache component was reported;
prompt tokens use the native input count. No request duration or tool-to-response relationship is
inferred. These events do not add token or duration metrics. Aggregate accounting
continues to use `model.usage`; dropped diagnostic events or missing provider
usage can leave the response observations incomplete.

## Claude Code CLI model-call fidelity

Claude Code CLI turns emit one synthetic, turn-level `omnipolymath.model.call`
span. These are not Anthropic HTTP request spans. They use `omnipolymath.api =
claude-code`, `omnipolymath.model_call.observation_unit = turn`, and identify
the operation as `gen_ai.operation.name = invoke_agent`. They identify
Omnipolymath's CLI boundary through
`omnipolymath.transport`:

- `stdio` - one-shot local Claude Code process.
- `stdio-live` - one turn on a managed persistent Claude stdio session.
- `paired-node-cli` - one-shot Claude Code execution delegated to a paired
  node.

Claude CLI diagnostics are instantiated only while the process diagnostic
dispatcher is enabled and an internal or trusted event listener is attached.
With no observability plugin or other listener active, Claude CLI turns skip
the synthetic trace hierarchy, content buffers, and diagnostic stream-byte
accounting. When content capture is enabled, prompt and system-prompt fields
are capped at 128 KiB each; assistant output is capped at 128 KiB across at
most 200 envelopes, with 16 KiB and one item reserved for a final visible
fallback response. A marker records truncation when the limit is reached.

Omnipolymath gives Claude CLI turns the same ownership hierarchy used by other
agent runtimes: `omnipolymath.harness.run` (`omnipolymath.harness.id = claude-cli`)
contains `omnipolymath.run`, which contains the Claude `omnipolymath.model.call`
span. The harness and run spans are synthetic Omnipolymath turn boundaries, not
Claude Code internal phases. One-shot and managed stdio turns use the same
hierarchy; a real fresh-session retry creates another model-call child inside
the same Omnipolymath run.

The span starts when Omnipolymath admits the prepared CLI turn and ends only after
that turn succeeds or fails. For managed sessions, an interim success result
does not end the span while Claude reports result-holding background agents or
workflows; the final post-drain result does. Abort, timeout, process failure,
output/parse failure, and other turn failures end the same span with an error.

Claude Code reports per-assistant-message usage and may also report cumulative
usage on its terminal result. Omnipolymath reply accounting continues to use the
last assistant message so existing cost semantics do not change; the
turn-level model-call span uses terminal cumulative usage when available,
including cache-read and cache-creation tokens.

For these CLI spans, byte and timing fields describe the observable Omnipolymath
CLI boundary:

- `omnipolymath.model_call.request_bytes` is the UTF-8 size of the prompt value
  sent over one-shot stdin/argv, or the managed stdio JSONL user envelope. It
  is not the size of Claude Code's hidden model request.
- `omnipolymath.model_call.response_bytes` is the UTF-8 size of Claude CLI stdout
  observed during the turn. It is not Anthropic HTTP response size.
- `omnipolymath.model_call.time_to_first_byte_ms` is time to the first observable
  Claude CLI stdout or stderr output. It is not network TTFB.

With `captureContent` enabled, the span exports the effective prompt Omnipolymath
sends to Claude Code and visible assistant text/tool-call identity
through `gen_ai.input.messages` and `gen_ai.output.messages`. Tool arguments,
internal thinking, opaque thinking signatures, tool results, and system prompts
are omitted from the Claude assistant envelope. Omnipolymath does not
claim access to Claude Code's private system prompt, hidden resumed or
compacted request payload, native internal tool schemas, raw Anthropic HTTP
request, internal retries, upstream request id, or true network TTFB. Because
Claude Code does not expose its effective native tool definitions accurately,
these spans do not populate `gen_ai.tool.definitions`.

External Claude harness tool spans remain metadata-only even when tool content
capture is enabled. As with every model span, captured Claude CLI content uses
the trusted listener-only path and the exporter's existing redaction and size
bounds; content remains off by default.

## Exported metrics

### Gateway RPC

Authenticated Gateway WebSocket requests, including dedicated worker RPCs, emit these metrics while diagnostics
and an interested exporter are enabled. They exclude the connection handshake,
malformed request frames, and HTTP routes.

| Metric                                       | Type      | Measurement                                                       |
| -------------------------------------------- | --------- | ----------------------------------------------------------------- |
| `omnipolymath.gateway.rpc.requests`          | counter   | Valid requests received, including requests subsequently rejected |
| `omnipolymath.gateway.rpc.first_response_ms` | histogram | Receipt through the first successfully sent response              |
| `omnipolymath.gateway.rpc.handler_ms`        | histogram | Actual handler invocation through return or throw                 |
| `omnipolymath.gateway.rpc.admission_ms`      | histogram | Receipt through actual handler invocation                         |
| `omnipolymath.gateway.rpc.queue_wait_ms`     | histogram | Operator start-queue or worker frame-queue wait, when applicable  |
| `omnipolymath.gateway.rpc.outcomes`          | counter   | Observations by phase and outcome                                 |

Request and timing metrics have only `omnipolymath.gateway.rpc.method`: an exact
core, worker, or registered plugin method name, `other` for unregistered generic
requests, or `unknown` for unrecognized dedicated worker RPCs. Outcome metrics have
only `omnipolymath.gateway.rpc.phase` and `omnipolymath.gateway.rpc.outcome`, so errors do
not multiply every method's series. No request, connection, session, or trace IDs
appear in metric attributes.

Operator admission includes authorization, lazy router and handler loading, and
start-queue wait. Worker admission includes the socket FIFO wait and outer frame
validation. Worker handler duration includes method validation and service invocation.
Worker timing starts at the JavaScript socket callback, excluding network delay
and event-loop delay before that callback. Queue wait is a subset of admission
for handlers that start, separate from command/session lane `omnipolymath.queue.wait_ms`.
Handler and admission samples exist only for invoked handlers. Queue wait is
recorded when dispatch settles.

Worker inference-start timing measures acceptance and setup, not provider completion.
Long worker computer and session operations retain their handler timing after
releasing the socket FIFO. Worker dispatch outcomes describe return or throw.
Connection closure can suppress a response after successful execution and does
not by itself prove execution cancellation.

A sent response means the WebSocket sender accepted the frame, not that the
client received it. Early acknowledgments count as the first response; later
responses do not add another sample. Unavailable or suppressed sends contribute
outcomes but no first-response sample. A handler may return before a retained
callback sends its response, and detached agent work can continue afterward.
These durations measure elapsed time, including asynchronous waits, rather than
CPU time or event-loop blocking time.

Observations use the bounded diagnostic queue. Check
`omnipolymath.diagnostic.async_queue.dropped` before treating counts or latency
distributions as complete during saturation.

### Session-list retention

Session-list retention also exports three gauges with no attributes:
`omnipolymath.sessions.list.retained_views`, `omnipolymath.sessions.list.retained_refs`,
and `omnipolymath.sessions.list.retained_bytes`. They report process-wide totals
across live projections. Counters update when views are inserted, changed, evicted,
or retired; gauge reports coalesce to the final values once per event-loop turn.
References include row/history references and cached selection/partition
entries. Bytes estimate eight bytes per row reference, 48 per selection entry,
1 KiB per view, UTF-16 query keys, and small array/partition overhead. Shared row
objects and encodings are excluded; this is a retention budget estimate, not V8
heap attribution. Each projection retains at most 512 slots and 32 MiB estimated
bytes, and disposal clears its contribution. Prometheus exposes these names
with underscores in place of dots.

### Gateway WebSocket events

| Metric                                         | Type    | Measurement                                                    |
| ---------------------------------------------- | ------- | -------------------------------------------------------------- |
| `omnipolymath.gateway.ws.events`               | counter | Outbound event frames accepted by the sender, once per socket  |
| `omnipolymath.gateway.ws.event_bytes`          | counter | Encoded UTF-8 bytes of those full JSON frames, once per socket |
| `omnipolymath.gateway.ws.event_wire_bytes`     | counter | Post-codec payload bytes handed to each socket                 |
| `omnipolymath.gateway.ws.event_frame_bytes`    | counter | Cumulative accepted raw frame counts by byte-size upper bound  |
| `omnipolymath.gateway.ws.operator_connections` | gauge   | Connected authenticated operator sockets                       |

The traffic counters have `omnipolymath.gateway.ws.event`: a known protocol event name,
or `other` for an unrecognized name. The connection gauge has no attributes; it
updates on connect/disconnect and refreshes every 30 seconds to recover dropped
snapshots or initialize late-starting exporters.
Event observations are batched by event name within one event-loop turn; fan-out
still counts each socket separately. Raw bytes exclude framing and compression;
wire bytes use the deflated payload length when compressed and raw length
otherwise. Wire bytes exclude WebSocket, TLS, and TCP headers. Compression
completion can follow raw-frame acceptance; direct local delivery contributes
its raw payload size. Observations without a wire size do not fabricate a
wire-byte measurement. Send acceptance does not prove client receipt. No event payload,
session, user, or connection identifiers are exported. These metrics use the
same bounded diagnostic queue as Gateway RPC observations; check
`omnipolymath.diagnostic.async_queue.dropped` when interpreting traffic totals.

`omnipolymath.gateway.ws.event_frame_bytes` has unit `1` and also carries `le`, with
byte-size upper bounds `256`, `512`, `1024`, `2048`, `4096`, `8192`, `16384`,
`65536`, and `+Inf`. Counts are cumulative across upper bounds, with each accepted
raw frame counted in every matching bucket. These bounded counters support
p50/p90 frame-size estimates; they are not individual byte observations.

`omnipolymath.gateway.ws.presence_frames` (counter, unit `1`) and
`omnipolymath.gateway.ws.presence_bytes` (counter, unit `By`) split presence traffic
by `omnipolymath.gateway.ws.mode`: `delta`, `reset` (full snapshots for capable
clients), or `legacy` (full frames without delta negotiation). They count the
same accepted per-socket frames and encoded bytes as the aggregate counters.

`omnipolymath.gateway.ws.session_event_frames` (counter, unit `1`) and
`omnipolymath.gateway.ws.session_event_bytes` (counter, unit `By`) attribute the same
session event traffic. Their attributes are `omnipolymath.gateway.ws.event`,
`omnipolymath.gateway.ws.reason`, and `omnipolymath.gateway.ws.delivery`, with the value
sets below (shown without the attribute prefix).

The session counters use `event`, `reason`, and `delivery`. `event` is only
`sessions.changed` or `session.message`. For `sessions.changed`, `reason` is the
producer's reason (or lifecycle phase when no reason is present):
`abort`, `activity-summary`, `agent.input.settled`, `agent.run.started`,
`archive`, `board`, `branch-switch`, `chat.dispatch-error`, `chat.title`,
`cleanup`, `compact`, `create`, `cron-continuation`, `delete`, `dispatch`,
`fork`, `github-publication`, `goal`, `groups`, `involvement`, `move`, `new`,
`owner`, `participants`, `patch`, `placement`, `plugin-patch`, `progress-card-reset`,
`project`, `reclaim`, `recovery`, `reset`, `rewind`, `run-capacity`, `send`,
`sharing`, `steer`, `subagent-status`, `swarm-note`, `title`, `unarchive`,
`update`, `updated`, `worker-disk-space`, and `worker-runtime-install`.
Lifecycle phases are `start`, `model`, `end`, `error`, and `message`.
For `session.message`, `reason` is the message role: `user`, `assistant`, `system`,
`developer`, `tool`, or `toolResult`; an absent role uses `message`.
Unknown reasons, phases, and roles use `other`.
`delivery="subscribed"` means the recipient holds an exact
`sessions.messages.subscribe` subscription for that session, including its
producer-resolved alias; all other recipients use `delivery="roster"`.
This describes subscription membership, not whether a tab is visible or a peer
acknowledged receipt. Keyless roster invalidations use `roster`.
The counters reuse the existing encoded byte length without serializing again,
and batch by label set within the same event-loop turn. No message content,
IDs, or session keys enter the labels. Existing event counter labels stay unchanged.

### Model usage

- `omnipolymath.tokens` (counter, attrs: `omnipolymath.token`, `omnipolymath.channel`, `omnipolymath.provider`, `omnipolymath.model`, `omnipolymath.agent`)
- `omnipolymath.cost.usd` (counter, attrs: `omnipolymath.channel`, `omnipolymath.provider`, `omnipolymath.model`)
- `omnipolymath.run.duration_ms` (histogram, attrs: `omnipolymath.channel`, `omnipolymath.provider`, `omnipolymath.model`)
- `omnipolymath.context.tokens` (histogram, attrs: `omnipolymath.context`, `omnipolymath.channel`, `omnipolymath.provider`, `omnipolymath.model`)
- `gen_ai.client.token.usage` (histogram, GenAI semantic-conventions metric, attrs: `gen_ai.token.type` = `input`/`output`, `gen_ai.provider.name`, `gen_ai.operation.name`, `gen_ai.request.model`)
- `gen_ai.client.operation.duration` (histogram, seconds, GenAI semantic-conventions metric for model requests and synthetic agent turns; attrs: `gen_ai.provider.name`, `gen_ai.operation.name`, `gen_ai.request.model`, optional `error.type`; turn observations use `gen_ai.operation.name = invoke_agent`)
- `omnipolymath.model_call.duration_ms` (histogram, attrs: `omnipolymath.provider`, `omnipolymath.model`, `omnipolymath.api`, `omnipolymath.transport`, `omnipolymath.model_call.observation_unit`, plus `omnipolymath.errorCategory` and `omnipolymath.failureKind` on classified errors)
- `omnipolymath.model_call.request_bytes` (histogram, UTF-8 byte size of the final model request payload; for Claude Code CLI, the observable prompt input/envelope described above; no raw payload content)
- `omnipolymath.model_call.response_bytes` (histogram, UTF-8 byte size of streamed response chunk payloads; high-frequency text, thinking, and tool-call deltas count only incremental `delta` bytes; for Claude Code CLI, observed stdout bytes; no raw response content)
- `omnipolymath.model_call.time_to_first_byte_ms` (histogram, elapsed time before the first streamed response event; for Claude Code CLI, first observable CLI output rather than network TTFB)
- `omnipolymath.model.failover` (counter, attrs: `omnipolymath.provider`, `omnipolymath.model`, `omnipolymath.failover.to_provider`, `omnipolymath.failover.to_model`, `omnipolymath.failover.reason`, `omnipolymath.failover.suspended`, `omnipolymath.lane`)
- `omnipolymath.skill.used` (counter, attrs: `omnipolymath.skill.name`, `omnipolymath.skill.source`, `omnipolymath.skill.activation`, optional `omnipolymath.agent`, optional `omnipolymath.toolName`)

### Message flow

- `omnipolymath.webhook.received` (counter, attrs: `omnipolymath.channel`, `omnipolymath.webhook`)
- `omnipolymath.webhook.error` (counter, attrs: `omnipolymath.channel`, `omnipolymath.webhook`)
- `omnipolymath.webhook.duration_ms` (histogram, attrs: `omnipolymath.channel`, `omnipolymath.webhook`)
- `omnipolymath.message.queued` (counter, attrs: `omnipolymath.channel`, `omnipolymath.source`)
- `omnipolymath.message.received` (counter, attrs: `omnipolymath.channel`, `omnipolymath.source`)
- `omnipolymath.message.dispatch.started` (counter, attrs: `omnipolymath.channel`, `omnipolymath.source`)
- `omnipolymath.message.dispatch.completed` (counter, attrs: `omnipolymath.channel`, `omnipolymath.outcome`, `omnipolymath.reason`, `omnipolymath.source`)
- `omnipolymath.message.dispatch.duration_ms` (histogram, attrs: `omnipolymath.channel`, `omnipolymath.outcome`, `omnipolymath.reason`, `omnipolymath.source`)
- `omnipolymath.message.processed` (counter, attrs: `omnipolymath.channel`, `omnipolymath.outcome`)
- `omnipolymath.message.duration_ms` (histogram, attrs: `omnipolymath.channel`, `omnipolymath.outcome`)
- `omnipolymath.message.delivery.started` (counter, attrs: `omnipolymath.channel`, `omnipolymath.delivery.kind`)
- `omnipolymath.message.delivery.duration_ms` (histogram, attrs: `omnipolymath.channel`, `omnipolymath.delivery.kind`, `omnipolymath.outcome`, `omnipolymath.errorCategory`)

### Talk

- `omnipolymath.talk.event` (counter, attrs: `omnipolymath.talk.event_type`, `omnipolymath.talk.mode`, `omnipolymath.talk.transport`, `omnipolymath.talk.brain`, `omnipolymath.talk.provider`)
- `omnipolymath.talk.event.duration_ms` (histogram, attrs: same as `omnipolymath.talk.event`; emitted when a Talk event reports duration)
- `omnipolymath.talk.audio.bytes` (histogram, attrs: same as `omnipolymath.talk.event`; emitted for Talk audio frame events that report byte length)

### Queues and sessions

- `omnipolymath.queue.lane.enqueue` (counter, attrs: `omnipolymath.lane`)
- `omnipolymath.queue.lane.dequeue` (counter, attrs: `omnipolymath.lane`)
- `omnipolymath.queue.depth` (histogram, attrs: `omnipolymath.lane` or `omnipolymath.channel=heartbeat`)
- `omnipolymath.queue.wait_ms` (histogram, attrs: `omnipolymath.lane`)
- `omnipolymath.session.state` (counter, attrs: `omnipolymath.state`, `omnipolymath.reason`)
- `omnipolymath.session.stuck` (counter, attrs: `omnipolymath.state`; emitted for recoverable stale session bookkeeping)
- `omnipolymath.session.stuck_age_ms` (histogram, attrs: `omnipolymath.state`; emitted for recoverable stale session bookkeeping)
- `omnipolymath.session.turn.created` (counter, attrs: `omnipolymath.agent`, `omnipolymath.channel`, `omnipolymath.trigger`)
- `omnipolymath.session.recovery.requested` (counter, attrs: `omnipolymath.state`, `omnipolymath.action`, `omnipolymath.active_work_kind`, `omnipolymath.reason`)
- `omnipolymath.session.recovery.completed` (counter, attrs: `omnipolymath.state`, `omnipolymath.action`, `omnipolymath.status`, `omnipolymath.active_work_kind`, `omnipolymath.reason`)
- `omnipolymath.session.recovery.age_ms` (histogram, attrs: same as the matching recovery counter)
- `omnipolymath.run.attempt` (counter, attrs: `omnipolymath.attempt`)

### Session liveness telemetry

A `processing` session does not age toward the built-in liveness threshold while Omnipolymath observes reply, tool, status, block, or ACP runtime progress. Typing keepalives do not count as progress, so a silent model or harness can still be detected.

Omnipolymath classifies sessions by the work it can still observe:

- `session.long_running`: active embedded work, model calls, or tool calls
  are still making progress. Owned silent model calls also report as long-running before the built-in abort threshold, so slow or non-streaming model providers do not look like stalled gateway sessions while abort-observable.
- `session.stalled`: active work exists, but the active run has not reported
  recent progress. Owned model calls switch from `session.long_running` to
  `session.stalled` at or after the built-in abort threshold; ownerless
  stale model/tool activity is not treated as harmless long-running work.
  Stalled embedded runs stay observe-only at first, then abort-drain after
  the abort threshold with no progress so queued turns behind the lane can resume.
- `session.stuck`: stale session bookkeeping with no active work, or an idle
  queued session with stale ownerless model/tool activity. This releases the
  affected session lane immediately after recovery gates pass.

Recovery emits structured `session.recovery.requested` and
`session.recovery.completed` events. Diagnostic session state is marked idle
only after a mutating recovery outcome (`aborted` or `released`) and only if
the same processing generation is still current.

Only `session.stuck` emits the `omnipolymath.session.stuck` counter, the
`omnipolymath.session.stuck_age_ms` histogram, and the `omnipolymath.session.stuck`
span. Repeated `session.stuck` diagnostics back off while the session remains
unchanged, so dashboards should alert on sustained increases rather than
every heartbeat tick. For the config knob and defaults, see
[Configuration reference](/gateway/config-observability#diagnostics).

Liveness warnings also emit:

- `omnipolymath.liveness.warning` (counter, attrs: `omnipolymath.liveness.reason`)
- `omnipolymath.liveness.event_loop_delay_p99_ms` (histogram, attrs: `omnipolymath.liveness.reason`)
- `omnipolymath.liveness.event_loop_delay_max_ms` (histogram, attrs: `omnipolymath.liveness.reason`)
- `omnipolymath.liveness.event_loop_utilization` (histogram, attrs: `omnipolymath.liveness.reason`)
- `omnipolymath.liveness.cpu_core_ratio` (histogram, attrs: `omnipolymath.liveness.reason`)

The CPU ratio measures whole-process CPU usage in core equivalents, including
worker and native threads, and can exceed `1`. Event-loop delay and utilization
measure the main thread separately. See
[CPU pressure and event-loop delay](/gateway/health#cpu-pressure-and-event-loop-delay).

### Gateway event-loop observation windows

- `omnipolymath.gateway.event_loop.delay_max_ms` (histogram, no attrs; maximum delay per completed health-monitor window)
- `omnipolymath.gateway.event_loop.observed_ms` (counter, no attrs; elapsed milliseconds represented by completed windows)

These metrics use the existing diagnostics plugin setup and require metrics to
be active. Each accepted health-monitor window is recorded once, so a later
healthy readiness result does not erase an earlier high-delay observation.
Health and scrape reads do not commit or reset samples. The process-wide observations carry no request
trace context and create no spans or logs, including with a preloaded SDK.

The monitor samples elapsed event-loop intervals every 20 milliseconds and
completes windows after at least one second or sooner for a delay warning.
Ordinary window resets preserve the pending interval even when health is read
before an overdue sample. Counts and quantiles describe completed windows and
their maxima, not individual stalls or the sampled delay distribution's
overall p99. Intentional monitor resets discard unfinished windows; collection
does not backfill periods without an interested exporter. Diagnostic queue drops,
SDK/export failures, and restarts limit coverage. Use the represented-duration
counter and exporter/drop telemetry to assess it. Readiness decisions and
persistent liveness-warning thresholds are unchanged. For pull metrics and example queries,
see [Prometheus event-loop windows](/gateway/prometheus#event-loop-observation-windows).

### Harness lifecycle

- `omnipolymath.harness.duration_ms` (histogram, attrs: `omnipolymath.harness.id`, `omnipolymath.harness.plugin`, `omnipolymath.outcome`, `omnipolymath.harness.phase` on errors)

### Tool execution and loop detection

- `omnipolymath.tool.execution.duration_ms` (histogram, attrs: `gen_ai.tool.name`, `omnipolymath.toolName`, `omnipolymath.tool.source`, `omnipolymath.tool.owner`, `omnipolymath.tool.params.kind`, plus `omnipolymath.errorCategory` on errors)
- `omnipolymath.tool.execution.blocked` (counter, attrs: `gen_ai.tool.name`, `omnipolymath.toolName`, `omnipolymath.tool.source`, `omnipolymath.tool.owner`, `omnipolymath.tool.params.kind`, `omnipolymath.deniedReason`)
- `omnipolymath.tool.loop` (counter, attrs: `omnipolymath.toolName`, `omnipolymath.loop.level`, `omnipolymath.loop.action`, `omnipolymath.loop.detector`, `omnipolymath.loop.count`, optional `omnipolymath.loop.paired_tool`; emitted when a repetitive tool-call loop is detected)

Exact string and array parameter lengths are recorded on tool spans, not metric
labels. This keeps cumulative tool metrics from retaining a separate series for
every observed length.

### Exec

- `omnipolymath.exec.duration_ms` (histogram, attrs: `omnipolymath.exec.target`, `omnipolymath.exec.mode`, `omnipolymath.outcome`, `omnipolymath.failureKind`)

### Diagnostics internals (memory, payloads, exporter health)

- `omnipolymath.gc.duration_ms` (histogram, no attrs; elapsed GC duration for the hosting JavaScript isolate)

GC duration uses Node.js performance entries and is exported only when metrics
are enabled. It is not CPU time or a guaranteed stop-the-world pause. Observation
starts when the existing diagnostics heartbeat sees an interested consumer;
registration after startup can wait until its next 30-second tick, with no
backfill. Diagnostics disable/shutdown disconnects immediately. See
[GC duration coverage and correlation limits](/gateway/prometheus#garbage-collection-duration).

- `omnipolymath.payload.large` (counter, attrs: `omnipolymath.payload.surface`, `omnipolymath.payload.action`, `omnipolymath.channel`, `omnipolymath.plugin`, `omnipolymath.reason`)
- `omnipolymath.payload.large_bytes` (histogram, attrs: same as `omnipolymath.payload.large`)
- `omnipolymath.memory.rss_bytes` / `omnipolymath.memory.heap_used_bytes` / `omnipolymath.memory.heap_total_bytes` / `omnipolymath.memory.external_bytes` / `omnipolymath.memory.array_buffers_bytes` (histograms, no attrs; process memory samples)
- `omnipolymath.memory.pressure` (counter, attrs: `omnipolymath.memory.level`, `omnipolymath.memory.reason`)
- `omnipolymath.session.row.selections` / `omnipolymath.session.row.selection.rows` (counters, attrs: `kind`, `task`; successful resident selections and returned rows before federation and visibility filtering). `kind` is `broad`, `agent`, `store`, `exact`, `session-id`, `parent`, or `running-candidate`. `task` is a bounded enclosing-task bucket, or `other` when unavailable. Periodic memory samples carry cumulative owner totals; repeated samples do not recount selections.
- `omnipolymath.session.row.selection.resets` (counter, no attrs; broad selection invalidations, including topology replacement and disposal).
- `omnipolymath.diagnostic.async_queue.dropped` (counter, attrs: `omnipolymath.diagnostic.async_queue.drop_class`; internal diagnostic-queue backpressure drops)
- `omnipolymath.telemetry.exporter.events` (counter, attrs: `omnipolymath.exporter`, `omnipolymath.signal`, `omnipolymath.status`, optional `omnipolymath.reason`, optional `omnipolymath.errorCategory`; exporter lifecycle/failure self-telemetry)
