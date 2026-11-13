export function terminalAssistantMessage(content: string, model: string) {
  return {
    role: "assistant",
    content,
    provider: "unit-test",
    model,
    stopReason: "stop",
    __omnipolymath: { runId: "terminal-run" },
  };
}
