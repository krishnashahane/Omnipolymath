import { openOmnipolymathAgentDatabase } from "../../state/omnipolymath-agent-db.js";
import { withOmnipolymathTestState } from "../../test-utils/omnipolymath-test-state.js";
import type { OmnipolymathTestState } from "../../test-utils/omnipolymath-test-state.js";

export function transcriptScope(env: NodeJS.ProcessEnv, sessionId: string, storePath: string) {
  return { agentId: "main", env, sessionId, sessionKey: `agent:main:${sessionId}`, storePath };
}

export function withTranscriptDatabase<T>(
  sessionId: string,
  run: (fixture: {
    state: OmnipolymathTestState;
    database: ReturnType<typeof openOmnipolymathAgentDatabase>;
    scope: ReturnType<typeof transcriptScope>;
  }) => Promise<T>,
) {
  return withOmnipolymathTestState({ scenario: "minimal" }, (state) => {
    const database = openOmnipolymathAgentDatabase({ agentId: "main", env: state.env });
    return run({ state, database, scope: transcriptScope(state.env, sessionId, database.path) });
  });
}
