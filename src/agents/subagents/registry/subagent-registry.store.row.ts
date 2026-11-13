import type { Selectable } from "kysely";
import type { DB as OmnipolymathStateKyselyDatabase } from "../../../state/omnipolymath-state-db.generated.js";

export type SubagentRunSqliteRow = Selectable<OmnipolymathStateKyselyDatabase["subagent_runs"]>;
