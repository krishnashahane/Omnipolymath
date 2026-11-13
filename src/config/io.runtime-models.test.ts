import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { resetModelsJsonReadyCacheForTest } from "../agents/models-config-state.test-support.js";
import { CUSTOM_PROXY_MODELS_CONFIG } from "../agents/models-config.e2e-harness.js";
import { ensureOmnipolymathModelsJson } from "../agents/models-config.js";
import {
  clearRuntimeConfigSnapshot,
  getRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/runtime-snapshot.js";
import { createPluginCache, withPluginCache } from "../plugins/plugin-cache.js";
import { closeOmnipolymathAgentDatabasesForTest } from "../state/omnipolymath-agent-db.js";
import { closeOmnipolymathStateDatabaseAsync } from "../state/omnipolymath-state-db.js";
import {
  makeProvenancePlan,
  seedLegacyTemplateInstall,
} from "../templates/provenance.test-helpers.js";
import { resolveTemplateToolPolicyConsent } from "../templates/tool-policy-runtime.js";

const dirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    vi.restoreAllMocks();
    closeOmnipolymathAgentDatabasesForTest();
    await closeOmnipolymathStateDatabaseAsync();
    clearRuntimeConfigSnapshot();
    resetModelsJsonReadyCacheForTest();
    vi.unstubAllEnvs();
    cleanup();
  }),
);

async function fixture() {
  const home = dirs.make("models-cold-runtime-");
  const state = path.join(home, "state");
  const bundled = path.join(home, "bundled");
  await fs.mkdir(bundled);
  for (const [key, value] of Object.entries({
    HOME: home,
    OMNIPOLYMATH_HOME: undefined,
    OMNIPOLYMATH_STATE_DIR: state,
    OMNIPOLYMATH_CONFIG_PATH: undefined,
    OMNIPOLYMATH_PROFILE: undefined,
    OMNIPOLYMATH_AGENT_DIR: undefined,
    OMNIPOLYMATH_BUNDLED_PLUGINS_DIR: bundled,
    OMNIPOLYMATH_LOAD_SHELL_ENV: undefined,
  })) {
    vi.stubEnv(key, value);
  }
  const { plan } = await makeProvenancePlan(home, {
    schemaVersion: 1,
    agent: { id: "worker", tools: { allow: ["read"] } },
  });
  seedLegacyTemplateInstall(plan, { env: process.env });
  const { id, ...agent } = plan.agent.config;
  const config = {
    ...CUSTOM_PROXY_MODELS_CONFIG,
    agents: { entries: { [id]: agent } },
  };
  await fs.writeFile(path.join(state, "omnipolymath.json"), JSON.stringify(config));
  await closeOmnipolymathStateDatabaseAsync();
  clearRuntimeConfigSnapshot();
  const agentDir = path.join(state, "agents", "worker", "agent");
  return { config, agentDir, state };
}

const readModels = async (dir: string) =>
  JSON.parse(await fs.readFile(path.join(dir, "models.json"), "utf8"));

it("loads cold config and Template consent without host provenance SQL", async () => {
  const { agentDir } = await fixture();
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  const contents = await withPluginCache(createPluginCache(), async () => {
    await ensureOmnipolymathModelsJson(undefined, agentDir);
    return readModels(agentDir);
  });
  expect(contents).toEqual({
    providers: CUSTOM_PROXY_MODELS_CONFIG.models?.providers,
  });
  const tools = getRuntimeConfigSnapshot()?.agents?.entries?.worker?.tools;
  expect(
    resolveTemplateToolPolicyConsent({
      agentTools: tools,
      agentId: "worker",
      hasAgentAllowlist: true,
      ownsProfile: true,
      profile: "full",
    }),
  ).toEqual({ frozen: true });
  expect(prepare.mock.calls.filter(([sql]) => /from\s+"?template_installs/i.test(sql))).toEqual([]);
});

it("keeps source secret markers when the same runtime is republished before continuation", async () => {
  const { config, agentDir } = await fixture();
  const provider = CUSTOM_PROXY_MODELS_CONFIG.models!.providers!["custom-proxy"]!;
  const sourceFor = (id: string) => {
    const apiKey = { source: "env" as const, provider: "default", id };
    return { ...config, models: { providers: { "custom-proxy": { ...provider, apiKey } } } };
  };
  setRuntimeConfigSnapshot(config, sourceFor("MODEL_ORIGINAL_KEY"));
  const pending = ensureOmnipolymathModelsJson(undefined, agentDir);
  setRuntimeConfigSnapshot(config, sourceFor("MODEL_REPLACEMENT_KEY"));
  await pending;
  expect((await readModels(agentDir)).providers["custom-proxy"].apiKey).toBe("MODEL_ORIGINAL_KEY");
});

it("retains the pinned model directory after an environment change", async () => {
  const { config, agentDir, state } = await fixture();
  setRuntimeConfigSnapshot(config);
  const pending = ensureOmnipolymathModelsJson();
  vi.stubEnv("OMNIPOLYMATH_STATE_DIR", path.join(state, "replacement-state"));
  await pending;
  expect(await readModels(agentDir)).toEqual({ providers: config.models?.providers });
  const replacementAgentDir = path.join(state, "replacement-state", "agents", "worker", "agent");
  await expect(fs.access(path.join(replacementAgentDir, "models.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
