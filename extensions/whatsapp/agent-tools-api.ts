// WhatsApp agent tool facade keeps the bundled entrypoint light during discovery.
import type { OmnipolymathPluginApi } from "omnipolymath/plugin-sdk/core";
import { registerWhatsAppCallTool } from "./src/agent-tools-call.js";
import { registerWhatsAppLoginTool } from "./src/agent-tools-login.js";

export function registerWhatsAppAgentTools(api: OmnipolymathPluginApi): void {
  registerWhatsAppCallTool(api);
  registerWhatsAppLoginTool(api);
}
