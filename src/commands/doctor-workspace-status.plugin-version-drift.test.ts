import { expect, it, vi } from "vitest";
import type {
  PluginVersionDriftReport,
  PluginVersionRestartReadiness,
} from "../plugins/plugin-version-drift.js";
import { collectWorkspaceStatusHealthFindings } from "./doctor-workspace-status.js";

vi.mock("../agents/agent-scope.js", () => ({
  listAgentIds: () => [],
  resolveAgentWorkspaceDir: () => {
    throw new Error("plugin drift evidence must not inspect agent workspaces");
  },
  tryResolveDefaultAgentId: () => undefined,
}));
vi.mock("../plugins/status.js", () => ({
  buildPluginCompatibilityWarnings: () => {
    throw new Error("plugin drift evidence must not use compatibility warnings");
  },
  buildPluginRegistrySnapshotReport: () => {
    throw new Error("plugin drift evidence must not use registry diagnostics");
  },
}));

function findings(pluginVersionReadiness: PluginVersionRestartReadiness) {
  return collectWorkspaceStatusHealthFindings({}, { pluginVersionReadiness });
}

it("reports unresolved restart readiness", () => {
  expect(
    findings({ status: "unresolved", reason: "Gateway service package version is unavailable." }),
  ).toEqual([
    expect.objectContaining({
      requirement: "plugin-version-restart-readiness",
      message: expect.stringContaining("Gateway service package version is unavailable"),
    }),
  ]);
});

it.each([
  ["2026.5.30", "plugin-version-gateway-restart"],
  ["2026.6.1-1", undefined],
] as const)(
  "reports restart readiness for running Gateway %s",
  (runningGatewayVersion, requirement) => {
    const result = findings({
      status: "resolved",
      runningGatewayVersion,
      report: { gatewayVersion: "2026.6.1", drifts: [] },
    });
    expect(result).toEqual(
      requirement
        ? [
            expect.objectContaining({
              requirement,
              message: expect.stringContaining("running Gateway is 2026.5.30"),
              fixHint: "omnipolymath gateway restart",
            }),
          ]
        : [],
    );
  },
);

type Drift = PluginVersionDriftReport["drifts"][number];
const gatewayVersion = "2026.9.4";
const packageName = "@omnipolymath/whatsapp";
const target = { packageName, requestedTarget: gatewayVersion };
function report(source: Drift["source"], targetResolution: Drift["targetResolution"]) {
  return findings({
    status: "resolved",
    report: {
      gatewayVersion,
      drifts: [
        {
          pluginId: "whatsapp",
          installedVersion:
            targetResolution?.status === "registry-current" ? targetResolution.version : "2026.9.2",
          gatewayVersion,
          source,
          packageName,
          spec: source === "npm" ? "@omnipolymath/whatsapp@2026.9.2" : "clawhub:@omnipolymath/whatsapp",
          targetResolution,
        },
      ],
    },
  });
}

// Detection, correction cohorts, and registry compatibility belong to plugin-version-drift.test.ts.
it.each(["npm", "clawhub"] as const)("renders confirmed %s repair targets", (source) => {
  expect(report(source, { ...target, status: "resolved", version: gatewayVersion })).toEqual([
    expect.objectContaining({
      severity: "warning",
      requirement: "plugin-version-drift",
      path: "plugins.entries.whatsapp",
      target: "whatsapp",
      message: expect.stringContaining("confirmed plugin target is 2026.9.4"),
      fixHint:
        source === "npm"
          ? "omnipolymath plugins update @omnipolymath/whatsapp@2026.9.4 && omnipolymath gateway restart"
          : "omnipolymath plugins update whatsapp && omnipolymath gateway restart",
    }),
  ]);
});

it("explains registry lag without offering an unavailable update", () => {
  const result = report("clawhub", { ...target, status: "registry-current", version: "2026.9.3" });
  expect(result).toHaveLength(1);
  expect(result[0]?.severity).toBe("info");
  expect(result[0]?.message).toContain("registry version 2026.9.3");
  expect(result[0]?.message).toContain("No plugin update can reach 2026.9.4");
  expect(result[0]?.fixHint).toContain("No plugin repair is available");
});

it("reports incompatible targets without an install command", () => {
  const result = report("clawhub", {
    ...target,
    status: "unresolved",
    error: "requires plugin API >=2026.10.1",
  });
  expect(result).toHaveLength(1);
  expect(result[0]?.message).toContain("requires plugin API >=2026.10.1");
  expect(result[0]?.fixHint).not.toContain("omnipolymath plugins update");
});
