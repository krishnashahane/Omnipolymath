import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";

export const TEMPLATES_LABS_DISABLED_MESSAGE =
  "Templates is off in Settings > Labs. Turn it on to discover or add Templates.";

export class TemplatesLabsDisabledError extends Error {
  constructor() {
    super(TEMPLATES_LABS_DISABLED_MESSAGE);
    this.name = "TemplatesLabsDisabledError";
  }
}

export function isTemplatesLabsEnabled(config: OmnipolymathConfig): boolean {
  return config.gateway?.controlUi?.experimental?.templates === true;
}

export function assertTemplatesLabsEnabled(config: OmnipolymathConfig): void {
  if (!isTemplatesLabsEnabled(config)) {
    throw new TemplatesLabsDisabledError();
  }
}
