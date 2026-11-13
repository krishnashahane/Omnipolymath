import { captureRuntimeConfigAsyncReader } from "../config/io.runtime.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { ensureOmnipolymathModelsJsonWithInput as ensureModelsJson } from "./models-config.core.js";

/** Ensures models.json and the agent SQLite catalog cache are current. */
export async function ensureOmnipolymathModelsJson(
  config?: OmnipolymathConfig,
  agentDirOverride?: string,
  options: Parameters<typeof ensureModelsJson>[2] = {},
): ReturnType<typeof ensureModelsJson> {
  // Capture and invoke before yielding so default calls retain their original config and env.
  return ensureModelsJson(
    config ?? captureRuntimeConfigAsyncReader({ capture: true }),
    agentDirOverride,
    options,
  );
}
