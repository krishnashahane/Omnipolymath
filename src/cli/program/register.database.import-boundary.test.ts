import { expect, it } from "vitest";
import { findSourceImportBackedges } from "../../../test/helpers/source-import-closure.js";

it("keeps database registration independent of schema and ownership operation runtimes", () => {
  expect(
    findSourceImportBackedges("src/cli/program/register.database.ts", [
      "src/state/omnipolymath-agent-schema-inspection.ts",
      "src/state/omnipolymath-database-preflight.ts",
      "src/state/omnipolymath-state-db-maintenance.ts",
      "src/state/omnipolymath-state-ownership-operations.ts",
      "src/state/omnipolymath-state-ownership.ts",
    ]),
  ).toEqual([]);
});
