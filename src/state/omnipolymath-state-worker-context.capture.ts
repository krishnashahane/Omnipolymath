import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import { resolveStateDir } from "../config/state-dir.js";
import { getDatabaseEngineSelection } from "../infra/database-engine/context.js";
import { getGatewayServiceInstallation } from "../infra/gateway-service-installation-context.js";
import { isGatewayExternallySupervised } from "../infra/gateway-supervision.js";
import { mergeProcessEnv } from "../infra/process-env.js";
import type { DatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import {
  isArtifactPreservingStateRead,
  isLiveStateRead,
} from "./artifact-preserving-state-reads.js";
import { getOmnipolymathDatabaseMaintenanceScope } from "./omnipolymath-state-db-async-lifecycle.js";
import { resolveLegacyCronDefaultStoreKey } from "./omnipolymath-state-db-cron-identity-migration.js";
import { captureOmnipolymathStateSchemaReadAdmission } from "./omnipolymath-state-db-schema-policy.js";
import { resolveOmnipolymathStateSqlitePath } from "./omnipolymath-state-db.paths.js";
import type { OmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.types.js";

/** Capture read authority without constructing a worker environment. */
export function captureOmnipolymathStateReadContextWithAdmission(
  pathname: string,
  captureAdmission: (pathname: string) => OmnipolymathStateWorkerContext["admission"],
  knownIdentity: (pathname: string) => DatabasePathIdentity | undefined,
): Pick<
  OmnipolymathStateWorkerContext,
  | "admission"
  | "databaseEngineSelection"
  | "maintenanceScope"
  | "existingSchemaPath"
  | "gatewayServiceInstallation"
  | "runInCapturedSchemaScope"
  | "stateIntegrity"
  | "artifactPreservingReads"
  | "liveStateReads"
> & { assertPublicationCurrent: () => void } {
  const schema = captureOmnipolymathStateSchemaReadAdmission(pathname);
  const capturedAdmission = captureAdmission(pathname);
  const serviceInstallation = getGatewayServiceInstallation();
  const integrity = capturedAdmission.captureIntegrity?.();
  const assertPublicationCurrent = capturedAdmission.assertCurrent;
  let admission = capturedAdmission;
  let runInCapturedSchemaScope: OmnipolymathStateWorkerContext["runInCapturedSchemaScope"];
  if (schema) {
    const inCapturedScope = AsyncLocalStorage.snapshot();
    admission = {
      databasePath: capturedAdmission.databasePath,
      coordinationKey: capturedAdmission.coordinationKey,
      get identity() {
        return capturedAdmission.identity;
      },
      captureIntegrity: capturedAdmission.captureIntegrity,
      assertCurrent() {
        capturedAdmission.assertCurrent();
        schema.assertCurrent();
      },
    };
    runInCapturedSchemaScope = (operation) =>
      inCapturedScope(() => {
        admission.assertCurrent();
        return operation();
      });
  }
  return {
    databaseEngineSelection: getDatabaseEngineSelection(),
    maintenanceScope: getOmnipolymathDatabaseMaintenanceScope(),
    admission,
    assertPublicationCurrent,
    existingSchemaPath: schema?.path,
    // An unrelated installed service cannot change this database's worker policy.
    // Admission already resolved its aliases; warm captures need no filesystem reads.
    gatewayServiceInstallation:
      serviceInstallation &&
      knownIdentity(serviceInstallation.databasePath)?.key === capturedAdmission.identity.key
        ? serviceInstallation
        : undefined,
    stateIntegrity: integrity,
    runInCapturedSchemaScope,
    artifactPreservingReads: isArtifactPreservingStateRead("agent", pathname) || undefined,
    liveStateReads: isLiveStateRead() || undefined,
  };
}

/** Read-only workers need resolved runtime facts, not the initialization environment. */
export function captureOmnipolymathStateReadWorkerContextWithAdmission(
  options: { path?: string; env?: NodeJS.ProcessEnv },
  captureAdmission: (pathname: string) => OmnipolymathStateWorkerContext["admission"],
  knownIdentity: (pathname: string) => DatabasePathIdentity | undefined,
): OmnipolymathStateWorkerContext {
  const source = options.env ?? process.env;
  const env = process.platform === "win32" ? cloneEnvWithPlatformSemantics(source) : source;
  const environment: OmnipolymathStateWorkerContext["environment"] = {
    OMNIPOLYMATH_STATE_DIR: resolveStateDir(env),
    ...(isGatewayExternallySupervised(env) ? { OMNIPOLYMATH_SUPERVISOR_MODE: "external" } : {}),
  };
  return {
    ...captureOmnipolymathStateReadContextWithAdmission(
      options.path ?? resolveOmnipolymathStateSqlitePath(environment),
      captureAdmission,
      knownIdentity,
    ),
    environment,
  };
}

/** Capture host facts before asynchronous work, without opening SQLite. */
export function captureOmnipolymathStateWorkerContextWithAdmission(
  options: {
    path?: string;
    env?: NodeJS.ProcessEnv;
    initializationAgentPaths?: readonly string[];
  },
  captureAdmission: (pathname: string) => OmnipolymathStateWorkerContext["admission"],
  knownIdentity: (pathname: string) => DatabasePathIdentity | undefined,
): OmnipolymathStateWorkerContext {
  const context = captureOmnipolymathStateReadWorkerContextWithAdmission(
    options,
    captureAdmission,
    knownIdentity,
  );
  return {
    ...context,
    initializationCronDefaultStoreKey: resolveLegacyCronDefaultStoreKey(options.env ?? process.env),
    initializationEnvironment: mergeProcessEnv([
      options.env ?? process.env,
      { OMNIPOLYMATH_STATE_DIR: undefined, OMNIPOLYMATH_SUPERVISOR_MODE: undefined },
      context.environment,
    ]),
    ...(options.initializationAgentPaths
      ? {
          initializationAgentPaths: options.initializationAgentPaths.map((agentPath) =>
            path.resolve(agentPath),
          ),
        }
      : {}),
  };
}
