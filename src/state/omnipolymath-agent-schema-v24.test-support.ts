import { readFileSync } from "node:fs";

// Frozen before schema 25 retired writer-validation triggers; never derive migration input from its target.
export const OMNIPOLYMATH_AGENT_SCHEMA_V24_SQL = readFileSync(
  new URL("../../test/fixtures/sqlite/omnipolymath-agent-schema-v24.sql", import.meta.url),
  "utf8",
);
