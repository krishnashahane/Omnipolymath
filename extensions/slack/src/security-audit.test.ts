import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
// Slack tests cover security audit plugin behavior.
import { describe, expect, it, vi } from "vitest";
import type { ResolvedSlackAccount } from "./accounts.js";
import { collectSlackSecurityAuditFindings } from "./security-audit.js";

const { readChannelAllowFromStoreMock } = vi.hoisted(() => ({
  readChannelAllowFromStoreMock: vi.fn(async () => [] as string[]),
}));

vi.mock("omnipolymath/plugin-sdk/conversation-runtime", () => ({
  readChannelAllowFromStore: readChannelAllowFromStoreMock,
}));

function createSlackAccount(config: NonNullable<OmnipolymathConfig["channels"]>["slack"]) {
  return {
    accountId: "default",
    enabled: true,
    botToken: "xoxb-test",
    botTokenSource: "config",
    appTokenSource: "config",
    config,
  } as ResolvedSlackAccount;
}

function createSlashCommandSlackConfig(): OmnipolymathConfig {
  return {
    channels: {
      slack: {
        enabled: true,
        botToken: "xoxb-test",
        appToken: "xapp-test",
        groupPolicy: "open",
        slashCommand: { enabled: true },
      },
    },
  };
}

async function collectSlackFindingsForConfig(cfg: OmnipolymathConfig) {
  readChannelAllowFromStoreMock.mockResolvedValue([]);
  return await collectSlackSecurityAuditFindings({
    cfg,
    account: createSlackAccount(cfg.channels!.slack),
    accountId: "default",
  });
}

describe("Slack security audit findings", () => {
  it("flags slash commands without a channel users allowlist", async () => {
    const findings = await collectSlackFindingsForConfig(createSlashCommandSlackConfig());

    const slashAllowlistFinding = findings.find(
      ({ checkId }) => checkId === "channels.slack.commands.slash.no_allowlists",
    );
    expect(slashAllowlistFinding?.severity).toBe("warn");
  });
});
