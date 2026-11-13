// HTTP/CSP paths need the setting without loading the terminal launch policy.
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";

export function isTerminalConfigEnabled(config: OmnipolymathConfig | undefined): boolean {
  return config?.gateway?.terminal?.enabled !== false;
}
