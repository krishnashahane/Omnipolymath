import type { Usage } from "../../../llm/types.js";
import { omnipolymathAgentCoreRuntime } from "../../runtime/index.js";

export type SessionModelUsageSink = (usage: Usage) => void;

/** Adds a private usage sink without changing public summary result shapes. */
export function createCompactionRuntime(usageSink?: SessionModelUsageSink) {
  return usageSink
    ? { ...omnipolymathAgentCoreRuntime, internalUsageSink: usageSink }
    : omnipolymathAgentCoreRuntime;
}
