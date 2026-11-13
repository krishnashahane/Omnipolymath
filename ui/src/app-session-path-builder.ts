import {
  buildControlUiSessionPath,
  type ControlUiSessionNamespace,
} from "@omnipolymath/session-url-contract";

export function pathForSession(
  face: ControlUiSessionNamespace,
  agentId: string,
  sessionKey: string,
  basePath = "",
  details: {
    displayName?: string | null;
    exactKey?: boolean;
    mainKey?: string | null;
    shortIdLength?: number;
  } = {},
): string | null {
  return buildControlUiSessionPath({
    namespace: face,
    sessionKey,
    fallbackAgentId: agentId,
    basePath,
    displayName: details.displayName ?? undefined,
    exactKey: details.exactKey,
    mainKey: details.mainKey ?? undefined,
    shortIdLength: details.shortIdLength ?? 32,
  });
}
