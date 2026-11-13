import type { PluginCapabilityCatalog } from "omnipolymath/plugin-sdk/plugin-entry";
import { buildInworldSpeechProvider } from "./speech-provider.js";

export default {
  speechProviders: [buildInworldSpeechProvider()],
} satisfies PluginCapabilityCatalog;
