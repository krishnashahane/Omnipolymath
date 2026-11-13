import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { createOmnipolymathCodingTools } from "../../../../src/agents/agent-tools.js";
import { resolveAttemptWorkspaceSandbox } from "../../../../src/agents/workspace-sandbox.js";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../../../src/config/runtime-snapshot.js";
import type { AgentSandboxConfig } from "../../../../src/config/types.agents-shared.js";
import type { OmnipolymathConfig } from "../../../../src/config/types.omnipolymath.js";
import { captureEnv, setTestEnvValue } from "../../../../src/test-utils/env.js";

afterEach(clearRuntimeConfigSnapshot);

test("host:auto executes inside the resolved Docker sandbox", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omnipolymath-sandboxed-exec-"));
  const workspaceDir = path.join(root, "workspace");
  const outsideDir = path.join(root, "host-only");
  const outsideScript = path.join(outsideDir, "must-not-run.sh");
  const outsideMarker = path.join(outsideDir, "executed.txt");
  const env = captureEnv(["OMNIPOLYMATH_STATE_DIR"]);
  let runtimeId: string | undefined;

  await fs.mkdir(path.join(workspaceDir, ".omnipolymath", "sandbox-skills", "skills"), {
    recursive: true,
  });
  await fs.mkdir(outsideDir, { recursive: true });
  await fs.writeFile(
    outsideScript,
    `#!/bin/sh\nprintf executed > ${JSON.stringify(outsideMarker)}\n`,
    { mode: 0o755 },
  );
  setTestEnvValue("OMNIPOLYMATH_STATE_DIR", path.join(root, "state"));

  try {
    const sessionId = randomUUID();
    const sessionKey = `agent:sandboxed-exec:qa:${sessionId}`;
    const execPolicy = { host: "auto", security: "full", ask: "off" } as const;
    const sandbox: AgentSandboxConfig = {
      mode: "all",
      backend: "docker",
      scope: "session",
      workspaceAccess: "rw",
      workspaceRoot: path.join(root, "sandboxes"),
      docker: {
        image: process.env.OMNIPOLYMATH_SANDBOX_TEST_IMAGE ?? "omnipolymath-sandbox:trixie-slim",
        containerPrefix: `oc-qa-exec-${process.pid}-`,
      },
      browser: { enabled: false },
      prune: { idleHours: 0, maxAgeDays: 0 },
    };
    const config: OmnipolymathConfig = {
      agents: { defaults: { skipBootstrap: true, sandbox } },
      tools: { exec: execPolicy },
    };
    setRuntimeConfigSnapshot(config);
    const workspace = await resolveAttemptWorkspaceSandbox({
      agentId: "sandboxed-exec",
      config,
      sessionId,
      sessionKey,
      workspaceDir,
    });
    assert(workspace.sandbox, "expected a provisioned Docker sandbox");
    runtimeId = workspace.sandbox.runtimeId;

    const exec = createOmnipolymathCodingTools({
      agentId: workspace.sessionAgentId,
      config,
      cwd: workspace.effectiveCwd,
      exec: execPolicy,
      sandbox: workspace.sandbox,
      sessionId,
      sessionKey,
      workspaceDir: workspace.effectiveWorkspace,
    }).find((tool) => tool.name === "exec");
    assert(exec, "exec tool missing from sandboxed agent surface");

    const result = await exec.execute("sandboxed-exec", {
      command: [
        'if [ -x "$OUTSIDE_SCRIPT" ]; then "$OUTSIDE_SCRIPT"; exit 41; fi',
        'test ! -e "$OUTSIDE_SCRIPT"',
        "test -f /.dockerenv",
        "grep -Eq ' /workspace ' /proc/self/mountinfo",
        "printf 'sandbox-ok\\n' > /workspace/container-marker.txt",
        "printf 'sandbox-ok\\n'",
      ].join(" && "),
      env: { OUTSIDE_SCRIPT: outsideScript },
      host: "auto",
      yieldMs: 120_000,
    });

    expect(result.details).toMatchObject({
      status: "completed",
      exitCode: 0,
      aggregated: expect.stringContaining("sandbox-ok"),
    });
    await expect(
      fs.readFile(path.join(workspaceDir, "container-marker.txt"), "utf8"),
    ).resolves.toBe("sandbox-ok\n");
    await expect(fs.access(outsideMarker)).rejects.toThrow();
    await expect(fs.readFile(outsideScript, "utf8")).resolves.toContain("printf executed");
  } finally {
    if (runtimeId) {
      const [{ removeSandboxContainer }, { execDocker }] = await Promise.all([
        import("../../../../src/agents/sandbox/manage.js"),
        import("../../../../src/agents/sandbox/docker.js"),
      ]);
      await removeSandboxContainer(runtimeId);
      await execDocker(["rm", "-f", runtimeId], { allowFailure: true });
    }
    env.restore();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 120_000);
