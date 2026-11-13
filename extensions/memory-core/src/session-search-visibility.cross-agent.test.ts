import * as engineSessions from "omnipolymath/plugin-sdk/memory-core-host-engine-sessions";
// Memory Core tests cover cross-agent session search visibility behavior.
import type { MemorySearchResult } from "omnipolymath/plugin-sdk/memory-core-host-runtime-files";
import { afterEach, describe, expect, it, vi } from "vitest";
import { filterMemorySearchHitsBySessionVisibility } from "./session-search-visibility.js";
import {
  searchHit,
  sessionEntry,
  type TestSessionEntry,
} from "./session-search-visibility.test-support.js";
import { asOmnipolymathConfig } from "./tools.test-helpers.js";

const crossAgentStore: Record<string, TestSessionEntry> = {
  "agent:peer:only": sessionEntry("w1", 1, "/tmp/sessions/w1.jsonl"),
};
let combinedSessionStore: Record<string, TestSessionEntry> = crossAgentStore;

vi.mock("omnipolymath/plugin-sdk/memory-core-host-engine-sessions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("omnipolymath/plugin-sdk/memory-core-host-engine-sessions")>();
  return {
    ...actual,
    loadMemorySearchSessionStore: vi.fn(async () => ({
      storePath: "(test)",
      store: combinedSessionStore,
    })),
  };
});

describe("filterMemorySearchHitsBySessionVisibility across agents", () => {
  afterEach(() => {
    vi.mocked(engineSessions.loadMemorySearchSessionStore).mockClear();
    combinedSessionStore = crossAgentStore;
  });

  it("keeps global-scope session hits for non-default agents", async () => {
    combinedSessionStore = {
      global: sessionEntry("w1", 1, "/tmp/sessions/w1.jsonl"),
    };
    const hit: MemorySearchResult = searchHit("sessions/w1.jsonl", "sessions", "x");
    const cfg = asOmnipolymathConfig({
      session: { scope: "global" },
      tools: {
        sessions: { visibility: "all" },
        agentToAgent: { enabled: true, allow: ["*"] },
      },
    });
    const filtered = await filterMemorySearchHitsBySessionVisibility({
      cfg,
      agentId: "secondary",
      requesterSessionKey: "agent:secondary:main",
      sandboxed: false,
      hits: [hit],
    });
    expect(filtered).toEqual([hit]);
  });

  it("does not keep cross-agent session hits when a shared store returns out-of-scope keys", async () => {
    combinedSessionStore = crossAgentStore;
    const hit: MemorySearchResult = searchHit("sessions/w1.jsonl", "sessions", "x");
    const cfg = asOmnipolymathConfig({
      tools: {
        sessions: { visibility: "all" },
        agentToAgent: { enabled: true, allow: ["*"] },
      },
    });
    const filtered = await filterMemorySearchHitsBySessionVisibility({
      cfg,
      requesterSessionKey: "agent:main:main",
      sandboxed: false,
      hits: [hit],
    });
    expect(filtered).toStrictEqual([]);
  });

  it("does not keep owner-qualified cross-agent hits that collide with a scoped stem", async () => {
    combinedSessionStore = {
      "agent:main:main": sessionEntry("main", 1, "/tmp/sessions/main.jsonl"),
    };
    const hit: MemorySearchResult = searchHit("sessions/peer/main.jsonl", "sessions", "x");
    const cfg = asOmnipolymathConfig({
      tools: {
        sessions: { visibility: "all" },
        agentToAgent: { enabled: true, allow: ["*"] },
      },
    });
    const filtered = await filterMemorySearchHitsBySessionVisibility({
      cfg,
      requesterSessionKey: "agent:main:main",
      sandboxed: false,
      hits: [hit],
    });
    expect(filtered).toStrictEqual([]);
  });
});
