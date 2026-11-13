import { readDatabasePathIdentitySync } from "../../infra/sqlite-worker-identity.js";
import { openOmnipolymathStateDatabase } from "../../state/omnipolymath-state-db.js";
import { captureOmnipolymathStateWorkerContext } from "../../state/omnipolymath-state-worker-context.js";
import { captureAuthProfileCredentialAuthority } from "../../state/user-model-account-authority.js";
import { loadPersistedAuthProfileStore } from "./persisted.js";
import { captureAuthProfileStorePersistenceSnapshot } from "./store.js";

export function retainPersistedCredential(agentDir: string, selectedProfileId: string) {
  const shared = openOmnipolymathStateDatabase();
  const { databasePath } = captureAuthProfileStorePersistenceSnapshot(agentDir).owner;
  const source = readDatabasePathIdentitySync(databasePath);
  const authority = captureAuthProfileCredentialAuthority(
    captureOmnipolymathStateWorkerContext({ path: shared.path }),
    { databasePath, identity: `${source.key}:${source.birthtime ?? ""}` },
    selectedProfileId,
  );
  authority.observe(loadPersistedAuthProfileStore(agentDir)?.profiles[selectedProfileId]);
  return authority;
}
