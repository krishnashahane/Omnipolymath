import { DatabaseSync } from "node:sqlite";
import { vi } from "vitest";
import type { OmnipolymathStateWorkerOperations } from "../state/omnipolymath-state-worker-contract.js";
import type { runOmnipolymathStateWorkerOperation } from "../state/omnipolymath-state-worker-store.js";
import type { DomainScope } from "../state/omnipolymath-state-worker-store.types.js";
import { isSqliteLockError } from "./sqlite-error-diagnostics.js";
import type { createSqliteWorkerOperationAdmission } from "./sqlite-worker-operation-admission.js";

type Admit = Parameters<typeof createSqliteWorkerOperationAdmission>[0];
type Run = typeof runOmnipolymathStateWorkerOperation;
type CommandProbe = <Key extends keyof OmnipolymathStateWorkerOperations>(
  command: { type: Key; input: OmnipolymathStateWorkerOperations[Key]["input"] },
  options: Parameters<DomainScope["execute"]>[1],
  scope: DomainScope,
  context: Parameters<Run>[0],
) => Promise<OmnipolymathStateWorkerOperations[Key]["output"]>;

export const sqliteWorkerOwnerProbe = {
  writerLock(path: string) {
    const competitor = new DatabaseSync(path);
    competitor.exec("PRAGMA busy_timeout = 0");
    const observed: string[] = [];
    return {
      observed,
      observe(stage: string) {
        if (stage !== "transaction" && stage !== "commit") {
          return;
        }
        try {
          competitor.exec("BEGIN IMMEDIATE");
          competitor.exec("ROLLBACK");
          observed.push(`${stage}:free`);
        } catch (error) {
          if (!isSqliteLockError(error)) {
            throw error;
          }
          observed.push(`${stage}:held`);
        }
      },
      [Symbol.dispose]() {
        competitor.close();
      },
    };
  },
  admission(
    module: { createSqliteWorkerOperationAdmission: typeof createSqliteWorkerOperationAdmission },
    intercept: (...args: [...Parameters<Admit>, Admit]) => void,
  ) {
    const create = module.createSqliteWorkerOperationAdmission;
    return vi
      .spyOn(module, "createSqliteWorkerOperationAdmission")
      .mockImplementation((admit, attachment) =>
        create((request, grant) => intercept(request, grant, admit), attachment),
      );
  },

  command(
    module: { runOmnipolymathStateWorkerOperation: Run },
    intercept: CommandProbe,
    options: { once?: boolean; original?: Run } = {},
  ) {
    const run = options.original ?? module.runOmnipolymathStateWorkerOperation;
    const spy = vi.spyOn(module, "runOmnipolymathStateWorkerOperation");
    return spy[options.once ? "mockImplementationOnce" : "mockImplementation"](
      (context, operation, runOptions) =>
        run(
          context,
          (scope) =>
            operation({ execute: (command, args) => intercept(command, args, scope, context) }),
          runOptions,
        ),
    );
  },
};
