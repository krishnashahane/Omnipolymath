import { expect, it } from "vitest";
import { buildAgentSystemPrompt } from "./system-prompt.js";

it("routes official support separately from self-service, social, bug, and security help", () => {
  const prompt = buildAgentSystemPrompt({
    workspaceDir: "/tmp/omnipolymath",
    docsPath: "/tmp/omnipolymath/docs",
    toolNames: ["read"],
  });

  expect(prompt).toContain("Docs: /tmp/omnipolymath/docs");
  expect(prompt).toContain("For official Omnipolymath support, visit https://github.com/krishnashahane/Omnipolymath/issues");
  expect(prompt).toContain(
    "Keep self-service docs, Discord social chat, reproducible GitHub bug reports, and private security reporting separate.",
  );
});
