import type { SystemAgentOverview } from "./overview.js";

export function createSystemAgentOverviewFixture(
  overrides: Partial<SystemAgentOverview> = {},
): SystemAgentOverview {
  return {
    config: { path: "/tmp/omnipolymath.json", exists: false, valid: false, issues: [], hash: null },
    agents: [],
    defaultAgentId: "main",
    tools: {
      codex: { command: "codex", found: false },
      claude: { command: "claude", found: false },
      gemini: { command: "gemini", found: false },
      apiKeys: { openai: false, anthropic: false },
    },
    gateway: { url: "ws://127.0.0.1:18789", source: "test", reachable: false },
    references: {
      docsUrl: "https://omnipolymath.vercel.app/docs",
      sourceUrl: "https://github.com/krishnashahane/Omnipolymath",
    },
    ...overrides,
  };
}
