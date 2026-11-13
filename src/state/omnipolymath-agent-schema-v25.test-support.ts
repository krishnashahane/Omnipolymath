import { readFileSync } from "node:fs";

// Frozen before schema 26 promoted JSON predicates; migration input must not follow its target.
export const OMNIPOLYMATH_AGENT_SCHEMA_V25_SQL = readFileSync(
  new URL("../../test/fixtures/sqlite/omnipolymath-agent-schema-v25.sql", import.meta.url),
  "utf8",
);
