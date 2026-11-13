import { MessagePort } from "node:worker_threads";
import { withSqliteWorkerOperationAdmissionAsync } from "../../infra/sqlite-worker-operation-admission.js";
import type { OmnipolymathAgentDatabaseValidation } from "../../state/omnipolymath-agent-db-validation-cache.js";
import {
  withOmnipolymathAgentDatabaseAdmission,
  type OmnipolymathAgentDatabase,
  type OmnipolymathAgentDatabaseOptions,
  type OmnipolymathAgentDatabaseWriteAdmission,
} from "../../state/omnipolymath-agent-db.js";
import { SqliteReclamationRequestRefusedError } from "./session-accessor.sqlite-reclamation-commit.js";

export function withWorkerWriteAdmission<T>(
  port: MessagePort,
  operationId: number,
  databaseOptions: OmnipolymathAgentDatabaseOptions,
  operation: (database: OmnipolymathAgentDatabase) => T | Promise<T>,
  assertSourceCurrent?: () => void,
): Promise<T> {
  let finalAdmission = false;
  const withAdmission: OmnipolymathAgentDatabaseWriteAdmission = async (run) => {
    const admission = await new Promise<{
      allowed: boolean;
      validation?: OmnipolymathAgentDatabaseValidation;
      integrityRevoked?: boolean;
      databaseAdmissionPort?: MessagePort;
    }>((resolve, reject) => {
      const receive = (admissionMessage: {
        type: string;
        operationId: number;
        allowed: boolean;
        validation?: OmnipolymathAgentDatabaseValidation;
        integrityRevoked?: boolean;
        databaseAdmissionPort?: MessagePort;
      }) => {
        cleanup();
        resolve(admissionMessage);
      };
      const closed = () => {
        cleanup();
        reject(new Error("SQLite reclamation parent closed during database admission"));
      };
      const cleanup = () => {
        port.off("message", receive);
        port.off("close", closed);
      };
      port.on("message", receive);
      port.once("close", closed);
      port.postMessage({
        type: "admission-request",
        operationId,
      });
    });
    const invoke = () =>
      run(
        () => {
          if (!admission.allowed) {
            throw new SqliteReclamationRequestRefusedError(
              "SQLite reclamation database admission was revoked",
            );
          }
          assertSourceCurrent?.();
        },
        admission.validation,
        admission.integrityRevoked,
      );
    const metadata = admission.databaseAdmissionPort;
    const value = await (async () => {
      try {
        return metadata instanceof MessagePort
          ? await withSqliteWorkerOperationAdmissionAsync({ port: metadata }, invoke)
          : await invoke();
      } finally {
        metadata?.close();
      }
    })();
    if (!finalAdmission) {
      port.postMessage({
        type: "admission-release",
        operationId,
      });
    }
    return value;
  };
  return withOmnipolymathAgentDatabaseAdmission(databaseOptions, withAdmission, (database) => {
    finalAdmission = true;
    return operation(database);
  });
}
