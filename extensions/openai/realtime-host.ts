// Full registration composes the same host operations supplied to a cold capability catalog.
import { resolveAgentDir } from "omnipolymath/plugin-sdk/agent-scope-runtime";
import { formatErrorMessage } from "omnipolymath/plugin-sdk/error-runtime";
import type { PluginCapabilityCatalogHostContext } from "omnipolymath/plugin-sdk/plugin-entry";
import {
  isProviderAuthProfileConfigured,
  isProviderAuthProfileConfiguredAsync,
  resolveProviderAuthProfileApiKey,
} from "omnipolymath/plugin-sdk/provider-auth";
import {
  createProviderHttpError,
  readProviderJsonResponse,
  readProviderTextResponse,
  resolveProviderRequestHeaders,
} from "omnipolymath/plugin-sdk/provider-http";
import {
  captureWsEventAsync,
  createDebugProxyWebSocketAgent,
  resolveDebugProxySettings,
} from "omnipolymath/plugin-sdk/proxy-capture";
import { createRealtimeTranscriptionWebSocketSession } from "omnipolymath/plugin-sdk/realtime-transcription-session";
import { warn } from "omnipolymath/plugin-sdk/runtime-env";
import { redactSensitiveText } from "omnipolymath/plugin-sdk/security-runtime";
import { fetchWithSsrFGuard } from "omnipolymath/plugin-sdk/ssrf-runtime";

export const openAIRealtimeHost = {
  resolveAgentDir,
  // Retained for public synchronous SDK calls through 2026-12-31.
  isProviderAuthProfileConfigured,
  isProviderAuthProfileConfiguredAsync,
  resolveProviderAuthProfileApiKey,
  resolveProviderRequestHeaders,
  createRealtimeTranscriptionWebSocketSession,
  captureWsEventAsync,
  createDebugProxyWebSocketAgent,
  resolveDebugProxySettings,
  fetchWithSsrFGuard,
  createProviderHttpError,
  readProviderJsonResponse,
  readProviderTextResponse,
  formatErrorMessage,
  warn,
  redactSensitiveText,
} satisfies Omit<
  PluginCapabilityCatalogHostContext,
  | "isProviderApiKeyConfigured"
  | "isProviderApiKeyConfiguredAsync"
  | "resolveApiKeyForProvider"
  | "captureWsEvent"
>;

export type OpenAIRealtimeHost = typeof openAIRealtimeHost;
