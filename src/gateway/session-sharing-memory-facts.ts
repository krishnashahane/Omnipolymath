import { resolveSessionStorePathCore } from "../config/sessions/paths.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import {
  captureSessionSharingMemoryFacts,
  SessionMutationFactsUnavailableError,
} from "./session-sharing-incognito.js";

export function prepareMemorySessionMutationFacts(
  params: {
    cfg: OmnipolymathConfig;
    agentId: string;
    canonicalKey: string;
    allowMissing?: true;
    storageReady?: Promise<void>;
  },
  assertRoutingCurrent: (cfg: OmnipolymathConfig) => void,
) {
  const { agentId, canonicalKey } = params;
  let memoryActive = true;
  const memory = captureSessionSharingMemoryFacts(
    {
      agentId,
      sessionKey: canonicalKey,
      resolved: { storePath: resolveSessionStorePathCore(params.cfg.session?.store, { agentId }) },
    },
    () => {
      if (!memoryActive) {
        throw new SessionMutationFactsUnavailableError();
      }
    },
    Boolean(params.allowMissing),
  );
  if (!memory) {
    return undefined;
  }
  const read = {
    storageTarget: { agentId, canonicalKey, storePath: memory.location.path },
    // The actor installs creation and its sharing facts together before acknowledgement.
    bindCreation() {},
    prepareRead() {
      return undefined;
    },
    readCurrent(cfg: OmnipolymathConfig) {
      assertRoutingCurrent(cfg);
      return memory.readCurrent();
    },
    release() {
      memoryActive = false;
    },
  };
  const prepare = async () => {
    if (params.storageReady) {
      await params.storageReady;
    }
    read.readCurrent(params.cfg);
    return read;
  };
  return prepare();
}
