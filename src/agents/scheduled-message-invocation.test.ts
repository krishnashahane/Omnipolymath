import { expectDefined } from "@omnipolymath/normalization-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test-helpers/fast-coding-tools.js";
import "./test-helpers/fast-omnipolymath-tools.js";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../config/config.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { resolveGatewayScopedTools } from "../gateway/tool-resolution.js";
import { prepareTemplateInstallSchemaVersions } from "../templates/provenance-runtime-read.js";
import { createOmnipolymathCodingToolsAsync } from "./agent-tools.js";
import { createOmnipolymathTools } from "./omnipolymath-tools.js";

describe("scheduled message invocation admission", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Synchronous tool assembly consumes the runtime owner’s prepared consent facts.
    (await prepareTemplateInstallSchemaVersions({ artifactPreservingReadOnly: false })).publish();
  });
  afterEach(() => clearRuntimeConfigSnapshot());

  it.each(["embedded", "loopback"] as const)(
    "%s applies a published model policy for the borrowed owner to the next invocation",
    async (surface) => {
      const config: OmnipolymathConfig = {
        plugins: { enabled: false },
        tools: { profile: "full" },
        agents: {
          ownership: "explicit",
          entries: {
            main: { tools: { deny: ["message"] } },
            reader: { tools: { profile: "full" } },
          },
        },
      };
      setRuntimeConfigSnapshot(config, config);
      const run = {
        agentId: "main",
        modelProvider: "anthropic",
        modelId: "scheduled-test-model",
        messageActionTurnCapability: "host-turn-capability",
        scheduledToolPolicy: { version: 1, mode: "trusted" } as const,
      };
      const tools =
        surface === "embedded"
          ? await createOmnipolymathCodingToolsAsync({
              ...run,
              config,
              policyAgentId: "reader",
              sessionKey: "agent:reader:cron:policy",
              runSessionKey: "agent:main:cron:execution",
              runtimeToolAllowlist: ["message"],
            })
          : (
              await resolveGatewayScopedTools({
                ...run,
                cfg: config,
                surface: "loopback",
                sessionKey: "agent:main:cron:execution",
                runtimePolicyAgentId: "reader",
                runtimePolicySessionKey: "agent:reader:cron:policy",
                gatewayRequestedTools: ["message"],
                disablePluginTools: true,
              })
            ).tools;
      expect(tools.some((tool) => tool.name === "message")).toBe(true);
      const factoryOptions = vi.mocked(createOmnipolymathTools).mock.calls.at(-1)?.[0];
      const admit = expectDefined(
        factoryOptions?.admitScheduledMessageInvocation,
        "scheduled factory admission",
      );
      const acceptedConfig = admit();

      const narrowed: OmnipolymathConfig = {
        ...config,
        agents: {
          ...config.agents,
          entries: {
            ...config.agents?.entries,
            reader: {
              tools: {
                profile: "full",
                byProvider: { "anthropic/scheduled-test-model": { deny: ["message"] } },
              },
            },
          },
        },
      };
      setRuntimeConfigSnapshot(narrowed, narrowed);
      expect(admit).toThrow(/not allowed by the current tool policy/);
      expect(acceptedConfig).toBe(config);

      setRuntimeConfigSnapshot(config, config);
      expect(admit()).toBe(config);
      expect(createOmnipolymathTools).toHaveBeenCalledTimes(1);
    },
  );
});
