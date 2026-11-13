import type { CreateSandboxBackendParams } from "omnipolymath/plugin-sdk/sandbox";
import {
  createSandboxBrowserConfig,
  createSandboxPruneConfig,
  createSandboxSshConfig,
} from "omnipolymath/plugin-sdk/test-fixtures";

export function createOpenShellBackendSandboxConfig(): CreateSandboxBackendParams["cfg"] {
  return {
    mode: "all",
    backend: "openshell",
    scope: "session",
    workspaceAccess: "rw",
    workspaceRoot: "/tmp/omnipolymath-sandboxes",
    dockerTmpfsSource: "configured",
    docker: {
      image: "omnipolymath-sandbox:bookworm-slim",
      containerPrefix: "omnipolymath-sbx-",
      workdir: "/workspace",
      readOnlyRoot: false,
      tmpfs: [],
      network: "none",
      capDrop: [],
      binds: [],
      env: {},
    },
    ssh: createSandboxSshConfig("/tmp/omnipolymath-sandboxes"),
    browser: createSandboxBrowserConfig(),
    tools: { allow: ["*"], deny: [] },
    prune: createSandboxPruneConfig(),
  };
}

export function createOpenShellRuntimeEntryFixture(runtimeId: string, configLabel = "omnipolymath") {
  return {
    containerName: runtimeId,
    backendId: "openshell",
    runtimeLabel: runtimeId,
    sessionKey: "agent:main",
    createdAtMs: 1,
    lastUsedAtMs: 1,
    image: configLabel,
    configLabelKind: "Source",
  } as const;
}
