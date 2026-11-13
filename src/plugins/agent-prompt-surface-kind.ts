import type { AgentPromptSurfaceKind } from "./types.js";

/** Normalizes legacy prompt surface names to current Omnipolymath surface names. */
export function normalizeAgentPromptSurfaceKind(
  surface: AgentPromptSurfaceKind,
): AgentPromptSurfaceKind {
  return surface === "pi_main" ? "omnipolymath_main" : surface;
}

/** True when a prompt surface targets the main Omnipolymath prompt. */
export function isOmnipolymathMainPromptSurface(surface: AgentPromptSurfaceKind): boolean {
  return normalizeAgentPromptSurfaceKind(surface) === "omnipolymath_main";
}
