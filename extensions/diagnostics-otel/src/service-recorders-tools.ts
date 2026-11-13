import { ROOT_CONTEXT, SpanStatusCode } from "@opentelemetry/api";
import {
  isInternalDiagnosticEventMetadata,
  normalizeDiagnosticValue,
} from "omnipolymath/plugin-sdk/diagnostic-runtime";
import type {
  DiagnosticEventMetadata,
  DiagnosticEventPayload,
  DiagnosticEventPrivateData,
} from "omnipolymath/plugin-sdk/diagnostic-runtime";
import { asPositiveFiniteNumber } from "omnipolymath/plugin-sdk/number-runtime";
import { redactSensitiveText } from "omnipolymath/plugin-sdk/security-runtime";
import { assignOptionalNumberAttrs } from "./service-attributes.js";
import type { DiagnosticHandlers } from "./service-events.js";
import {
  assignOtelToolContentAttributes,
  assignOtelToolIdentityAttributes,
} from "./service-genai-content.js";
import type { DiagnosticsRecorderRuntime } from "./service-recorder-runtime.js";

export function createToolAndSystemRecorders(runtime: DiagnosticsRecorderRuntime) {
  const toolExecutionBaseAttrs = (
    evt: Extract<
      DiagnosticEventPayload,
      {
        type:
          | "tool.execution.started"
          | "tool.execution.completed"
          | "tool.execution.error"
          | "tool.execution.blocked";
      }
    >,
  ): Record<string, string | number | boolean> => ({
    "omnipolymath.toolName": evt.toolName,
    "omnipolymath.tool.source": normalizeDiagnosticValue(evt.toolSource, "core"),
    "gen_ai.tool.name": evt.toolName,
    ...(evt.toolOwner ? { "omnipolymath.tool.owner": normalizeDiagnosticValue(evt.toolOwner) } : {}),
    ...(evt.paramsSummary ? { "omnipolymath.tool.params.kind": evt.paramsSummary.kind } : {}),
  });
  const toolTimestampMs = (evt: { sourceTimestampMs?: number; ts: number }) =>
    evt.sourceTimestampMs ?? evt.ts;

  function recordToolExecutionFinished(
    evt: Extract<
      DiagnosticEventPayload,
      { type: "tool.execution.completed" | "tool.execution.error" }
    >,
    metadata: DiagnosticEventMetadata,
    { toolContent }: DiagnosticEventPrivateData,
  ) {
    const attrs = toolExecutionBaseAttrs(evt);
    if (evt.type === "tool.execution.error") {
      attrs["omnipolymath.errorCategory"] = normalizeDiagnosticValue(evt.errorCategory, "other");
    }
    runtime.toolExecutionDurationHistogram.record(evt.durationMs, attrs);
    if (!runtime.tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = {
      ...attrs,
      ...runtime.paramsSummaryAttrs(evt.paramsSummary),
    };
    runtime.addRunAttrs(spanAttrs, evt);
    assignOtelToolIdentityAttributes(spanAttrs, evt);
    if (evt.type === "tool.execution.error" && evt.errorCode) {
      spanAttrs["omnipolymath.errorCode"] = normalizeDiagnosticValue(evt.errorCode, "other");
    }
    assignOtelToolContentAttributes(spanAttrs, toolContent, runtime.captureContent);
    const span =
      runtime.takeTrackedTrustedSpan(evt, metadata) ??
      runtime.spanWithDuration("omnipolymath.tool.execution", spanAttrs, evt.durationMs, {
        parentContext: runtime.activeTrustedParentContext(evt, metadata),
        endTimeMs: toolTimestampMs(evt),
      });
    runtime.setSpanAttrs(span, spanAttrs);
    if (evt.type === "tool.execution.error") {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: redactSensitiveText(evt.errorCategory),
      });
    }
    span.end(toolTimestampMs(evt));
  }

  return {
    "diagnostic.gc"(evt, metadata) {
      if (!metadata.trusted && !isInternalDiagnosticEventMetadata(metadata)) {
        return;
      }
      runtime.gcDurationHistogram.record(
        evt.durationMs,
        {
          "omnipolymath.gc.kind": evt.kind ?? "unknown",
          "omnipolymath.gc.thread": evt.thread ?? "main",
          ...(evt.workerSlot === undefined ? {} : { "omnipolymath.gc.worker_slot": evt.workerSlot }),
        },
        ROOT_CONTEXT,
      );
    },
    "gateway.event_loop.sample"(evt, metadata) {
      if (!metadata.trusted && !isInternalDiagnosticEventMetadata(metadata)) {
        return;
      }
      // Process-wide windows must not inherit the reader's trace through an external SDK.
      runtime.gatewayEventLoopDelayMaxHistogram.record(evt.delayMaxMs, undefined, ROOT_CONTEXT);
      runtime.gatewayEventLoopObservedCounter.add(evt.intervalMs, undefined, ROOT_CONTEXT);
    },
    "skill.used"(evt, metadata) {
      if (!metadata.trusted) {
        return;
      }
      const attrs = {
        "omnipolymath.skill.name": normalizeDiagnosticValue(evt.skillName, "skill"),
        "omnipolymath.skill.source": normalizeDiagnosticValue(evt.skillSource),
        "omnipolymath.skill.activation": normalizeDiagnosticValue(evt.activation),
        ...(evt.agentId ? { "omnipolymath.agent": normalizeDiagnosticValue(evt.agentId) } : {}),
        ...(evt.toolName
          ? { "omnipolymath.toolName": normalizeDiagnosticValue(evt.toolName, "tool") }
          : {}),
      };
      runtime.skillUsedCounter.add(1, attrs);
      if (!runtime.tracesEnabled) {
        return;
      }
      const spanAttrs: Record<string, string | number | boolean> = {
        ...attrs,
        ...(evt.skillFingerprint ? { "omnipolymath.skill.fingerprint": evt.skillFingerprint } : {}),
      };
      runtime.addRunAttrs(spanAttrs, evt);
      const span = runtime.spanWithDuration("omnipolymath.skill.used", spanAttrs, 0, {
        parentContext: runtime.activeTrustedParentContext(evt, metadata),
        endTimeMs: evt.ts,
      });
      runtime.setSpanAttrs(span, spanAttrs);
      span.end(evt.ts);
    },
    "tool.execution.started"(evt, metadata) {
      if (!runtime.tracesEnabled || !metadata.trusted) {
        return;
      }
      if (runtime.getTrackedInternalOrTrustedSpan(evt, metadata)) {
        return;
      }
      const spanAttrs = {
        ...toolExecutionBaseAttrs(evt),
        ...runtime.paramsSummaryAttrs(evt.paramsSummary),
      };
      // Stamp identity at span start: a shutdown or reload before the terminal
      // event would otherwise export this span outside the conversation grouping.
      runtime.addRunAttrs(spanAttrs, evt);
      assignOtelToolIdentityAttributes(spanAttrs, evt);
      runtime.trackInternalOrTrustedSpan(
        evt,
        metadata,
        runtime.spanWithDuration("omnipolymath.tool.execution", spanAttrs, undefined, {
          parentContext: runtime.activeTrustedParentContext(evt, metadata),
          startTimeMs: toolTimestampMs(evt),
        }),
      );
    },
    "tool.execution.blocked"(evt, metadata) {
      runtime.toolExecutionBlockedCounter.add(1, {
        ...toolExecutionBaseAttrs(evt),
        "omnipolymath.deniedReason": normalizeDiagnosticValue(evt.deniedReason, "other"),
      });
      if (!runtime.tracesEnabled) {
        return;
      }
      const spanAttrs: Record<string, string | number | boolean> = {
        ...toolExecutionBaseAttrs(evt),
        ...runtime.paramsSummaryAttrs(evt.paramsSummary),
        "omnipolymath.outcome": "blocked",
        "omnipolymath.deniedReason": normalizeDiagnosticValue(evt.deniedReason, "other"),
      };
      runtime.addRunAttrs(spanAttrs, evt);
      assignOtelToolIdentityAttributes(spanAttrs, evt);
      const span =
        runtime.takeTrackedTrustedSpan(evt, metadata) ??
        runtime.spanWithDuration("omnipolymath.tool.execution", spanAttrs, 0, {
          parentContext: runtime.activeTrustedParentContext(evt, metadata),
          endTimeMs: toolTimestampMs(evt),
        });
      runtime.setSpanAttrs(span, spanAttrs);
      span.end(toolTimestampMs(evt));
    },
    "payload.large"(evt) {
      const attrs = {
        "omnipolymath.payload.action": evt.action,
        "omnipolymath.payload.surface": normalizeDiagnosticValue(evt.surface, "unknown"),
        "omnipolymath.channel": normalizeDiagnosticValue(evt.channel, "none"),
        "omnipolymath.plugin": normalizeDiagnosticValue(evt.pluginId, "none"),
        "omnipolymath.reason": normalizeDiagnosticValue(evt.reason, "none"),
      };
      runtime.payloadLargeCounter.add(1, attrs);
      const bytes = asPositiveFiniteNumber(evt.bytes);
      if (bytes !== undefined) {
        runtime.payloadLargeBytesHistogram.record(bytes, attrs);
      }
    },
    "exec.process.completed"(evt, metadata) {
      const attrs: Record<string, string | number> = {
        "omnipolymath.exec.target": evt.target,
        "omnipolymath.exec.mode": evt.mode,
        "omnipolymath.outcome": evt.outcome,
      };
      if (evt.failureKind) {
        attrs["omnipolymath.failureKind"] = evt.failureKind;
      }
      runtime.execProcessDurationHistogram.record(evt.durationMs, attrs);
      if (!runtime.tracesEnabled) {
        return;
      }

      const spanAttrs: Record<string, string | number | boolean> = {
        ...attrs,
        "omnipolymath.exec.command_length": evt.commandLength,
      };
      if (typeof evt.exitCode === "number") {
        spanAttrs["omnipolymath.exec.exit_code"] = evt.exitCode;
      }
      if (evt.exitSignal) {
        spanAttrs["omnipolymath.exec.exit_signal"] = normalizeDiagnosticValue(evt.exitSignal, "other");
      }
      if (evt.timedOut !== undefined) {
        spanAttrs["omnipolymath.exec.timed_out"] = evt.timedOut;
      }

      // Exec events carry the innermost ambient scope rather than a child context, so
      // the parent is looked up by the event's own span id first. For the omnipolymath
      // harness that scope is the harness run (no run scope is opened -
      // shouldEmitAgentRunDiagnostics is false there), so the parent is
      // omnipolymath.harness.run; other harnesses open a run scope and parent to omnipolymath.run.
      const span = runtime.spanWithDuration("omnipolymath.exec", spanAttrs, evt.durationMs, {
        parentContext: runtime.exportedInternalOrTrustedContext(evt, metadata),
        endTimeMs: evt.ts,
      });
      if (evt.outcome === "failed") {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          ...(evt.failureKind ? { message: evt.failureKind } : {}),
        });
      }
      span.end(evt.ts);
    },
    "diagnostic.heartbeat"(evt) {
      runtime.queueDepthHistogram.record(evt.queued, { "omnipolymath.channel": "heartbeat" });
    },
    "diagnostic.liveness.warning"(evt) {
      const reason = evt.reasons.join(":");
      const attrs = {
        "omnipolymath.liveness.reason": normalizeDiagnosticValue(reason, "unknown"),
      };
      runtime.livenessWarningCounter.add(1, attrs);
      runtime.queueDepthHistogram.record(evt.queued, { "omnipolymath.channel": "liveness" });
      for (const [histogram, value] of [
        [runtime.livenessEventLoopDelayP99Histogram, evt.eventLoopDelayP99Ms],
        [runtime.livenessEventLoopDelayMaxHistogram, evt.eventLoopDelayMaxMs],
        [runtime.livenessEventLoopUtilizationHistogram, evt.eventLoopUtilization],
        [runtime.livenessCpuCoreRatioHistogram, evt.cpuCoreRatio],
      ] as const) {
        if (value !== undefined) {
          histogram.record(value, attrs);
        }
      }
      if (!runtime.tracesEnabled) {
        return;
      }
      const spanAttrs: Record<string, string | number> = {
        ...attrs,
        "omnipolymath.liveness.active": evt.active,
        "omnipolymath.liveness.waiting": evt.waiting,
        "omnipolymath.liveness.queued": evt.queued,
        "omnipolymath.liveness.interval_ms": evt.intervalMs,
      };
      assignOptionalNumberAttrs(spanAttrs, "omnipolymath.liveness.", {
        event_loop_delay_p99_ms: evt.eventLoopDelayP99Ms,
        event_loop_delay_max_ms: evt.eventLoopDelayMaxMs,
        event_loop_utilization: evt.eventLoopUtilization,
        cpu_user_ms: evt.cpuUserMs,
        cpu_system_ms: evt.cpuSystemMs,
        cpu_total_ms: evt.cpuTotalMs,
        cpu_core_ratio: evt.cpuCoreRatio,
      });
      const span = runtime.spanWithDuration("omnipolymath.liveness.warning", spanAttrs, 0, {
        endTimeMs: evt.ts,
      });
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: reason,
      });
      span.end(evt.ts);
    },
    "diagnostic.phase.completed"(evt, metadata) {
      if (!runtime.tracesEnabled) {
        return;
      }
      const spanAttrs: Record<string, string | number> = {
        "omnipolymath.phase": normalizeDiagnosticValue(evt.name, "unknown"),
      };
      assignOptionalNumberAttrs(spanAttrs, "omnipolymath.phase.", {
        cpu_user_ms: evt.cpuUserMs,
        cpu_system_ms: evt.cpuSystemMs,
        cpu_total_ms: evt.cpuTotalMs,
        cpu_core_ratio: evt.cpuCoreRatio,
      });
      for (const [key, value] of Object.entries(evt.details ?? {})) {
        spanAttrs[`omnipolymath.phase.detail.${key}`] =
          typeof value === "boolean" ? String(value) : value;
      }
      const endTimeMs = evt.endedAt ?? evt.ts;
      const span = runtime.spanWithDuration(
        "omnipolymath.diagnostic.phase",
        spanAttrs,
        evt.durationMs,
        {
          endTimeMs,
          ...(metadata.trusted
            ? {
                parentContext:
                  runtime.internalOrTrustedExplicitParentContext(evt, metadata) ?? ROOT_CONTEXT,
              }
            : {}),
        },
      );
      span.end(endTimeMs);
    },
    "telemetry.exporter"(evt, metadata) {
      if (!metadata.trusted) {
        return;
      }
      runtime.telemetryExporterCounter.add(1, {
        "omnipolymath.exporter": normalizeDiagnosticValue(evt.exporter, "unknown"),
        "omnipolymath.signal": evt.signal,
        "omnipolymath.status": evt.status,
        ...(evt.reason ? { "omnipolymath.reason": evt.reason } : {}),
        ...(evt.errorCategory
          ? { "omnipolymath.errorCategory": normalizeDiagnosticValue(evt.errorCategory, "other") }
          : {}),
      });
    },
    "tool.execution.completed": recordToolExecutionFinished,
    "tool.execution.error": recordToolExecutionFinished,
  } satisfies DiagnosticHandlers;
}
