import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type {
  RealtimeTranscriptionProviderConfig,
  RealtimeTranscriptionSessionCallbacks,
} from "./provider-types.js";

export type RealtimeTranscriptionProviderResolveConfigContext = {
  cfg: OmnipolymathConfig;
  rawConfig: RealtimeTranscriptionProviderConfig;
};

export type RealtimeTranscriptionProviderConfiguredContext = {
  cfg?: OmnipolymathConfig;
  providerConfig: RealtimeTranscriptionProviderConfig;
};

/** Inputs passed to a provider when creating a transcription session. */
export type RealtimeTranscriptionSessionCreateRequest = RealtimeTranscriptionSessionCallbacks & {
  cfg?: OmnipolymathConfig;
  providerConfig: RealtimeTranscriptionProviderConfig;
};
