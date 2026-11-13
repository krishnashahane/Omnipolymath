import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { getTtsMachinePathAdmission } from "../state/config-machine-state.js";
import { executeExistingOmnipolymathStateRead } from "../state/omnipolymath-state-db-readonly.js";
import { resolveOmnipolymathStateSqlitePath } from "../state/omnipolymath-state-db.paths.js";
import { captureOmnipolymathStateReadWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import type { OmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.types.js";

export type PreparedTtsPreferences = Readonly<{ machinePrefsPath?: string }>;

const pendingPaths = resolveGlobalSingleton(
  Symbol.for("omnipolymath.pendingTtsPreferencePaths"),
  () => new Map<string, Promise<PreparedTtsPreferences>>(),
);

/** Synchronous compatibility reads consume only the path already admitted by its owner. */
export function getPreparedTtsPreferences(): PreparedTtsPreferences | undefined {
  const admitted = getTtsMachinePathAdmission(resolveOmnipolymathStateSqlitePath());
  return admitted ? preparePath(admitted.row?.value_json) : undefined;
}

/** Carry the machine-owned path through one turn; preference-file contents stay fresh. */
export async function prepareTtsPreferences(): Promise<PreparedTtsPreferences> {
  const databasePath = resolveOmnipolymathStateSqlitePath();
  const admitted = getTtsMachinePathAdmission(databasePath);
  if (admitted) {
    return preparePath(admitted.row?.value_json);
  }
  const context = captureOmnipolymathStateReadWorkerContext({ path: databasePath });
  const identity = context.admission.identity;
  if (!identity.key.startsWith("file:")) {
    return loadPath(context);
  }
  const key = `${identity.key}:${identity.birthtime ?? ""}`;
  let pending = pendingPaths.get(key);
  if (!pending) {
    const load = loadPath(context);
    pendingPaths.set(key, load);
    const release = () => {
      pendingPaths.delete(key);
    };
    void load.then(release, release);
    pending = load;
  }
  return pending;
}

async function loadPath(context: OmnipolymathStateWorkerContext): Promise<PreparedTtsPreferences> {
  const databasePath = context.admission.databasePath;
  const reply = await executeExistingOmnipolymathStateRead(
    { path: databasePath },
    { type: "tts.prefsPath" },
    { context, current: true },
  );
  if (!reply) {
    return {};
  }
  const installed = getTtsMachinePathAdmission(databasePath, () => reply.row);
  return preparePath((installed ? installed.row : reply.row)?.value_json);
}

function preparePath(valueJson: string | undefined): PreparedTtsPreferences {
  const value: unknown = valueJson === undefined ? undefined : JSON.parse(valueJson);
  if (value != null && typeof value !== "string") {
    throw new Error("Invalid TTS preference path: expected a string");
  }
  return { machinePrefsPath: value ?? undefined };
}
