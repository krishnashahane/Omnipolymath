import { getEnvironmentData } from "node:worker_threads";
import {
  getDatabaseEngineInput,
  getDatabaseEngineSelection,
} from "../infra/database-engine/context.js";

export function stateEngineInput() {
  const selected = getDatabaseEngineSelection();
  if (selected) {
    return getDatabaseEngineInput("state");
  }
  const connection: unknown =
    process.env.NODE_ENV === "test"
      ? getEnvironmentData("omnipolymath.test.state.connection")
      : undefined;
  return typeof connection === "string" ? { connection, schemaPrefix: "omnipolymath_test" } : undefined;
}
