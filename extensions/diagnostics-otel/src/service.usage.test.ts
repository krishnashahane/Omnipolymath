import {
  emitTrustedDiagnosticEvent,
  waitForDiagnosticEventsDrained,
} from "omnipolymath/plugin-sdk/diagnostic-runtime";
import { expect, test } from "vitest";
import {
  collectTestMetrics,
  installRealOtelSdkTestHarness,
  installTestMeter,
} from "./service.real-sdk.test-support.js";
import { startOtelService } from "./service.test-helpers.js";

const sdk = installRealOtelSdkTestHarness();

test.each(["available", "unavailable"] as const)(
  "preserves %s auxiliary accounting without inventing token observations",
  async (state) => {
    const { reader } = installTestMeter();
    await startOtelService({ traces: true, metrics: true });
    emitTrustedDiagnosticEvent({
      type: "model.usage",
      provider: "fixture",
      model: "fixture-model",
      purpose: "session-activity-summary",
      usageReport: { state },
      usage: state === "available" ? { input: 0, output: 0, total: 0 } : {},
      durationMs: 25,
    });
    await waitForDiagnosticEventsDrained();
    const spans = sdk.exporter
      .getFinishedSpans()
      .filter((span) => span.name === "omnipolymath.model.usage");
    expect(spans).toHaveLength(1);
    const attrs = spans[0]!.attributes;
    expect.soft(attrs).toMatchObject({ "omnipolymath.usage.state": state });
    if (state === "available") {
      expect(attrs).toMatchObject({
        "omnipolymath.tokens.input": 0,
        "omnipolymath.tokens.output": 0,
        "omnipolymath.tokens.total": 0,
      });
    } else {
      expect(
        Object.keys(attrs).filter(
          (key) => key.startsWith("omnipolymath.tokens.") || key.startsWith("gen_ai.usage."),
        ),
      ).toEqual([]);
    }
    const metrics = await collectTestMetrics(reader, "omnipolymath.");
    expect(metrics.find((metric) => metric.descriptor.name === "omnipolymath.tokens")).toBeUndefined();
    expect(
      metrics.find((metric) => metric.descriptor.name === "omnipolymath.cost.usd"),
    ).toBeUndefined();
    expect(
      metrics.find((metric) => metric.descriptor.name === "omnipolymath.run.duration_ms")?.dataPoints,
    ).toMatchObject([{ value: { count: 1, sum: 25 } }]);
  },
);
