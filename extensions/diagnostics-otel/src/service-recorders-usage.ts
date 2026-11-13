import { SpanStatusCode } from "@opentelemetry/api";
import { normalizeDiagnosticValue } from "omnipolymath/plugin-sdk/diagnostic-runtime";
import type {
  DiagnosticEventMetadata,
  DiagnosticEventPayload,
} from "omnipolymath/plugin-sdk/diagnostic-runtime";
import { redactSensitiveText } from "omnipolymath/plugin-sdk/security-runtime";
import { assignOtelContentAttr } from "./service-content-normalization.js";
import type { DiagnosticHandlers } from "./service-events.js";
import {
  assignGenAiSpanIdentityAttrs,
  assignPositiveNumberAttr,
} from "./service-genai-attributes.js";
import type { DiagnosticsRecorderRuntime } from "./service-recorder-runtime.js";
import type { MessageDeliveryDiagnosticEvent } from "./service-types.js";

export function createUsageRecorders(runtime: DiagnosticsRecorderRuntime) {
  const messageDeliveryAttrs = (evt: MessageDeliveryDiagnosticEvent): Record<string, string> => ({
    "omnipolymath.channel": normalizeDiagnosticValue(evt.channel),
    "omnipolymath.delivery.kind": normalizeDiagnosticValue(evt.deliveryKind, "other"),
  });

  function recordMessageDeliveryFinished(
    evt: Extract<
      DiagnosticEventPayload,
      { type: "message.delivery.completed" | "message.delivery.error" }
    >,
    metadata: DiagnosticEventMetadata,
  ) {
    const attrs = {
      ...messageDeliveryAttrs(evt),
      "omnipolymath.outcome": evt.type === "message.delivery.error" ? "error" : "completed",
      ...(evt.type === "message.delivery.error"
        ? { "omnipolymath.errorCategory": normalizeDiagnosticValue(evt.errorCategory, "other") }
        : {}),
    };
    runtime.messageDeliveryDurationHistogram.record(evt.durationMs, attrs);
    if (!runtime.tracesEnabled) {
      return;
    }
    const span = runtime.spanWithDuration(
      "omnipolymath.message.delivery",
      {
        ...attrs,
        ...(evt.type === "message.delivery.completed"
          ? { "omnipolymath.delivery.result_count": evt.resultCount }
          : {}),
      },
      evt.durationMs,
      { parentContext: runtime.activeInternalOrTrustedContext(evt, metadata), endTimeMs: evt.ts },
    );
    if (evt.type === "message.delivery.error") {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: redactSensitiveText(evt.errorCategory),
      });
    }
    span.end(evt.ts);
  }

  return {
    "model.usage"(evt, metadata, { hostPluginId }) {
      const attrs = {
        "omnipolymath.channel": evt.channel ?? "unknown",
        "omnipolymath.agent": normalizeDiagnosticValue(evt.agentId),
        "omnipolymath.provider": evt.provider ?? "unknown",
        "omnipolymath.model": evt.model ?? "unknown",
        ...(evt.purpose ? { "omnipolymath.purpose": evt.purpose } : {}),
        ...(evt.runtimeKind ? { "omnipolymath.runtime.kind": evt.runtimeKind } : {}),
      };
      const genAiAttrs: Record<string, string> = {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": normalizeDiagnosticValue(evt.provider),
        "gen_ai.request.model": normalizeDiagnosticValue(evt.model),
      };

      const unavailable = evt.usageReport?.state === "unavailable";
      const usage: typeof evt.usage = unavailable ? {} : evt.usage;
      for (const [tokenType, field] of [
        ["input", "input"],
        ["output", "output"],
        ["cache_read", "cacheRead"],
        ["cache_write", "cacheWrite"],
        ["prompt", "promptTokens"],
        ["total", "total"],
      ] as const) {
        const amount = usage[field];
        if (!amount) {
          continue;
        }
        runtime.tokensCounter.add(amount, { ...attrs, "omnipolymath.token": tokenType });
        if (tokenType === "input" || tokenType === "output") {
          runtime.genAiTokenUsageHistogram.record(amount, {
            ...genAiAttrs,
            "gen_ai.token.type": tokenType,
          });
        }
      }

      if (!unavailable && evt.costUsd) {
        runtime.costCounter.add(evt.costUsd, attrs);
      }
      if (evt.durationMs) {
        runtime.durationHistogram.record(evt.durationMs, attrs);
      }
      for (const kind of ["limit", "used"] as const) {
        const amount = evt.context?.[kind];
        if (amount) {
          runtime.contextHistogram.record(amount, { ...attrs, "omnipolymath.context": kind });
        }
      }

      if (!runtime.tracesEnabled) {
        return;
      }
      const genAiInputTokens = unavailable
        ? undefined
        : (usage.promptTokens ??
          (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0));
      const spanAttrs: Record<string, string | number> = {
        ...attrs,
        ...(evt.usageReport ? { "omnipolymath.usage.state": evt.usageReport.state } : {}),
        // Missing accounting is not a measured zero, including an aborted auxiliary attempt.
        ...(!unavailable
          ? {
              "omnipolymath.tokens.input": usage.input ?? 0,
              "omnipolymath.tokens.output": usage.output ?? 0,
              "omnipolymath.tokens.cache_read": usage.cacheRead ?? 0,
              "omnipolymath.tokens.cache_write": usage.cacheWrite ?? 0,
              "omnipolymath.tokens.total": usage.total ?? 0,
            }
          : {}),
      };
      if (metadata.trusted && metadata.internal && hostPluginId) {
        spanAttrs["omnipolymath.plugin"] = normalizeDiagnosticValue(hostPluginId);
      }
      assignGenAiSpanIdentityAttrs(spanAttrs, evt);
      runtime.addRunAttrs(spanAttrs, evt);
      assignPositiveNumberAttr(spanAttrs, "gen_ai.usage.input_tokens", genAiInputTokens);
      assignPositiveNumberAttr(spanAttrs, "gen_ai.usage.output_tokens", usage.output);
      assignPositiveNumberAttr(spanAttrs, "gen_ai.usage.cache_read.input_tokens", usage.cacheRead);
      assignPositiveNumberAttr(
        spanAttrs,
        "gen_ai.usage.cache_creation.input_tokens",
        usage.cacheWrite,
      );

      const span = runtime.spanWithDuration("omnipolymath.model.usage", spanAttrs, evt.durationMs, {
        parentContext: runtime.activeTrustedParentContext(evt, metadata),
        endTimeMs: evt.ts,
      });
      span.end(evt.ts);
    },
    "webhook.received"(evt) {
      const attrs = {
        "omnipolymath.channel": evt.channel ?? "unknown",
        "omnipolymath.webhook": evt.updateType ?? "unknown",
      };
      runtime.webhookReceivedCounter.add(1, attrs);
    },
    "webhook.processed"(evt) {
      const attrs = {
        "omnipolymath.channel": normalizeDiagnosticValue(evt.channel),
        "omnipolymath.webhook": normalizeDiagnosticValue(evt.updateType),
      };
      if (typeof evt.durationMs === "number") {
        runtime.webhookDurationHistogram.record(evt.durationMs, attrs);
      }
      if (!runtime.tracesEnabled) {
        return;
      }
      const spanAttrs: Record<string, string | number> = { ...attrs };
      const span = runtime.spanWithDuration(
        "omnipolymath.webhook.processed",
        spanAttrs,
        evt.durationMs,
      );
      span.end();
    },
    "webhook.error"(evt) {
      const attrs = {
        "omnipolymath.channel": normalizeDiagnosticValue(evt.channel),
        "omnipolymath.webhook": normalizeDiagnosticValue(evt.updateType),
      };
      runtime.webhookErrorCounter.add(1, attrs);
      if (!runtime.tracesEnabled) {
        return;
      }
      const redactedError = redactSensitiveText(evt.error);
      const spanAttrs: Record<string, string | number> = {
        ...attrs,
        "omnipolymath.error": redactedError,
      };
      const span = runtime.tracer.startSpan("omnipolymath.webhook.error", {
        attributes: spanAttrs,
      });
      span.setStatus({ code: SpanStatusCode.ERROR, message: redactedError });
      span.end();
    },
    "message.queued"(evt) {
      const attrs = {
        "omnipolymath.channel": normalizeDiagnosticValue(evt.channel),
        "omnipolymath.source": normalizeDiagnosticValue(evt.source),
      };
      runtime.messageQueuedCounter.add(1, attrs);
      if (typeof evt.queueDepth === "number") {
        runtime.queueDepthHistogram.record(evt.queueDepth, attrs);
      }
    },
    "message.received"(evt) {
      runtime.messageReceivedCounter.add(1, {
        "omnipolymath.channel": normalizeDiagnosticValue(evt.channel),
        "omnipolymath.source": normalizeDiagnosticValue(evt.source),
      });
    },
    "message.dispatch.started"(evt, metadata) {
      const attrs = {
        "omnipolymath.channel": normalizeDiagnosticValue(evt.channel),
        "omnipolymath.source": normalizeDiagnosticValue(evt.source),
      };
      runtime.messageDispatchStartedCounter.add(1, attrs);
      if (!runtime.tracesEnabled) {
        return;
      }
      const traceContext = runtime.internalOrTrustedTraceContext(evt, metadata);
      if (!traceContext?.spanId || runtime.activeTrustedSpans.has(traceContext.spanId)) {
        return;
      }
      // Core-logged dispatch events are untrusted and stop at the guard above, so
      // the ordinary message span is created by the terminal message.processed
      // event, which stamps session identity there. Never mutate `attrs` here:
      // the metrics SDK retains the object passed to add().
      runtime.trackInternalOrTrustedSpan(
        evt,
        metadata,
        runtime.spanWithDuration("omnipolymath.message.processed", attrs, undefined, {
          parentContext: runtime.internalOrTrustedExplicitParentContext(evt, metadata),
          startTimeMs: evt.ts,
        }),
      );
    },
    "message.dispatch.completed"(evt) {
      const attrs = {
        "omnipolymath.channel": normalizeDiagnosticValue(evt.channel),
        "omnipolymath.outcome": evt.outcome,
        "omnipolymath.reason": normalizeDiagnosticValue(evt.reason, "none"),
        "omnipolymath.source": normalizeDiagnosticValue(evt.source),
      };
      runtime.messageDispatchCompletedCounter.add(1, attrs);
      runtime.messageDispatchDurationHistogram.record(evt.durationMs, attrs);
    },
    "message.processed"(evt, metadata, privateData) {
      const attrs = {
        "omnipolymath.channel": normalizeDiagnosticValue(evt.channel),
        "omnipolymath.outcome": evt.outcome ?? "unknown",
      };
      runtime.messageProcessedCounter.add(1, attrs);
      if (typeof evt.durationMs === "number") {
        runtime.messageDurationHistogram.record(evt.durationMs, attrs);
      }
      if (!runtime.tracesEnabled) {
        return;
      }
      const spanAttrs: Record<string, string | number> = { ...attrs };
      runtime.addRunAttrs(spanAttrs, evt);
      if (evt.reason) {
        spanAttrs["omnipolymath.reason"] = normalizeDiagnosticValue(evt.reason, "unknown");
      }
      if (runtime.captureContent) {
        assignOtelContentAttr(spanAttrs, "input.value", privateData.messageContent?.userPrompt);
        assignOtelContentAttr(spanAttrs, "output.value", privateData.messageContent?.finalResponse);
      }
      const trackedSpan = runtime.getTrackedInternalOrTrustedSpan(evt, metadata);
      const span =
        trackedSpan ??
        runtime.spanWithDuration("omnipolymath.message.processed", spanAttrs, evt.durationMs, {
          parentContext: runtime.internalOrTrustedExplicitParentContext(evt, metadata),
          endTimeMs: evt.ts,
        });
      runtime.setSpanAttrs(span, spanAttrs);
      if (evt.outcome === "error" && evt.error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: redactSensitiveText(evt.error) });
      }
      const traceContext = runtime.internalOrTrustedTraceContext(evt, metadata);
      runtime.completeTrackedLifecycleSpan(trackedSpan ? traceContext : undefined, span, evt.ts);
    },
    "message.delivery.started"(evt) {
      runtime.messageDeliveryStartedCounter.add(1, messageDeliveryAttrs(evt));
    },
    "run.started"(evt, metadata) {
      if (!runtime.tracesEnabled || !metadata.trusted) {
        return;
      }
      const spanAttrs: Record<string, string | number | boolean> = {};
      runtime.addRunAttrs(spanAttrs, evt);
      const span = runtime.trackInternalOrTrustedSpan(
        evt,
        metadata,
        runtime.spanWithDuration("omnipolymath.run", spanAttrs, undefined, {
          parentContext: runtime.activeTrustedParentContext(evt, metadata),
          startTimeMs: evt.ts,
        }),
      );
      const parentSpanId = runtime.trustedTraceContext(evt, metadata)?.parentSpanId;
      if (parentSpanId && !runtime.activeTrustedSpans.has(parentSpanId)) {
        const owner = evt.runId;
        runtime.activeTrustedSpanAliases.set(runtime.trustedSpanAliasKey(parentSpanId, owner), {
          span,
          spanId: parentSpanId,
          owner,
        });
      }
    },
    "message.delivery.completed": recordMessageDeliveryFinished,
    "message.delivery.error": recordMessageDeliveryFinished,
  } satisfies DiagnosticHandlers;
}
