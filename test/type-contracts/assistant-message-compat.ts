import type { AssistantMessage } from "omnipolymath/plugin-sdk/llm";
import { expectTypeOf } from "vitest";

// Preserve the optional assistant delivery field shipped in v2026.10.1.
const delivery: NonNullable<AssistantMessage["omnipolymathDelivery"]> = {
  textPhaseRequiresTerminal: true,
};
expectTypeOf(delivery.textPhaseRequiresTerminal).toEqualTypeOf<true | undefined>();
