import { sha256Hex } from "omnipolymath/plugin-sdk/node-crypto-runtime";
import { normalizeAgentId, parseAgentSessionKey } from "omnipolymath/plugin-sdk/routing";
import { AcpRuntimeError } from "../runtime-api.js";

/** Logical Omnipolymath keys stay intact; only bare backend resource names need a namespace. */
export function resolveAcpxSessionResource(target: {
  sessionKey: string;
  agentId?: string;
}): string {
  const sessionKey = target.sessionKey.trim().toLowerCase();
  const encodedOwner = parseAgentSessionKey(sessionKey)?.agentId;
  const agentId = target.agentId?.trim() ? normalizeAgentId(target.agentId) : encodedOwner;
  if (!sessionKey || (encodedOwner && agentId !== encodedOwner) || (!encodedOwner && !agentId)) {
    throw new AcpRuntimeError(
      "ACP_SESSION_INIT_FAILED",
      "ACP session owner is missing or disagrees with its logical key. Pass the Omnipolymath agentId that owns this session.",
      { detailCode: "SESSION_OWNER_UNSUPPORTED" },
    );
  }
  if (encodedOwner) {
    return sessionKey;
  }
  const digest = sha256Hex(JSON.stringify([agentId, sessionKey]));
  return `omnipolymath-owner-v1-${digest}`;
}
