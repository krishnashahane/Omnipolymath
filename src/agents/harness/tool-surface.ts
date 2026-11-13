/** Whether a plugin harness constructs Omnipolymath tools inside its runtime. */
export function agentHarnessBuildsOmnipolymathTools(harnessId: string): boolean {
  return harnessId === "codex" || harnessId === "copilot";
}

export function agentHarnessExposesOmnipolymathTools(harnessId: string): boolean {
  return harnessId === "omnipolymath" || agentHarnessBuildsOmnipolymathTools(harnessId);
}
