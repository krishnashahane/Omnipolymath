import path from "node:path";
import { isRecord } from "@omnipolymath/normalization-core/record-coerce";
import { throwSqliteLifecycleErrors } from "../infra/sqlite-lifecycle-errors.js";
import {
  assertDatabasePathIdentity,
  readDatabasePathIdentitySync,
} from "../infra/sqlite-worker-identity.js";
import { observeSqliteWorkerCommittedFacts } from "../infra/sqlite-worker-operation-admission.js";
import type { SqliteWorkerOperationSettlement } from "../infra/sqlite-worker-operation-settlement.js";
import { createSqliteWorkerWriteAdmission } from "../infra/sqlite-worker-store.js";
import type { OmnipolymathAgentDatabaseRegistrationCommit } from "./omnipolymath-agent-db-contract.js";
import {
  agentDatabaseLifecycle,
  closeOmnipolymathAgentDatabaseByPathAsync,
  revokePendingAgentDatabaseOpen,
} from "./omnipolymath-agent-db-lifecycle.js";
import {
  captureOmnipolymathAgentDatabaseRegistration,
  prepareOmnipolymathAgentDatabaseRegistrySnapshotRead,
} from "./omnipolymath-agent-db-registry-listing.js";
import { withAgentDatabaseCloseFence } from "./omnipolymath-agent-db-resources.js";
import { invalidateOmnipolymathAgentDatabaseValidation } from "./omnipolymath-agent-db-validation-cache.js";
import { isSameOmnipolymathAgentDatabasePath } from "./omnipolymath-agent-db.paths.js";
import { captureOmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.js";
import { runOmnipolymathStateWorkerOperation } from "./omnipolymath-state-worker-store.js";

/** Join one unambiguous transient owner before removing its durable registration. */
export async function disposeOmnipolymathAgentDatabaseByPath(
  databasePath: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<boolean> {
  const resolvedPath = path.resolve(databasePath);
  const pending = [...agentDatabaseLifecycle.activePending].filter((owner) =>
    isSameOmnipolymathAgentDatabasePath(owner.path, resolvedPath),
  );
  const retained = [...agentDatabaseLifecycle.retainedCloses].filter((owner) =>
    isSameOmnipolymathAgentDatabasePath(owner.path, resolvedPath),
  );
  const native = [...agentDatabaseLifecycle.databases.values()].filter((database) =>
    isSameOmnipolymathAgentDatabasePath(database.path, resolvedPath),
  );
  const database = native[0];
  const identity = readDatabasePathIdentitySync(resolvedPath);
  const context =
    native.length <= 1 && (identity.key.startsWith("file:") || database)
      ? captureOmnipolymathStateWorkerContext({
          env: options.env ?? (database && agentDatabaseLifecycle.leases.get(database.path)?.env),
        })
      : undefined;
  const paths = [
    ...new Set([
      resolvedPath,
      identity.canonicalPath,
      ...pending.map((owner) => owner.path),
      ...retained.map((owner) => owner.path),
      ...native.map((owner) => owner.path),
    ]),
  ];
  const assertCurrent = () => {
    context?.admission.assertCurrent();
    context?.maintenanceScope?.assertAdmission();
    for (const pathname of paths) {
      assertDatabasePathIdentity(pathname, identity);
    }
  };
  const dispose = async () => {
    for (const pathname of paths) {
      invalidateOmnipolymathAgentDatabaseValidation(pathname);
    }
    for (const owner of pending) {
      revokePendingAgentDatabaseOpen(owner.path, owner.agentId);
    }
    for (const owner of retained) {
      owner.close();
    }
    await Promise.allSettled(pending.map((owner) => owner.promise));
    assertCurrent();
    if (native.length > 1) {
      throw new Error(`Agent database disposal has multiple native owners: ${resolvedPath}`);
    }
    const closeCapturedPaths = async (additionalPath?: string) => {
      assertCurrent();
      const closePaths = additionalPath ? [...new Set([...paths, additionalPath])] : paths;
      const results = await Promise.allSettled(
        closePaths.map((pathname) => closeOmnipolymathAgentDatabaseByPathAsync(pathname)),
      );
      assertCurrent();
      throwSqliteLifecycleErrors(
        results.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
        "Agent disposal resource drainage failed",
      );
      return results.some((result) => result.status === "fulfilled" && result.value);
    };
    if (!context) {
      await closeCapturedPaths();
      return false;
    }
    let target = database && { agentId: database.agentId, path: database.path };
    if (!target) {
      const read = prepareOmnipolymathAgentDatabaseRegistrySnapshotRead({ env: context.environment });
      const snapshot = await read.read();
      assertCurrent();
      snapshot.assertCurrent();
      if (snapshot.result.status !== "available") {
        throw new Error("Transient agent disposal cannot read its shared registry");
      }
      const [match, ...ambiguous] = snapshot.result.entries.filter((entry) =>
        isSameOmnipolymathAgentDatabasePath(entry.path, resolvedPath),
      );
      if (ambiguous.length) {
        throw new Error(`Agent database disposal has multiple registered owners: ${resolvedPath}`);
      }
      if (!match) {
        await closeCapturedPaths();
        return false;
      }
      target = match;
    }
    const owned = target;
    const assertOwned = () => {
      assertCurrent();
      assertDatabasePathIdentity(owned.path, identity);
    };
    return withAgentDatabaseCloseFence({ path: owned.path }, async () => {
      assertOwned();
      invalidateOmnipolymathAgentDatabaseValidation(owned.path);
      await closeCapturedPaths(owned.path);
      assertOwned();
      const publication = captureOmnipolymathAgentDatabaseRegistration({
        kind: "remove",
        agentId: owned.agentId,
        agentPath: owned.path,
        admission: context.admission,
        assertPublicationCurrent: context.assertPublicationCurrent,
      });
      let settlement: Promise<SqliteWorkerOperationSettlement> | undefined;
      let committed = false;
      const record = (receipt: OmnipolymathAgentDatabaseRegistrationCommit) => {
        publication.recordCommitted(receipt);
        committed = true;
      };
      const errors: unknown[] = [];
      try {
        const receipt = await runOmnipolymathStateWorkerOperation(
          context,
          (scope) =>
            scope.execute({
              type: "agentDatabaseRegistry.remove",
              input: { agentId: owned.agentId, agentPath: owned.path, identity },
            }),
          {
            assertCurrent: assertOwned,
            createAdmission(operation) {
              settlement = operation.settled;
              const admission = createSqliteWorkerWriteAdmission(
                (request) => {
                  assertOwned();
                  if (request.stage === "transaction") {
                    publication.begin();
                  }
                },
                [context.admission.databasePath, owned.path, ...paths],
              )(operation);
              observeSqliteWorkerCommittedFacts(admission.admission, ({ facts }) => {
                if (
                  !isRecord(facts) ||
                  typeof facts.agentId !== "string" ||
                  typeof facts.agentPath !== "string" ||
                  typeof facts.stateDatabasePath !== "string" ||
                  typeof facts.stateDatabaseIdentity !== "string"
                ) {
                  throw new Error("Agent disposal returned an invalid registry receipt");
                }
                record({
                  agentId: facts.agentId,
                  agentPath: facts.agentPath,
                  stateDatabasePath: facts.stateDatabasePath,
                  stateDatabaseIdentity: facts.stateDatabaseIdentity,
                });
              });
              return admission;
            },
          },
        );
        if (!committed) {
          record(receipt);
        }
      } catch (error) {
        errors.push(error);
      }
      try {
        publication.finish(await settlement);
      } catch (error) {
        errors.push(error);
      }
      throwSqliteLifecycleErrors(errors, "Agent disposal and registry publication failed");
      assertOwned();
      return true;
    });
  };
  // A lexical alias and the physical owner retain the same exclusion through publication.
  const fence = (index: number): Promise<boolean> =>
    index === paths.length
      ? dispose()
      : withAgentDatabaseCloseFence({ path: paths[index]! }, () => fence(index + 1));
  return fence(0);
}
