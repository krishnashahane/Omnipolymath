import type { PluginCapabilityCatalog } from "omnipolymath/plugin-sdk/plugin-entry";
import { buildXiaomiSpeechProvider } from "./speech-provider.js";

export default {
  speechProviders: [buildXiaomiSpeechProvider()],
} satisfies PluginCapabilityCatalog;
