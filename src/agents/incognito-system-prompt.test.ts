import { describe, expect, it } from "vitest";
import { resolveIncognitoOmnipolymathAgentSqlitePath } from "../state/omnipolymath-agent-db.js";
import { prepareAttemptSystemPromptAdditions } from "./embedded-agent-runner/run/attempt-system-prompt-additions.js";

describe("incognito system prompt", () => {
  it("preserves existing context bytes before appending the incognito instruction", async () => {
    expect(
      (
        await prepareAttemptSystemPromptAdditions({
          agentId: "main",
          modelId: "synthetic-model",
          provider: "synthetic",
          sessionId: "synthetic-session",
          extraSystemPrompt: "Existing context.\n",
          storePath: resolveIncognitoOmnipolymathAgentSqlitePath({ agentId: "main" }),
        })
      ).extraSystemPrompt,
    ).toBe(
      "Existing context.\n\n\nThis chat is incognito; do not store its conversation content in memory files or long-term notes.",
    );
  });
});
