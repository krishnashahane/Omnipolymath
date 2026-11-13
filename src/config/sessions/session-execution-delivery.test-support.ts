import type {
  AgentDatabaseExecutionScope,
  OmnipolymathAgentDatabaseExecution,
} from "../../state/omnipolymath-agent-execution-contract.js";

type ExecutionModule = typeof import("../../state/omnipolymath-agent-execution.js");

/** Keep native execution real while each fixture owns its delivery hooks. */
export function decorateSessionExecutionCaptures(
  actual: ExecutionModule,
  decorateWorker: (worker: AgentDatabaseExecutionScope) => AgentDatabaseExecutionScope,
  release?: (owner: OmnipolymathAgentDatabaseExecution) => Promise<void>,
): Pick<
  ExecutionModule,
  "captureOmnipolymathAgentDatabaseExecution" | "captureOmnipolymathAgentDatabasePreparationExecution"
> {
  const decorate = (owner: OmnipolymathAgentDatabaseExecution): OmnipolymathAgentDatabaseExecution => ({
    ...owner,
    get fileIdentity() {
      return owner.fileIdentity;
    },
    runExisting: (source, operation, options) =>
      owner.runExisting(source, (worker) => operation(decorateWorker(worker)), options),
    ...(release ? { release: () => release(owner) } : {}),
  });
  return {
    captureOmnipolymathAgentDatabaseExecution: (
      ...args: Parameters<typeof actual.captureOmnipolymathAgentDatabaseExecution>
    ) => decorate(actual.captureOmnipolymathAgentDatabaseExecution(...args)),
    captureOmnipolymathAgentDatabasePreparationExecution: (
      ...args: Parameters<typeof actual.captureOmnipolymathAgentDatabasePreparationExecution>
    ) => decorate(actual.captureOmnipolymathAgentDatabasePreparationExecution(...args)),
  };
}
