import "../test-utils/prepare-compiled-subprocesses.js";
import { expectDefined } from "@omnipolymath/normalization-core/expect";
import { afterEach, expect, it, vi } from "vitest";
import { runEmbeddedAgent } from "../agents/embedded-agent.js";
import { makeConfiguredModel } from "../agents/test-helpers/provider-model-fixture.js";
import { setRuntimeConfigSnapshot } from "../config/runtime-snapshot.js";
import { replaceSessionEntry } from "../config/sessions/session-accessor.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { deliverQueuedSessionDelivery } from "../gateway/server-restart-sentinel.js";
import { loadPendingSessionDelivery } from "../infra/session-delivery-queue-storage.js";
import { enqueueUnclaimedSessionDeliveryFixture as enqueueSessionDelivery } from "../infra/session-delivery-queue.test-helpers.js";
import { resetSystemEventsForTest } from "../infra/system-events.js";
import { openOmnipolymathStateDatabase } from "../state/omnipolymath-state-db.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import { withOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";

// mock-isolation: Only inference is synthetic; recovery, admission, and the model budget stay real.
vi.mock("../agents/embedded-agent-runner/run.js", () => ({ runEmbeddedAgent: vi.fn() }));
const model = vi.mocked(runEmbeddedAgent);
await Promise.all([
  import("../auto-reply/dispatch.js"),
  import("../auto-reply/reply/get-reply-from-config.runtime.js").then((runtime) =>
    runtime.prewarmConfigDrivenReplyRuntime(),
  ),
]);

afterEach(() => {
  resetSystemEventsForTest();
  vi.restoreAllMocks();
});

it("keeps legacy queued inference inert without changing its persisted payload", async () => {
  await withOmnipolymathTestState(
    { label: "restart-continuation-budget", env: { OMNIPOLYMATH_TEST_FAST: "0" } },
    async (state) => {
      const cfg: OmnipolymathConfig = {
        agents: {
          entries: { main: { workspace: state.workspaceDir } },
          defaults: {
            workspace: state.workspaceDir,
            skipBootstrap: true,
            model: { primary: "openai/gpt-5.4" },
            models: { "openai/gpt-5.4": { agentRuntime: { id: "omnipolymath" } } },
          },
        },
        models: {
          providers: {
            openai: {
              baseUrl: "https://openai.example.test/v1",
              apiKey: "synthetic-fixture-key",
              models: [
                makeConfiguredModel({
                  name: "Recovery fixture model",
                  reasoning: false,
                  maxTokens: 8_192,
                }),
              ],
            },
          },
        },
        messages: { visibleReplies: "automatic" },
        plugins: { enabled: false },
        skills: { load: { watch: false } },
      };
      setRuntimeConfigSnapshot(cfg);
      await state.writeConfig(cfg);
      openOmnipolymathStateDatabase();
      const sessionKey = "agent:main:main";
      await replaceSessionEntry(
        { agentId: "main", sessionKey },
        {
          sessionId: "requester",
          lifecycleRevision: "original",
          updatedAt: Date.now(),
          sessionStartedAt: Date.now(),
        },
      );
      model.mockImplementation(async (params) => {
        const admission = expectDefined(params.preparedRunAdmission, "ordinary run admission");
        await admission.admit("gateway", params.runId);
        params.onExecutionPhase?.({ phase: "model_call_started" });
        await params.onExecutionStarted?.();
        await params.onAgentEvent?.({ stream: "lifecycle", data: { phase: "start" } });
        return {
          payloads: [{ text: "Recovered work continued" }],
          meta: { durationMs: 1 },
        };
      });
      const queueContext = captureOmnipolymathStateWorkerContext();
      for (const kind of ["systemEvent", "agentTurn"] as const) {
        model.mockClear();
        const message = `Continue interrupted ${kind} work.`;
        const id = await enqueueSessionDelivery(
          kind === "systemEvent"
            ? { kind, sessionKey, text: message }
            : { kind, sessionKey, message, messageId: `restart-${kind}` },
          queueContext,
        );
        const entry = expectDefined(
          await loadPendingSessionDelivery(id, queueContext),
          "queued recovery",
        );
        await deliverQueuedSessionDelivery({ deps: {}, queueContext, entry });
        expect(model).not.toHaveBeenCalled();
        expect(await loadPendingSessionDelivery(id, queueContext)).toEqual(entry);
      }
    },
  );
});
