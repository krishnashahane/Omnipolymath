import { describe, expect, it } from "vitest";
import { resolveSessionStorePathCore } from "../config/sessions/paths.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { createActivitySummaryStorePaths } from "./session-activity-summary-state.js";

describe("activity summary store paths", () => {
  it("follows a store relocated by in-place config mutation", () => {
    const cfg: OmnipolymathConfig = { session: { store: "/tmp/first/omnipolymath-agent.sqlite" } };
    const storePathFor = createActivitySummaryStorePaths(() => cfg);
    expect(storePathFor("main")).toBe(
      resolveSessionStorePathCore(cfg.session?.store, { agentId: "main" }),
    );

    cfg.session = { store: "/tmp/second/omnipolymath-agent.sqlite" };
    expect(storePathFor("main")).toBe(
      resolveSessionStorePathCore(cfg.session.store, { agentId: "main" }),
    );
  });
});
