import { withWorkspaceStatePublication } from "../agents/workspace-state-publication.js";
import { createSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import { withOmnipolymathStateLeasesWorkerAdmission } from "../state/omnipolymath-state-lease-worker-owner.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";
import { runOmnipolymathStateWorkerOperation } from "../state/omnipolymath-state-worker-store.js";
import type { TemplateAddStateWorkerOperations } from "./add-state-worker-contract.js";
import type { TemplateMutationStateOptions } from "./state-mutation-options.js";

export type { TemplateMutationStateOptions } from "./state-mutation-options.js";

export async function executeTemplateMutationStateCommand<
  Key extends keyof TemplateAddStateWorkerOperations,
>(
  options: TemplateMutationStateOptions,
  command: { type: Key; input: Omit<TemplateAddStateWorkerOperations[Key]["input"], "leases"> },
): Promise<TemplateAddStateWorkerOperations[Key]["output"]> {
  if (options.database) {
    throw new Error("Worker-mode Template lifecycle cannot use a caller-owned database handle.");
  }
  const context = options.leaseSet?.context ?? captureOmnipolymathStateWorkerContext(options);
  const assertCurrent = options.assertCurrent;
  await options.prepareEffect?.();
  if (options.leaseSet) {
    return withOmnipolymathStateLeasesWorkerAdmission(
      options.leaseSet.leases,
      context,
      (admission) =>
        runOmnipolymathStateWorkerOperation(
          context,
          (scope) =>
            scope.execute({
              ...command,
              input: { ...command.input, leases: admission.identities },
            }),
          {
            assertCurrent: admission.assertCurrent,
            createAdmission: withWorkspaceStatePublication(context, admission.createAdmission),
          },
        ),
      { assertCurrent: () => assertCurrent?.() },
    );
  }
  return runOmnipolymathStateWorkerOperation(context, (scope) => scope.execute(command), {
    assertCurrent,
    createAdmission: withWorkspaceStatePublication(context, () => ({
      nativeLocations: [context.admission.databasePath],
      admission: createSqliteWorkerOperationAdmission((request, grant) => {
        if (request.stage !== "transaction" && request.stage !== "commit") {
          throw new Error("Template lifecycle state writes require transaction admission.");
        }
        context.admission.assertCurrent();
        assertCurrent?.();
        grant();
      }),
    })),
  });
}
