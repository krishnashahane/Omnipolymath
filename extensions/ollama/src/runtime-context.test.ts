import type { Message } from "omnipolymath/plugin-sdk/llm";
import { describe, expect, it } from "vitest";
import { convertToOllamaMessages } from "./stream-messages.js";

describe("Ollama runtime context", () => {
  it("preserves labeled context through the user-role compatibility contract", () => {
    const message: Message = {
      role: "user",
      content: "Omnipolymath runtime context:\ncurrent facts",
      timestamp: 0,
      runtimeContext: {},
    };

    expect(convertToOllamaMessages([message])).toEqual([
      { role: "user", content: "Omnipolymath runtime context:\ncurrent facts" },
    ]);
  });
});
