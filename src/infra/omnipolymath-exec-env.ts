import type { SystemRunExecutionContext } from "../../packages/gateway-protocol/src/system-run-execution-context.js";

export const OMNIPOLYMATH_CLI_ENV_VAR = "OMNIPOLYMATH_CLI";

/** Child-shell routing hint; it does not authenticate or authorize a Gateway caller. */
export const SUBAGENT_EXEC_ENV_VAR = "OMNIPOLYMATH_SUBAGENT_EXEC";

const CLI_ENV_VALUE = "1";

export function markOmnipolymathExecEnv<T extends Record<string, string | undefined>>(env: T): T {
  return {
    ...env,
    [OMNIPOLYMATH_CLI_ENV_VAR]: CLI_ENV_VALUE,
  };
}

export function ensureOmnipolymathExecMarkerOnProcess(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  env[OMNIPOLYMATH_CLI_ENV_VAR] = CLI_ENV_VALUE;
  return env;
}

export function buildExecRoutingEnv(
  context?: SystemRunExecutionContext,
): Record<string, string> | undefined {
  const { senderId, chatId, subagent } = context ?? {};
  if (!senderId && !chatId && !subagent) {
    return undefined;
  }
  return {
    ...(senderId || chatId
      ? {
          OMNIPOLYMATH_CHANNEL_CONTEXT: JSON.stringify({
            ...(senderId ? { sender: { id: senderId } } : {}),
            ...(chatId ? { chat: { id: chatId } } : {}),
          }),
        }
      : {}),
    ...(subagent ? { [SUBAGENT_EXEC_ENV_VAR]: "1" } : {}),
  };
}
