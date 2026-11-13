import { vi } from "vitest";

export const activity = {
  listener: undefined as ((busy: boolean) => void) | undefined,
};

vi.mock("omnipolymath/plugin-sdk/memory-core-host-engine-foundation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("omnipolymath/plugin-sdk/memory-core-host-engine-foundation")>();
  return {
    ...actual,
    observeAgentRunActivity: (_agentId: string, listener: (busy: boolean) => void) => {
      activity.listener = listener;
      listener(false);
      return () => {
        activity.listener = undefined;
      };
    },
  };
});
