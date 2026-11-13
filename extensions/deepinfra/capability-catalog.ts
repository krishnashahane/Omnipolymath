import type { PluginCapabilityCatalog } from "omnipolymath/plugin-sdk/plugin-entry";
import { buildDeepInfraSpeechProvider } from "./speech-provider.js";

export default {
  speechProviders: [buildDeepInfraSpeechProvider()],
} satisfies PluginCapabilityCatalog;
