import { SpanStatusCode } from "@opentelemetry/api";
import {
  normalizeDiagnosticValue,
  normalizeDiagnosticLane,
} from "omnipolymath/plugin-sdk/diagnostic-runtime";
import type {
  DiagnosticEventMetadata,
  DiagnosticEventPayload,
  DiagnosticEventPrivateData,
} from "omnipolymath/plugin-sdk/diagnostic-runtime";
import { redactOtelAttributes } from "./service-attributes.js";
import {
  assignOtelContentAttr,
  normalizeOtelErrorMessage,
} from "./service-content-normalization.js";
import type { DiagnosticHandlers } from "./service-events.js";
import { assignOtelModelContentAttributes } from "./service-genai-content.js";
import type { DiagnosticsRecorderRuntime } from "./service-recorder-runtime.js";
import type { HarnessRunDiagnosticEvent } from "./service-types.js";

export function createHarnessRecorders(runtime: DiagnosticsRecorderRuntime) {
  const harnessRunMetricAttrs = (evt: HarnessRunDiagnosticEvent) => ({
    "omnipolymath.harness.id": normalizeDiagnosticValue(evt.harnessId, "unknown"),
    "omnipolymath.harness.plugin": normalizeDiagnosticValue(evt.pluginId),
    ...(evt.type === "harness.run.started"
      ? {}
      : {
          "omnipolymath.outcome": evt.type === "harness.run.error" ? "error" : evt.outcome,
        }),
    "omnipolymath.provider": normalizeDiagnosticValue(evt.provider, "unknown"),
    "omnipolymath.model": normalizeDiagnosticValue(evt.model, "unknown"),
    ...(evt.channel ? { "omnipolymath.channel": normalizeDiagnosticValue(evt.channel) } : {}),
  });

  function recordHarnessRunFinished(
    evt: Extract<DiagnosticEventPayload, { type: "harness.run.completed" | "harness.run.error" }>,
    metadata: DiagnosticEventMetadata,
    privateData: DiagnosticEventPrivateData,
  ) {
    const errorType =
      evt.type === "harness.run.error"
        ? normalizeDiagnosticValue(evt.errorCategory, "other")
        : "error";
    const attrs = {
      ...harnessRunMetricAttrs(evt),
      ...(evt.type === "harness.run.error"
        ? { "omnipolymath.harness.phase": evt.phase, "omnipolymath.errorCategory": errorType }
        : {}),
    };
    runtime.harnessDurationHistogram.record(evt.durationMs, attrs);
    if (!runtime.tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = { ...attrs };
    runtime.addRunAttrs(spanAttrs, evt);
    if (evt.type === "harness.run.completed") {
      if (evt.resultClassification) {
        spanAttrs["omnipolymath.harness.result_classification"] = normalizeDiagnosticValue(
          evt.resultClassification,
        );
      }
      if (typeof evt.yieldDetected === "boolean") {
        spanAttrs["omnipolymath.harness.yield_detected"] = evt.yieldDetected;
      }
      if (evt.itemLifecycle) {
        spanAttrs["omnipolymath.harness.items.started"] = evt.itemLifecycle.startedCount;
        spanAttrs["omnipolymath.harness.items.completed"] = evt.itemLifecycle.completedCount;
        spanAttrs["omnipolymath.harness.items.active"] = evt.itemLifecycle.activeCount;
      }
    } else {
      spanAttrs["error.type"] = errorType;
      if (evt.cleanupFailed) {
        spanAttrs["omnipolymath.harness.cleanup_failed"] = true;
      }
    }
    // Redacted message goes on the span only, never the low-cardinality metric attrs.
    const redactedError = normalizeOtelErrorMessage(privateData.errorMessage);
    if (redactedError) {
      spanAttrs["omnipolymath.error"] = redactedError;
    }
    // CLI harnesses attach content at completion rather than startup, so the
    // prompt must be consumable here as well; setSpanAttrs below preserves any
    // input.value already recorded on the tracked span at startup.
    if (runtime.captureContent) {
      assignOtelContentAttr(spanAttrs, "input.value", privateData.harnessContent?.userPrompt);
      assignOtelContentAttr(spanAttrs, "output.value", privateData.harnessContent?.finalResponse);
    }
    const trustedTrace = runtime.trustedTraceContext(evt, metadata);
    const trackedSpan = trustedTrace?.spanId
      ? runtime.activeTrustedSpans.get(trustedTrace.spanId)
      : undefined;
    const span =
      trackedSpan ??
      runtime.spanWithDuration("omnipolymath.harness.run", spanAttrs, evt.durationMs, {
        parentContext: runtime.activeTrustedParentContext(evt, metadata),
        endTimeMs: evt.ts,
      });
    runtime.setSpanAttrs(span, spanAttrs);
    if (evt.type === "harness.run.error" || evt.outcome === "error") {
      span.setStatus({ code: SpanStatusCode.ERROR, message: redactedError ?? errorType });
    }
    // Aborted runs also retain their context for late children.
    runtime.completeTrackedLifecycleSpan(trackedSpan ? trustedTrace : undefined, span, evt.ts);
  }

  return {
    "agent.commentary"(evt, metadata, privateData) {
      if (!runtime.tracesEnabled || !metadata.trusted) {
        return;
      }
      const span = runtime.getTrackedInternalOrTrustedSpan(evt, metadata);
      if (!span) {
        return;
      }
      const attrs: Record<string, string | number | boolean> = {
        "omnipolymath.harness.id": normalizeDiagnosticValue(evt.harnessId, "unknown"),
        "omnipolymath.commentary.sequence": evt.sourceSequence,
        "omnipolymath.commentary.text_length": evt.textLength,
        "omnipolymath.commentary.content_truncated": evt.contentTruncated,
      };
      assignOtelModelContentAttributes(attrs, privateData.modelContent, runtime.captureContent);
      // addEvent bypasses setSpanAttrs; apply the same redaction and identifier
      // policy. Queued commentary precedes queued harness completion.
      span.addEvent(
        "omnipolymath.agent.commentary",
        redactOtelAttributes(attrs),
        evt.sourceTimestampMs,
      );
    },
    "harness.run.started"(evt, metadata, privateData) {
      if (!runtime.tracesEnabled || !metadata.trusted) {
        return;
      }
      const spanAttrs: Record<string, string | number | boolean> = {
        ...harnessRunMetricAttrs(evt),
      };
      runtime.addRunAttrs(spanAttrs, evt);
      if (runtime.captureContent) {
        assignOtelContentAttr(spanAttrs, "input.value", privateData.harnessContent?.userPrompt);
      }
      runtime.trackInternalOrTrustedSpan(
        evt,
        metadata,
        runtime.spanWithDuration("omnipolymath.harness.run", spanAttrs, undefined, {
          parentContext: runtime.activeTrustedParentContext(evt, metadata),
          startTimeMs: evt.ts,
        }),
      );
    },
    "context.assembled"(evt, metadata) {
      if (!runtime.tracesEnabled) {
        return;
      }
      const spanAttrs: Record<string, string | number | boolean> = {
        "omnipolymath.context.message_count": evt.messageCount,
        "omnipolymath.context.history_text_chars": evt.historyTextChars,
        "omnipolymath.context.history_image_blocks": evt.historyImageBlocks,
        "omnipolymath.context.max_message_text_chars": evt.maxMessageTextChars,
        "omnipolymath.context.system_prompt_chars": evt.systemPromptChars,
        "omnipolymath.context.prompt_chars": evt.promptChars,
        "omnipolymath.context.prompt_images": evt.promptImages,
      };
      runtime.addRunAttrs(spanAttrs, evt);
      if (evt.contextTokenBudget !== undefined) {
        spanAttrs["omnipolymath.context.token_budget"] = evt.contextTokenBudget;
      }
      if (evt.reserveTokens !== undefined) {
        spanAttrs["omnipolymath.context.reserve_tokens"] = evt.reserveTokens;
      }
      const span = runtime.spanWithDuration("omnipolymath.context.assembled", spanAttrs, 0, {
        parentContext: runtime.activeTrustedParentContext(evt, metadata),
        endTimeMs: evt.ts,
      });
      span.end(evt.ts);
    },
    "model.failover"(evt, metadata) {
      const metricAttrs: Record<string, string> = {
        "omnipolymath.failover.reason": normalizeDiagnosticValue(evt.reason, "unknown"),
        "omnipolymath.failover.suspended":
          evt.suspended === undefined ? "unknown" : String(evt.suspended),
        "omnipolymath.lane": normalizeDiagnosticLane(evt.lane, "unknown"),
        "omnipolymath.model": normalizeDiagnosticValue(evt.fromModel),
        "omnipolymath.provider": normalizeDiagnosticValue(evt.fromProvider),
        "omnipolymath.failover.to_model": normalizeDiagnosticValue(evt.toModel),
        "omnipolymath.failover.to_provider": normalizeDiagnosticValue(evt.toProvider),
      };
      runtime.modelFailoverCounter.add(1, metricAttrs);
      if (!runtime.tracesEnabled) {
        return;
      }
      const spanAttrs: Record<string, string | number | boolean> = {
        "omnipolymath.failover.reason": normalizeDiagnosticValue(evt.reason, "unknown"),
      };
      if (evt.fromProvider) {
        spanAttrs["omnipolymath.provider"] = evt.fromProvider;
      }
      if (evt.fromModel) {
        spanAttrs["omnipolymath.model"] = evt.fromModel;
      }
      if (evt.toProvider) {
        spanAttrs["omnipolymath.failover.to_provider"] = evt.toProvider;
      }
      if (evt.toModel) {
        spanAttrs["omnipolymath.failover.to_model"] = evt.toModel;
      }
      if (evt.lane) {
        spanAttrs["omnipolymath.lane"] = normalizeDiagnosticLane(evt.lane, "unknown");
      }
      if (evt.suspended !== undefined) {
        spanAttrs["omnipolymath.failover.suspended"] = evt.suspended;
      }
      if (evt.cascadeDepth !== undefined) {
        spanAttrs["omnipolymath.failover.cascade_depth"] = evt.cascadeDepth;
      }
      const span = runtime.spanWithDuration("omnipolymath.model.failover", spanAttrs, 0, {
        parentContext: runtime.activeTrustedParentContext(evt, metadata),
        endTimeMs: evt.ts,
      });
      span.end(evt.ts);
    },
    "harness.run.completed": recordHarnessRunFinished,
    "harness.run.error": recordHarnessRunFinished,
  } satisfies DiagnosticHandlers;
}
