import type { TalkProviderConfig } from "../config/types.gateway.js";
import type { OmnipolymathConfig } from "../config/types.js";
import type { ResolvedTtsPersona, TtsModelOverrideConfig } from "../config/types.tts.js";
import type {
  SpeechProviderConfig,
  SpeechProviderId,
  SpeechProviderOverrides,
  SpeechSynthesisTarget,
} from "./tts-runtime-types.js";

/** Policy controlling which [[tts:*]] directive fields can affect synthesis. */
export type SpeechModelOverridePolicy = {
  [Key in keyof TtsModelOverrideConfig]-?: Exclude<TtsModelOverrideConfig[Key], undefined>;
};

/** Context for checking whether a provider has enough config to synthesize. */
export type SpeechProviderConfiguredContext = {
  cfg?: OmnipolymathConfig;
  providerConfig: SpeechProviderConfig;
  timeoutMs: number;
};

/** Request for buffered speech synthesis. */
export type SpeechSynthesisRequest = {
  text: string;
  cfg: OmnipolymathConfig;
  providerConfig: SpeechProviderConfig;
  target: SpeechSynthesisTarget;
  providerOverrides?: SpeechProviderOverrides;
  timeoutMs: number;
};

export type SpeechSynthesisStreamRequest = SpeechSynthesisRequest;

/** Telephony synthesis request for provider output that needs a fixed sample rate. */
export type SpeechTelephonySynthesisRequest = Omit<SpeechSynthesisRequest, "target">;

/** Provider hook input for applying persona/config before synthesis. */
export type SpeechProviderPrepareSynthesisContext = SpeechSynthesisRequest & {
  persona?: ResolvedTtsPersona;
  personaProviderConfig?: SpeechProviderConfig;
};

/** Provider voice-listing request with optional direct auth/URL overrides. */
export type SpeechListVoicesRequest = {
  cfg?: OmnipolymathConfig;
  providerConfig?: SpeechProviderConfig;
  apiKey?: string;
  baseUrl?: string;
  /** Core-resolved request timeout after config and provider defaults. */
  timeoutMs?: number;
};

/** Provider hook input for resolving normalized config from raw Omnipolymath config. */
export type SpeechProviderResolveConfigContext = {
  cfg: OmnipolymathConfig;
  rawConfig: Record<string, unknown>;
  timeoutMs: number;
};

/** One parsed directive key/value plus current provider override state. */
export type SpeechDirectiveTokenParseContext = {
  key: string;
  value: string;
  policy: SpeechModelOverridePolicy;
  selectedProvider?: SpeechProviderId;
  providerConfig?: SpeechProviderConfig;
  currentOverrides?: SpeechProviderOverrides;
};

/** Provider hook input for resolving talk-command speech config. */
export type SpeechProviderResolveTalkConfigContext = {
  cfg: OmnipolymathConfig;
  baseTtsConfig: Record<string, unknown>;
  talkProviderConfig: TalkProviderConfig;
  timeoutMs: number;
};

/** Provider hook input for per-call talk-command overrides. */
export type SpeechProviderResolveTalkOverridesContext = {
  talkProviderConfig: TalkProviderConfig;
  params: Record<string, unknown>;
};
