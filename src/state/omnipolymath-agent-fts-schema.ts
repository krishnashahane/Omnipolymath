import { getSqliteMemorySearchFtsSchemas } from "../infra/database-engine/sqlite-memory-search-fragments.js";
import { OMNIPOLYMATH_AGENT_SCHEMA_SQL } from "./omnipolymath-agent-schema.js";

/** Static agent DDL and the memory owner's lazily installed FTS definitions. */
export const AGENT_FTS_SCHEMAS = [OMNIPOLYMATH_AGENT_SCHEMA_SQL, ...getSqliteMemorySearchFtsSchemas()];
