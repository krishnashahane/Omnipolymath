import { expectDefined } from "@omnipolymath/normalization-core";
import { expect, it, vi } from "vitest";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { createPluginToolAllowlist } from "../plugins/tool-grant-allowlist.js";
import "./test-helpers/fast-bash-tools.js";
import "./test-helpers/fast-coding-tools.js";
import "./test-helpers/fast-omnipolymath-tools.js";
import { createOmnipolymathCodingTools } from "./agent-tools.js";
import { prepareConversationCapabilityProfile } from "./conversation-capability-profile.js";
import { createOmnipolymathTools } from "./omnipolymath-tools.js";

it("materializes additive runtime tools while preserving normal deny policy", async () => {
  const createOmnipolymathToolsMock = vi.mocked(createOmnipolymathTools);
  createOmnipolymathToolsMock.mockClear();
  const config: OmnipolymathConfig = { tools: { profile: "coding", deny: ["workboard_block"] } };

  createOmnipolymathCodingTools({
    config,
    conversationCapabilityProfile: await prepareConversationCapabilityProfile({
      config,
      runtimePluginToolGrant: {
        pluginId: "workboard",
        toolNames: ["workboard_heartbeat", "workboard_complete"],
      },
    }),
  });

  expect(createOmnipolymathToolsMock).toHaveBeenCalledTimes(1);
  const options = expectDefined(createOmnipolymathToolsMock.mock.lastCall?.[0], "tool options");
  expect(options.pluginToolAllowlist).not.toContain("workboard_heartbeat");
  expect(
    createPluginToolAllowlist(options.pluginToolAllowlist).allowsTool(
      "workboard",
      "workboard_heartbeat",
    ),
  ).toBe(true);
  // The grant stays encoded in the allowlist; tool construction learns only its owner.
  expect(options).not.toHaveProperty("runtimePluginToolGrant");
  expect(options).toHaveProperty("runtimePluginToolOwnerId", "workboard");
  expect(options.pluginToolDenylist).toContain("workboard_block");
});
