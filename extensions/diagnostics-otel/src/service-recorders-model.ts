import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { normalizeDiagnosticValue } from "omnipolymath/plugin-sdk/diagnostic-runtime";
import type {
  DiagnosticEventMetadata,
  DiagnosticEventPrivateData,
} from "omnipolymath/plugin-sdk/diagnostic-runtime";
import { asPositiveFiniteNumber } from "omnipolymath/plugin-sdk/number-runtime";
import { redactSensitiveText } from "omnipolymath/plugin-sdk/security-runtime";
import { redactOtelAttributes } from "./service-attributes.js";
import type { DiagnosticHandlers } from "./service-events.js";
import {
  addUpstreamRequestIdSpanEvent,
  assignGenAiModelCallAttrs,
  assignModelCallPromptStatsAttrs,
  assignPositiveNumberAttr,
  assignModelCallUsageAttrs,
  assignModelResponseUsageAttrs,
  genAiOperationName,
  modelCallSpanName,
} from "./service-genai-attributes.js";
import { assignOtelModelContentAttributes } from "./service-genai-content.js";
import type { DiagnosticsRecorderRuntime } from "./service-recorder-runtime.js";
import type { ModelCallLifecycleDiagnosticEvent } from "./service-types.js";

export function createModelRecorders(runtime: DiagnosticsRecorderRuntime) {
  function recordModelCallFinished(
    evt: ModelCallLifecycleDiagnosticEvent,
    metadata: DiagnosticEventMetadata,
    { modelContent }: DiagnosticEventPrivateData,
  ) {
    const errorType =
      evt.type === "model.call.error"
        ? normalizeDiagnosticValue(evt.errorCategory, "other")
        : undefined;
    const metricAttrs = {
      "omnipolymath.provider": evt.provider,
      "omnipolymath.model": evt.model,
      "omnipolymath.api": normalizeDiagnosticValue(evt.api),
      "omnipolymath.transport": normalizeDiagnosticValue(evt.transport),
      "omnipolymath.model_call.observation_unit": evt.observationUnit ?? "request",
      ...(errorType !== undefined ? { "omnipolymath.errorCategory": errorType } : {}),
      ...(evt.type === "model.call.error" && evt.failureKind
        ? { "omnipolymath.failureKind": normalizeDiagnosticValue(evt.failureKind, "other") }
        : {}),
    };
    runtime.modelCallDurationHistogram.record(evt.durationMs, metricAttrs);
    for (const [histogram, value] of [
      [runtime.modelCallRequestBytesHistogram, evt.requestPayloadBytes],
      [runtime.modelCallResponseBytesHistogram, evt.responseStreamBytes],
      [runtime.modelCallTimeToFirstByteHistogram, evt.timeToFirstByteMs],
    ] as const) {
      const normalized = asPositiveFiniteNumber(value);
      if (normalized !== undefined) {
        histogram.record(normalized, metricAttrs);
      }
    }
    runtime.genAiOperationDurationHistogram.record(evt.durationMs / 1000, {
      "gen_ai.operation.name": genAiOperationName(evt.api, evt.observationUnit),
      "gen_ai.provider.name": normalizeDiagnosticValue(evt.provider),
      "gen_ai.request.model": normalizeDiagnosticValue(evt.model),
      ...(errorType ? { "error.type": errorType } : {}),
    });
    if (!runtime.tracesEnabled) {
      return;
    }
    const spanAttrs: Record<string, string | number | boolean> = {
      "omnipolymath.provider": evt.provider,
      "omnipolymath.model": evt.model,
      ...(errorType !== undefined
        ? { "omnipolymath.errorCategory": errorType, "error.type": errorType }
        : {}),
    };
    runtime.addRunAttrs(spanAttrs, evt);
    if (evt.type === "model.call.error" && evt.failureKind) {
      spanAttrs["omnipolymath.failureKind"] = normalizeDiagnosticValue(evt.failureKind, "other");
    }
    assignGenAiModelCallAttrs(spanAttrs, evt);
    if (evt.api) {
      spanAttrs["omnipolymath.api"] = evt.api;
    }
    if (evt.transport) {
      spanAttrs["omnipolymath.transport"] = evt.transport;
    }
    for (const [key, value] of [
      ["omnipolymath.model_call.request_bytes", evt.requestPayloadBytes],
      ["omnipolymath.model_call.response_bytes", evt.responseStreamBytes],
      ["omnipolymath.model_call.time_to_first_byte_ms", evt.timeToFirstByteMs],
    ] as const) {
      assignPositiveNumberAttr(spanAttrs, key, value);
    }
    assignModelCallPromptStatsAttrs(spanAttrs, evt);
    assignModelCallUsageAttrs(spanAttrs, evt);
    assignOtelModelContentAttributes(spanAttrs, modelContent, runtime.captureContent);
    const span =
      runtime.takeTrackedTrustedSpan(evt, metadata) ??
      runtime.spanWithDuration(modelCallSpanName(evt), spanAttrs, evt.durationMs, {
        kind: SpanKind.CLIENT,
        parentContext: runtime.activeTrustedParentContext(evt, metadata),
        endTimeMs: evt.ts,
      });
    runtime.setSpanAttrs(span, spanAttrs);
    addUpstreamRequestIdSpanEvent(span, evt.upstreamRequestIdHash);
    if (evt.type === "model.call.error") {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: redactSensitiveText(evt.errorCategory),
      });
    }
    span.end(evt.ts);
  }

  return {
    "model.response.observed"(evt, metadata) {
      if (!runtime.tracesEnabled || !metadata.trusted) {
        return;
      }
      const span = runtime.getTrackedInternalOrTrustedSpan(evt, metadata);
      if (!span) {
        return;
      }
      const attrs: Record<string, string | number | boolean> = {
        "omnipolymath.upstreamRequestIdHash": evt.upstreamRequestIdHash,
        "omnipolymath.model_response.timestamp_source": evt.timestampSource,
        "omnipolymath.model_response.usage_source": evt.usageSource,
        "omnipolymath.model_response.usage_scope": evt.usageScope,
      };
      assignModelResponseUsageAttrs(attrs, evt);
      // A response receipt is an event on its turn, not a timed provider request.
      span.addEvent("omnipolymath.model.response.observed", redactOtelAttributes(attrs), evt.ts);
    },
    "model.call.started"(evt, metadata) {
      if (!runtime.tracesEnabled || !metadata.trusted) {
        return;
      }
      if (runtime.getTrackedInternalOrTrustedSpan(evt, metadata)) {
        return;
      }
      const spanAttrs: Record<string, string | number | boolean> = {
        "omnipolymath.provider": evt.provider,
        "omnipolymath.model": evt.model,
      };
      runtime.addRunAttrs(spanAttrs, evt);
      assignGenAiModelCallAttrs(spanAttrs, evt);
      if (evt.api) {
        spanAttrs["omnipolymath.api"] = evt.api;
      }
      if (evt.transport) {
        spanAttrs["omnipolymath.transport"] = evt.transport;
      }
      assignModelCallPromptStatsAttrs(spanAttrs, evt);
      runtime.trackInternalOrTrustedSpan(
        evt,
        metadata,
        runtime.spanWithDuration(modelCallSpanName(evt), spanAttrs, undefined, {
          kind: SpanKind.CLIENT,
          parentContext: runtime.activeTrustedParentContext(evt, metadata),
          startTimeMs: evt.ts,
        }),
      );
    },
    "model.call.completed": recordModelCallFinished,
    "model.call.error": recordModelCallFinished,
  } satisfies DiagnosticHandlers;
}
