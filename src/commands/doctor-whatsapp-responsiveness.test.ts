import { beforeEach, expect, it, vi } from "vitest";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { GatewayEventLoopHealth } from "../gateway/server/event-loop-health.js";

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const { mockNodeChildProcessSpawnSync } = await import("omnipolymath/plugin-sdk/test-node-mocks");
  return mockNodeChildProcessSpawnSync(spawnSyncMock, () =>
    vi.importActual<typeof import("node:child_process")>("node:child_process"),
  );
});

const { collectWhatsappResponsivenessHealthFindings } =
  await import("./doctor-whatsapp-responsiveness.js");

const cfg: OmnipolymathConfig = { channels: { whatsapp: { enabled: true } } };
const cpuPressure: GatewayEventLoopHealth = {
  degraded: true,
  degradedSinceMs: 0,
  reasons: ["cpu"],
  intervalMs: 1_000,
  delayP99Ms: 40,
  delayMaxMs: 40,
  utilization: 0.04,
  cpuCoreRatio: 2,
};
const localTuis = () => [{ pid: 101, command: "omnipolymath-tui --profile another-profile" }];
const pressured = { cfg, status: { eventLoop: cpuPressure }, listLocalTuiProcesses: localTuis };

beforeEach(() => vi.clearAllMocks());

it("detects local TUI commands through the advisory finding", () => {
  spawnSyncMock.mockReturnValue({
    status: 0,
    stdout: [
      " 101 omnipolymath-tui",
      " 102 /usr/bin/node /usr/lib/node_modules/omnipolymath/dist/index.js gateway --port 18789",
      " 103 omnipolymath channels",
      " 104 omnipolymath tui --local",
      " 105 /usr/bin/omnipolymath chat",
      " 106 helper --note 'omnipolymath tui'",
      " 107 omnipolymath-helper omnipolymath terminal",
      " 108 omnipolymath --flag tui",
    ].join("\n"),
  });
  const findings = collectWhatsappResponsivenessHealthFindings({
    cfg,
    status: { eventLoop: cpuPressure },
  });

  if (process.platform === "win32") {
    expect(findings).toEqual([]);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  } else {
    expect(findings).toEqual([expect.objectContaining({ target: "101, 104, 105" })]);
    expect(spawnSyncMock).toHaveBeenCalledWith("ps", ["-axo", "pid=,command="], {
      encoding: "utf8",
      killSignal: "SIGKILL",
      timeout: 1_000,
    });
  }
});

it("keeps pressure advice factual and actionable", () => {
  const findings = collectWhatsappResponsivenessHealthFindings(pressured);
  expect(findings).toEqual([
    expect.objectContaining({
      checkId: "core/doctor/whatsapp-responsiveness",
      severity: "warning",
      path: "channels.whatsapp",
      target: "101",
      requirement: "local-tui-event-loop-pressure",
      message:
        "Gateway reports pressure, and local TUI clients were detected. This snapshot does not identify the source of the pressure.",
      fixHint:
        "Inspect Gateway diagnostics with omnipolymath gateway diagnostics export before deciding whether to close clients.",
    }),
  ]);
});

it.each([
  { name: "missing status during maintenance", status: undefined },
  {
    name: "healthy Gateway",
    status: { eventLoop: { ...cpuPressure, degraded: false, reasons: [] } },
  },
  {
    name: "WhatsApp disabled",
    cfg: { channels: { whatsapp: { enabled: false } } },
  },
  { name: "no local TUI", listLocalTuiProcesses: () => [] },
])("stays quiet with $name", ({ name: _name, ...overrides }) => {
  const params = { ...pressured, ...overrides };
  expect(collectWhatsappResponsivenessHealthFindings(params)).toEqual([]);
  expect(spawnSyncMock).not.toHaveBeenCalled();
});
