import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { withEnvAsync } from "../test-utils/env.js";
import type { AuthProfileStore } from "./auth-profiles.js";
import { resolveEnvApiKey } from "./model-auth-env.js";
import {
  hasAvailableAuthForProvider,
  resolveApiKeyForProviderCore,
  resolveModelAuthMode,
} from "./model-auth.js";
import { createProviderAuthChecker } from "./model-provider-auth.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const evidence = {
  type: "local-file-with-env",
  fileEnvVar: "WORKSPACE_CLOUD_CREDENTIALS",
  credentialMarker: "workspace-cloud-local-credentials",
  source: "workspace cloud credentials",
};

async function writeWorkspaceAuthEvidencePlugin(workspaceDir: string) {
  const pluginDir = path.join(workspaceDir, ".omnipolymath", "extensions", "workspace-cloud");
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.writeFile(path.join(pluginDir, "index.ts"), "export default {}\n", "utf8");
  await fs.writeFile(
    path.join(pluginDir, "omnipolymath.plugin.json"),
    JSON.stringify({
      id: "workspace-cloud",
      configSchema: { type: "object" },
      setup: { providers: [{ id: "workspace-cloud", authEvidence: [evidence] }] },
    }),
    "utf8",
  );
}

it("uses trusted workspace plugin auth evidence across runtime and picker auth checks", async () => {
  const tempRoot = tempDirs.make("omnipolymath-workspace-auth-");
  const workspaceDir = path.join(tempRoot, "workspace");
  const bundledDir = path.join(tempRoot, "bundled");
  const stateDir = path.join(tempRoot, "state");
  const credentialsPath = path.join(tempRoot, "credentials.json");
  await fs.mkdir(bundledDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(credentialsPath, "{}", "utf8");
  await writeWorkspaceAuthEvidencePlugin(workspaceDir);

  const cfg: OmnipolymathConfig = { plugins: { allow: ["workspace-cloud"] } };
  const store: AuthProfileStore = { version: 1, profiles: {} };
  const request = { provider: "workspace-cloud", cfg, workspaceDir, store };
  const expected = { apiKey: evidence.credentialMarker, source: evidence.source };

  await withEnvAsync(
    {
      OMNIPOLYMATH_BUNDLED_PLUGINS_DIR: bundledDir,
      OMNIPOLYMATH_STATE_DIR: stateDir,
      WORKSPACE_CLOUD_CREDENTIALS: credentialsPath,
    },
    async () => {
      expect(resolveEnvApiKey("workspace-cloud", process.env, { config: cfg })).toBeNull();
      expect(
        resolveEnvApiKey(request.provider, process.env, { config: cfg, workspaceDir }),
      ).toEqual(expected);
      await expect(resolveApiKeyForProviderCore(request)).resolves.toEqual({
        ...expected,
        mode: "api-key",
      });
      expect(resolveModelAuthMode("workspace-cloud", cfg, store, { workspaceDir })).toBe("api-key");
      await expect(hasAvailableAuthForProvider(request)).resolves.toBe(true);
      await expect(
        createProviderAuthChecker({
          cfg,
          workspaceDir,
          agentDir: path.join(stateDir, "agent"),
        })("workspace-cloud", { modelId: "fixture-model" }),
      ).resolves.toBe(true);
    },
  );
});
