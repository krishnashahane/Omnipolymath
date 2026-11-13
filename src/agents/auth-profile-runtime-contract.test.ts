// Attempt composition lives in command/attempt-execution.cli.test.ts; keep this matrix runtime-free.
import {
  AUTH_PROFILE_RUNTIME_CONTRACT as contract,
  createAuthAliasManifestRegistry,
} from "omnipolymath/plugin-sdk/agent-runtime-test-contracts";
import { describe, expect, it } from "vitest";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { configFor } from "./model-auth.fixtures.test-support.js";
import { buildAgentRuntimeAuthPlan } from "./runtime-plan/auth.js";

const workspaceDir = "/tmp/omnipolymath-auth-contract";
const authAliasMetadata = {
  plugins: createAuthAliasManifestRegistry().plugins,
};

function providerRuntimeConfig(provider: string, runtime: string): OmnipolymathConfig {
  return configFor(provider, "https://api.omnipolymath.test/v1", {
    agentRuntime: { id: runtime },
  });
}

describe("Auth profile runtime contract - embedded Omnipolymath and CLI adapter", () => {
  const {
    openAiProvider: openai,
    codexCliProvider: cli,
    openAiCodexProvider: legacy,
    codexHarnessProvider: harness,
    openAiProfileId: profile,
    openAiCodexProfileId: legacyProfile,
  } = contract;
  type PlanOptions = {
    config?: OmnipolymathConfig;
    runtime?: string;
    source?: "user";
    rejected?: boolean;
  };
  const codexConfig = providerRuntimeConfig(openai, "codex");
  const omnipolymath = { config: providerRuntimeConfig(openai, "omnipolymath"), runtime: "omnipolymath" };
  const native = { config: providerRuntimeConfig(harness, "codex"), runtime: "codex" };
  it.each<[string, string, string, PlanOptions?]>([
    [cli, cli, legacyProfile],
    [cli, openai, profile],
    [contract.claudeCliProvider, legacy, legacyProfile, { config: codexConfig, rejected: true }],
    [legacy, legacy, legacyProfile],
    [legacy, cli, legacyProfile],
    [openai, openai, profile, omnipolymath],
    [openai, legacy, legacyProfile, { runtime: "codex" }],
    [harness, legacy, legacyProfile, native],
    [openai, legacy, legacyProfile, { config: codexConfig, runtime: "codex", source: "user" }],
  ])("forwards %s auth from %s profile %s (%j)", (provider, auth, profileId, options = {}) => {
    const plan = buildAgentRuntimeAuthPlan({
      provider,
      authProfileProvider: auth,
      sessionAuthProfileId: profileId,
      sessionAuthProfileSource: options.source,
      config: options.config ?? {},
      metadataSnapshot: authAliasMetadata,
      workspaceDir,
      harnessRuntime: options.runtime,
    });
    expect(plan.providerForAuth).toBe(provider === cli || provider === legacy ? openai : provider);
    expect(plan.forwardedAuthProfileId).toBe(options.rejected ? undefined : profileId);
    if (options.source) {
      expect(plan.forwardedAuthProfileSource).toBe(options.source);
    }
  });
});
