import { ROOT_CONTEXT, SpanStatusCode } from "@opentelemetry/api";
import {
  normalizeDiagnosticValue,
  normalizeDiagnosticLane,
} from "omnipolymath/plugin-sdk/diagnostic-runtime";
import type { DiagnosticEventPayload } from "omnipolymath/plugin-sdk/diagnostic-runtime";
import { redactSensitiveText } from "omnipolymath/plugin-sdk/security-runtime";
import { assignOptionalNumberAttrs } from "./service-attributes.js";
import {
  assignOtelContentAttr,
  normalizeOtelErrorMessage,
} from "./service-content-normalization.js";
import type { DiagnosticHandlers } from "./service-events.js";
import type { DiagnosticsRecorderRuntime } from "./service-recorder-runtime.js";
import type { SessionRecoveryDiagnosticEvent } from "./service-types.js";

export function createOperationsRecorders(runtime: DiagnosticsRecorderRuntime) {
  const rowSelections = runtime.sessionRowSelectionBaseline;
  const sessionRecoveryAttrs = (evt: SessionRecoveryDiagnosticEvent) => {
    const attrs: Record<string, string> = { "omnipolymath.state": evt.state };
    if (evt.reason) {
      attrs["omnipolymath.reason"] = redactSensitiveText(evt.reason);
    }
    if (evt.activeWorkKind) {
      attrs["omnipolymath.active_work_kind"] = evt.activeWorkKind;
    }
    return attrs;
  };

  const recordMemoryUsageMetrics = (
    evt: Extract<
      DiagnosticEventPayload,
      { type: "diagnostic.memory.sample" | "diagnostic.memory.pressure" }
    >,
    attrs: Record<string, string> = {},
  ) => {
    runtime.memoryRssHistogram.record(evt.memory.rssBytes, attrs);
    runtime.memoryHeapUsedHistogram.record(evt.memory.heapUsedBytes, attrs);
    runtime.memoryHeapTotalHistogram.record(evt.memory.heapTotalBytes, attrs);
    runtime.memoryExternalHistogram.record(evt.memory.externalBytes, attrs);
    runtime.memoryArrayBuffersHistogram.record(evt.memory.arrayBuffersBytes, attrs);
  };

  return {
    "sessions.list.baseline.retired"(evt, metadata) {
      if (metadata.trusted) {
        runtime.sessionsListBaselineRetirementsCounter.add(1, { cause: evt.cause });
      }
    },
    "gateway.ws.event"(evt, metadata) {
      if (!metadata.trusted) {
        return;
      }
      const attrs = { "omnipolymath.gateway.ws.event": evt.event };
      runtime.gatewayWsEventsCounter.add(evt.count, attrs);
      runtime.gatewayWsEventBytesCounter.add(evt.bytes, attrs);
      if (evt.wireBytes !== undefined) {
        runtime.gatewayWsEventWireBytesCounter.add(evt.wireBytes, attrs);
      }
      for (const [le, count] of Object.entries(evt.frameBytes ?? {})) {
        runtime.gatewayWsEventFrameBytesCounter.add(count, { ...attrs, le });
      }
      if (evt.presenceMode) {
        const presenceAttrs = { "omnipolymath.gateway.ws.mode": evt.presenceMode };
        runtime.gatewayWsPresenceFramesCounter.add(evt.count, presenceAttrs);
        runtime.gatewayWsPresenceBytesCounter.add(evt.bytes, presenceAttrs);
      }
      if (evt.sessionEvent) {
        const sessionAttrs = {
          ...attrs,
          "omnipolymath.gateway.ws.reason": evt.sessionEvent.reason,
          "omnipolymath.gateway.ws.delivery": evt.sessionEvent.delivery,
        };
        runtime.gatewayWsSessionEventFramesCounter.add(evt.count, sessionAttrs);
        runtime.gatewayWsSessionEventBytesCounter.add(evt.bytes, sessionAttrs);
      }
    },
    "gateway.ws.connections"(evt, metadata) {
      if (metadata.trusted) {
        runtime.gatewayWsOperatorConnectionsGauge.record(evt.operators);
      }
    },
    "sessions.list.retention"(evt, metadata) {
      if (metadata.trusted) {
        runtime.sessionsListRetainedViewsGauge.record(evt.views);
        runtime.sessionsListRetainedRefsGauge.record(evt.refs);
        runtime.sessionsListRetainedBytesGauge.record(evt.estimatedBytes);
      }
    },
    "sessions.projection.retention"(evt, metadata) {
      if (metadata.trusted) {
        runtime.sessionProjectionOwnersGauge.record(evt.projections);
        runtime.sessionProjectionRowsRetainedEntriesGauge.record(evt.entries);
        runtime.sessionProjectionRowsRetainedBytesGauge.record(evt.estimatedBytes);
        runtime.sessionProjectionRowsEstimateTruncatedGauge.record(evt.truncatedProjections);
      }
    },
    "sessions.event.retention"(evt, metadata) {
      if (metadata.trusted) {
        runtime.sessionEventRowsRetainedEntriesGauge.record(evt.entries);
        runtime.sessionEventRowsRetainedBytesGauge.record(evt.estimatedBytes);
      }
    },
    "sessions.event.rows.reset"(evt, metadata) {
      if (metadata.trusted) {
        runtime.sessionEventRowsResetCounter.add(evt.count, { cause: evt.cause });
      }
    },
    "gateway.rpc"(evt, metadata) {
      if (!metadata.trusted || (evt.phase === "response" && evt.firstResponse === false)) {
        return;
      }
      const attrs = { "omnipolymath.gateway.rpc.method": evt.method };
      if (evt.phase === "received") {
        runtime.gatewayRpcRequestsCounter.add(1, attrs);
        return;
      }
      const outcomeAttrs = {
        "omnipolymath.gateway.rpc.phase": evt.phase,
        "omnipolymath.gateway.rpc.outcome": evt.outcome,
      };
      runtime.gatewayRpcOutcomesCounter.add(1, outcomeAttrs);
      switch (evt.phase) {
        case "response":
          if (evt.outcome === "ok" && evt.sessionsList?.baseMissReason) {
            runtime.sessionsListBaseMissesCounter.add(1, {
              reason: evt.sessionsList.baseMissReason,
            });
          }
          if (evt.outcome === "ok" || evt.outcome === "error") {
            runtime.gatewayRpcFirstResponseHistogram.record(evt.durationMs, attrs);
          }
          break;
        case "handler":
          runtime.gatewayRpcHandlerHistogram.record(evt.durationMs, attrs);
          runtime.gatewayRpcAdmissionHistogram.record(evt.admissionMs, attrs);
          break;
        case "dispatch":
          if (evt.queueWaitMs !== undefined) {
            runtime.gatewayRpcQueueWaitHistogram.record(evt.queueWaitMs, attrs);
          }
          break;
      }
      if (!runtime.tracesEnabled) {
        return;
      }
      // These completed observations do not own the handler or later response callbacks.
      // Preserve the explicit upstream parent; an absent parent must not borrow the export callback scope.
      const span = runtime.spanWithDuration(
        `omnipolymath.gateway.rpc.${evt.phase}`,
        {
          ...attrs,
          ...outcomeAttrs,
          ...(evt.phase === "handler"
            ? { "omnipolymath.gateway.rpc.admission_ms": evt.admissionMs }
            : {}),
          ...(evt.phase === "dispatch" ? { "omnipolymath.gateway.rpc.response": evt.response } : {}),
        },
        evt.durationMs,
        {
          endTimeMs: evt.ts,
          parentContext:
            runtime.internalOrTrustedExplicitParentContext(evt, metadata) ?? ROOT_CONTEXT,
        },
      );
      if (evt.outcome === "error" || evt.outcome === "threw") {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      span.end(evt.ts);
    },
    "queue.lane.enqueue"(evt) {
      const attrs = { "omnipolymath.lane": normalizeDiagnosticLane(evt.lane) };
      runtime.laneEnqueueCounter.add(1, attrs);
      runtime.queueDepthHistogram.record(evt.queueSize, attrs);
    },
    "queue.lane.dequeue"(evt) {
      const attrs = { "omnipolymath.lane": normalizeDiagnosticLane(evt.lane) };
      runtime.laneDequeueCounter.add(1, attrs);
      runtime.queueDepthHistogram.record(evt.queueSize, attrs);
      if (typeof evt.waitMs === "number") {
        runtime.queueWaitHistogram.record(evt.waitMs, attrs);
      }
    },
    "session.state"(evt) {
      const attrs: Record<string, string> = { "omnipolymath.state": evt.state };
      if (evt.reason) {
        attrs["omnipolymath.reason"] = redactSensitiveText(evt.reason);
      }
      runtime.sessionStateCounter.add(1, attrs);
    },
    "session.turn.created"(evt) {
      runtime.sessionTurnCreatedCounter.add(1, {
        "omnipolymath.agent": normalizeDiagnosticValue(evt.agentId, "unknown"),
        "omnipolymath.channel": normalizeDiagnosticValue(evt.channel, "unknown"),
        "omnipolymath.trigger": evt.trigger,
      });
    },
    "session.stuck"(evt) {
      const attrs: Record<string, string> = { "omnipolymath.state": evt.state };
      runtime.sessionStuckCounter.add(1, attrs);
      if (typeof evt.ageMs === "number") {
        runtime.sessionStuckAgeHistogram.record(evt.ageMs, attrs);
      }
      if (!runtime.tracesEnabled) {
        return;
      }
      const spanAttrs: Record<string, string | number> = { ...attrs };
      spanAttrs["omnipolymath.queueDepth"] = evt.queueDepth ?? 0;
      spanAttrs["omnipolymath.ageMs"] = evt.ageMs;
      const span = runtime.tracer.startSpan("omnipolymath.session.stuck", { attributes: spanAttrs });
      span.setStatus({ code: SpanStatusCode.ERROR, message: "session stuck" });
      span.end();
    },
    "session.recovery.requested"(evt) {
      const attrs = sessionRecoveryAttrs(evt);
      attrs["omnipolymath.action"] = evt.allowActiveAbort ? "abort" : "recover";
      runtime.sessionRecoveryRequestedCounter.add(1, attrs);
      runtime.sessionRecoveryAgeHistogram.record(evt.ageMs, attrs);
    },
    "session.recovery.completed"(evt) {
      const attrs = sessionRecoveryAttrs(evt);
      attrs["omnipolymath.status"] = evt.status;
      attrs["omnipolymath.action"] = normalizeDiagnosticValue(evt.action, "unknown");
      if (evt.outcomeReason) {
        attrs["omnipolymath.reason"] = redactSensitiveText(evt.outcomeReason);
      }
      runtime.sessionRecoveryCompletedCounter.add(1, attrs);
      runtime.sessionRecoveryAgeHistogram.record(evt.ageMs, attrs);
    },
    "talk.event"(evt, metadata) {
      if (!metadata.trusted) {
        return;
      }
      const attrs = {
        "omnipolymath.talk.brain": normalizeDiagnosticValue(evt.brain),
        "omnipolymath.talk.event_type": normalizeDiagnosticValue(evt.talkEventType),
        "omnipolymath.talk.mode": normalizeDiagnosticValue(evt.mode),
        "omnipolymath.talk.provider": normalizeDiagnosticValue(evt.provider),
        "omnipolymath.talk.transport": normalizeDiagnosticValue(evt.transport),
      };
      runtime.talkEventCounter.add(1, attrs);
      if (typeof evt.durationMs === "number") {
        runtime.talkEventDurationHistogram.record(evt.durationMs, attrs);
      }
      if (typeof evt.byteLength === "number") {
        runtime.talkAudioBytesHistogram.record(evt.byteLength, attrs);
      }
    },
    "run.attempt"(evt) {
      runtime.runAttemptCounter.add(1, { "omnipolymath.attempt": evt.attempt });
    },
    "tool.loop"(evt) {
      const attrs = {
        "omnipolymath.toolName": normalizeDiagnosticValue(evt.toolName, "tool"),
        "omnipolymath.loop.level": evt.level,
        "omnipolymath.loop.action": evt.action,
        "omnipolymath.loop.detector": evt.detector,
        "omnipolymath.loop.count": evt.count,
        ...(evt.pairedToolName
          ? { "omnipolymath.loop.paired_tool": normalizeDiagnosticValue(evt.pairedToolName, "tool") }
          : {}),
      };
      runtime.toolLoopCounter.add(1, attrs);
      if (!runtime.tracesEnabled) {
        return;
      }
      const spanAttrs: Record<string, string | number | boolean> = { ...attrs };
      runtime.addRunAttrs(spanAttrs, evt);
      const span = runtime.spanWithDuration("omnipolymath.tool.loop", spanAttrs, 0, {
        endTimeMs: evt.ts,
      });
      if (evt.level === "critical" || evt.action === "block") {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `${evt.detector}:${evt.action}`,
        });
      }
      span.end(evt.ts);
    },
    "diagnostic.memory.sample": (evt, metadata) => {
      recordMemoryUsageMetrics(evt);
      const totals = metadata.trusted && evt.memory.sessionRowSelections;
      if (!totals) {
        return;
      }
      for (const selection of totals.selections) {
        const key = `${selection.kind}:${selection.task}`;
        const previous = rowSelections.selections.get(key);
        const attrs = { kind: selection.kind, task: selection.task };
        runtime.sessionRowSelectionsCounter.add(selection.calls - (previous?.calls ?? 0), attrs);
        runtime.sessionRowSelectionRowsCounter.add(selection.rows - (previous?.rows ?? 0), attrs);
        rowSelections.selections.set(key, selection);
      }
      runtime.sessionRowSelectionResetsCounter.add(totals.resets - rowSelections.resets);
      rowSelections.resets = totals.resets;
    },
    "diagnostic.memory.pressure"(evt) {
      const attrs = {
        "omnipolymath.memory.level": evt.level,
        "omnipolymath.memory.reason": evt.reason,
      };
      runtime.memoryPressureCounter.add(1, attrs);
      recordMemoryUsageMetrics(evt, attrs);
      if (!runtime.tracesEnabled) {
        return;
      }
      const spanAttrs: Record<string, string | number | boolean> = {
        ...attrs,
        "omnipolymath.memory.rss_bytes": evt.memory.rssBytes,
        "omnipolymath.memory.heap_used_bytes": evt.memory.heapUsedBytes,
        "omnipolymath.memory.heap_total_bytes": evt.memory.heapTotalBytes,
        "omnipolymath.memory.external_bytes": evt.memory.externalBytes,
        "omnipolymath.memory.array_buffers_bytes": evt.memory.arrayBuffersBytes,
      };
      assignOptionalNumberAttrs(spanAttrs, "omnipolymath.memory.", {
        threshold_bytes: evt.thresholdBytes,
        rss_growth_bytes: evt.rssGrowthBytes,
        window_ms: evt.windowMs,
      });
      const span = runtime.spanWithDuration("omnipolymath.memory.pressure", spanAttrs, 0, {
        endTimeMs: evt.ts,
      });
      if (evt.level === "critical") {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: evt.reason,
        });
      }
      span.end(evt.ts);
    },
    "diagnostic.async_queue.dropped"(evt) {
      runtime.asyncQueueDroppedCounter.add(evt.droppedEvents, {
        "omnipolymath.diagnostic.async_queue.drop_class": "total",
      });
      for (const [dropClass, field] of [
        ["trusted", "droppedTrustedEvents"],
        ["untrusted", "droppedUntrustedEvents"],
        ["priority", "droppedPriorityEvents"],
      ] as const) {
        if (evt[field] !== undefined) {
          runtime.asyncQueueDroppedCounter.add(evt[field], {
            "omnipolymath.diagnostic.async_queue.drop_class": dropClass,
          });
        }
      }
    },
    "run.completed"(evt, metadata, privateData) {
      const attrs: Record<string, string | number> = {
        "omnipolymath.outcome": evt.outcome,
        "omnipolymath.provider": evt.provider ?? "unknown",
        "omnipolymath.model": evt.model ?? "unknown",
      };
      if (evt.channel) {
        attrs["omnipolymath.channel"] = evt.channel;
      }
      if (evt.blockedBy) {
        attrs["omnipolymath.blocked_by"] = normalizeDiagnosticValue(evt.blockedBy, "unknown");
      }
      runtime.durationHistogram.record(evt.durationMs, attrs);
      if (!runtime.tracesEnabled) {
        return;
      }
      const spanAttrs: Record<string, string | number | boolean> = {
        "omnipolymath.outcome": evt.outcome,
      };
      runtime.addRunAttrs(spanAttrs, evt);
      if (evt.blockedBy) {
        spanAttrs["omnipolymath.blocked_by"] = normalizeDiagnosticValue(evt.blockedBy, "unknown");
      }
      if (evt.errorCategory) {
        spanAttrs["omnipolymath.errorCategory"] = normalizeDiagnosticValue(evt.errorCategory, "other");
      }
      // Redacted message goes on the span only, never the low-cardinality metric attrs.
      const redactedError = normalizeOtelErrorMessage(privateData.errorMessage);
      if (redactedError) {
        spanAttrs["omnipolymath.error"] = redactedError;
      }
      if (runtime.captureContent) {
        assignOtelContentAttr(spanAttrs, "input.value", privateData.messageContent?.userPrompt);
        assignOtelContentAttr(spanAttrs, "output.value", privateData.messageContent?.finalResponse);
      }
      const trustedTrace = runtime.trustedTraceContext(evt, metadata);
      const trackedSpan = trustedTrace?.spanId
        ? runtime.activeTrustedSpans.get(trustedTrace.spanId)
        : undefined;
      const span =
        trackedSpan ??
        runtime.spanWithDuration("omnipolymath.run", spanAttrs, evt.durationMs, {
          parentContext: runtime.activeTrustedParentContext(evt, metadata),
          endTimeMs: evt.ts,
        });
      runtime.setSpanAttrs(span, spanAttrs);
      if (evt.outcome === "error") {
        const message =
          redactedError ?? (evt.errorCategory ? redactSensitiveText(evt.errorCategory) : undefined);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          ...(message ? { message } : {}),
        });
      }
      runtime.completeTrackedLifecycleSpan(trackedSpan ? trustedTrace : undefined, span, evt.ts);
    },
  } satisfies DiagnosticHandlers;
}
