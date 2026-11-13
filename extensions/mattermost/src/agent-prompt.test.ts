import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { describe, expect, it } from "vitest";
import { mattermostPlugin } from "./channel.js";
import { resolveMattermostPresentation } from "./normalize.js";

function hintsFor(cfg: OmnipolymathConfig, accountId?: string) {
  return mattermostPlugin.agentPrompt!.messageToolHints!({ cfg, accountId });
}

describe("mattermostAgentPrompt message tool hints", () => {
  it("teaches a button shape that Mattermost renders as a control", () => {
    const cfg = { channels: { mattermost: { capabilities: ["inlineButtons"] } } } as OmnipolymathConfig;
    const [hint] = hintsFor(cfg);

    const presentation = /presentation=(\{.*\})`/.exec(hint ?? "")?.[1];
    expect(presentation).toBeDefined();
    const { buttons } = resolveMattermostPresentation({
      presentation: JSON.parse(presentation ?? "null"),
    });

    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.[0]).toMatchObject({ text: "Yes", callback_data: "yes" });
  });

  it("omits button instructions when buttons are off", () => {
    expect(hintsFor({ channels: { mattermost: {} } } as OmnipolymathConfig)).toEqual([]);
  });

  it("lets an account turn buttons on", () => {
    const cfg = {
      channels: {
        mattermost: { accounts: { work: { capabilities: ["inlineButtons"] } } },
      },
    } as OmnipolymathConfig;

    expect(hintsFor(cfg, "work")[0]).toContain("Inline buttons: `send`");
    expect(hintsFor(cfg, "other")).toEqual([]);
  });
});
