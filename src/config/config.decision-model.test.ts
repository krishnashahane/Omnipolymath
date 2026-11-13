import { describe, expect, it } from "vitest";
import {
  getConfiguredDecisionProviderIds,
  resolveDecisionModelSetting,
} from "../agents/decision-model-setting.js";
import type { OmnipolymathConfig } from "./types.omnipolymath.js";
import { OmnipolymathSchema } from "./zod-schema.js";

describe("decision model configuration", () => {
  it("keeps decision routing independent of chat and utility models and preserves agent disablement", () => {
    const config: OmnipolymathConfig = {
      agents: {
        ownership: "explicit",
        defaults: {
          model: "chat/large",
          utilityModel: "chat/small",
          decisionModel: " typesafe/jev-latest ",
        },
        entries: {
          inherited: {},
          disabled: { decisionModel: "" },
          overridden: { decisionModel: "local/fast" },
        },
      },
    };
    const parsed = OmnipolymathSchema.parse(config);
    expect(parsed.agents?.defaults?.decisionModel).toBe("typesafe/jev-latest");
    expect(resolveDecisionModelSetting(config)).toEqual({
      provider: "typesafe",
      model: "jev-latest",
    });
    expect(resolveDecisionModelSetting(config, "inherited")).toEqual({
      provider: "typesafe",
      model: "jev-latest",
    });
    expect(resolveDecisionModelSetting(config, "disabled")).toBeUndefined();
    expect(resolveDecisionModelSetting(config, "overridden")).toEqual({
      provider: "local",
      model: "fast",
    });
    expect(getConfiguredDecisionProviderIds(config)).toEqual(["typesafe", "local"]);
    expect(
      resolveDecisionModelSetting({ agents: { defaults: { model: "chat/large" } } }),
    ).toBeUndefined();
  });
});
