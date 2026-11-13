import { expect, it } from "vitest";
import { setRuntimeConfigSnapshot } from "../../config/runtime-snapshot.js";
import { replaceSessionEntry } from "../../config/sessions/session-accessor.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { withOmnipolymathTestState } from "../../test-utils/omnipolymath-test-state.js";
import { deliveryContextFromSession } from "../../utils/delivery-context.read.js";
import { normalizeSessionDeliveryState } from "../../utils/delivery-context.shared.js";
import { readCronDeliveryTargetContexts } from "./delivery-target-context.js";

it("retains each isolated job's owner when a mixed delivery batch resolves global aliases", async () => {
  await withOmnipolymathTestState({ label: "cron-global-delivery-batch" }, async (state) => {
    const cfg = {
      agents: {
        ownership: "explicit",
        defaults: { systemAgent: { agentId: "main" } },
        entries: { main: {}, ops: {} },
      },
      session: { scope: "global" },
    } satisfies OmnipolymathConfig;
    setRuntimeConfigSnapshot(cfg);
    const routes = {
      main: { channel: "telegram", to: "telegram:main", accountId: "main", threadId: "11" },
      ops: { channel: "telegram", to: "telegram:ops", accountId: "ops", threadId: "22" },
    };
    for (const [agentId, context] of Object.entries(routes)) {
      await replaceSessionEntry(
        { agentId, sessionKey: "global", env: state.env },
        {
          sessionId: `${agentId}-global`,
          updatedAt: 1,
          delivery: normalizeSessionDeliveryState({ context }),
        },
      );
    }

    const results = await readCronDeliveryTargetContexts(cfg, [
      { agentId: "ops", sessionKey: "main" },
      { agentId: "main", sessionKey: "main" },
      { agentId: "ops", sessionKey: "agent:ops:main" },
    ]);
    expect(
      results.map((result) =>
        result.ok
          ? {
              sessionKey: result.value.threadSessionKey,
              route: deliveryContextFromSession(result.value.main),
            }
          : result,
      ),
    ).toEqual([
      { sessionKey: "global", route: routes.ops },
      { sessionKey: "global", route: routes.main },
      { sessionKey: "global", route: routes.ops },
    ]);
  });
});
