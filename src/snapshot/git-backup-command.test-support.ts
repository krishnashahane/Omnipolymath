import { backupGitCreateCommand } from "../commands/backup-git.js";
import { defaultRuntime } from "../runtime.js";
import { closeOmnipolymathAgentDatabasesAsync } from "../state/omnipolymath-agent-db.js";
import { closeOmnipolymathStateDatabaseAsync } from "../state/omnipolymath-state-db.js";

try {
  const agentId = process.argv[3];
  await backupGitCreateCommand(defaultRuntime, {
    repository: process.argv[2],
    ...(agentId ? { agents: [agentId] } : { all: true }),
    json: true,
  });
} finally {
  await closeOmnipolymathAgentDatabasesAsync();
  await closeOmnipolymathStateDatabaseAsync();
}
