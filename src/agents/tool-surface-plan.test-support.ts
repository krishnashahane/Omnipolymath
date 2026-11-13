import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { prepareAgentToolSurfacePresentation } from "./tool-surface-plan.js";

export function createToolSurfacePresentationForTest(
  config: OmnipolymathConfig = { tools: { codeMode: false, toolSearch: false } },
) {
  return prepareAgentToolSurfacePresentation({
    config,
    toolsEnabled: true,
    isRawModelRun: false,
    forceDirectMessageTool: false,
  });
}
