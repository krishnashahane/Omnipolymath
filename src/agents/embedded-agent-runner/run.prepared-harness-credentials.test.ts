import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import type { OmnipolymathTestState } from "../../test-utils/omnipolymath-test-state.js";
import { completionConfig, completionModelDefinition } from "../simple-completion.test-support.js";
import { makeAttemptResult } from "./run.overflow-compaction.fixture.js";
import {
  loadRunOverflowCompactionHarness,
  mockedBuildEmbeddedRunPayloads,
  mockedGetApiKeyForModel,
  mockedRunEmbeddedAttempt as attempt,
  createOverflowRunParams,
} from "./run.overflow-compaction.harness.js";

let state: OmnipolymathTestState;
let harness: Awaited<ReturnType<typeof loadRunOverflowCompactionHarness>>;
beforeAll(async () => {
  harness = await loadRunOverflowCompactionHarness();
  const modelAuth = await import("../model-auth.js");
  const actual = await vi.importActual<typeof modelAuth>("../model-auth.js");
  vi.mocked(modelAuth.applyAuthHeaderOverride).mockImplementation(actual.applyAuthHeaderOverride);
  vi.mocked(modelAuth.resolveProviderEntryApiKeyProfileReference).mockImplementation(
    actual.resolveProviderEntryApiKeyProfileReference,
  );
  vi.mocked(modelAuth.shouldPreferExplicitConfigApiKeyAuth).mockImplementation(
    actual.shouldPreferExplicitConfigApiKeyAuth,
  );
});
beforeEach(async () => {
  const { createOmnipolymathTestState } = await import("../../test-utils/omnipolymath-test-state.js");
  state = await createOmnipolymathTestState({ label: "run.prepared-harness-credentials" });
  harness.registerPreparedAgentHarness({
    id: "test-byok",
    label: "Test BYOK",
    supports: ({ provider }) =>
      provider === "custom-proof" ? { supported: true, priority: 100 } : { supported: false },
    runAttempt: (params) => attempt(params),
  });
  attempt.mockClear().mockResolvedValue(makeAttemptResult({ assistantTexts: ["OK"] }));
  mockedGetApiKeyForModel.mockClear().mockResolvedValue({
    apiKey: "synthetic-configured-key",
    mode: "api-key",
    source: "models.providers.custom-proof",
  });
  mockedBuildEmbeddedRunPayloads.mockReturnValue([{ text: "OK" }]);
});

afterEach(() => state?.cleanup());

it.each([true, false, undefined])(
  "resolves prepared harness credentials with authHeader=%s (undefined: implicit auth)",
  async (authHeader) => {
    const explicit = authHeader !== undefined;
    const config: OmnipolymathConfig | undefined = explicit
      ? completionConfig("custom-proof", {
          api: "openai-responses",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "synthetic-configured-key",
          authHeader,
          models: [
            completionModelDefinition({
              id: "gpt-5.6-luna",
              name: "Luna",
              reasoning: true,
              contextWindow: 128_000,
              maxTokens: 4096,
            }),
          ],
        })
      : undefined;
    const { setRuntimeConfigSnapshot } = await import("../../config/runtime-snapshot.js");
    setRuntimeConfigSnapshot(config ?? {});
    await harness.runEmbeddedAgent({
      ...createOverflowRunParams(state),
      provider: "custom-proof",
      model: "gpt-5.6-luna",
      config,
    });

    expect(attempt).toHaveBeenCalledOnce();
    expect(attempt.mock.calls[0]?.[0]).toMatchObject({
      agentHarnessId: "test-byok",
      resolvedApiKey: explicit ? "synthetic-configured-key" : undefined,
    });
    expect(attempt.mock.calls[0]?.[0].model.headers).toEqual(
      authHeader ? { Authorization: "Bearer synthetic-configured-key" } : undefined,
    );
    if (explicit) {
      expect(mockedGetApiKeyForModel).toHaveBeenCalledWith(
        expect.objectContaining({ allowAuthProfileFallback: false }),
      );
    } else {
      expect(mockedGetApiKeyForModel).not.toHaveBeenCalled();
    }
  },
);
