import type { Insertable } from "kysely";
import type { DB as OmnipolymathAgentKyselyDatabase } from "../state/omnipolymath-agent-db.generated.js";

export type MessageToolRunOutcomeInsert = Insertable<
  OmnipolymathAgentKyselyDatabase["message_tool_run_outcomes"]
>;
