import type { EngineConnection } from "../infra/sql-connection.js";
import type { OmnipolymathStateReadCommand } from "../state/omnipolymath-state-read.types.js";
import { readTemplateInventoryInDatabase } from "./inventory-read.kernel.js";

type TemplateStateReadCommand = Extract<OmnipolymathStateReadCommand, { type: "templates.inventory" }>;

export function readTemplateStateCommandInDatabase(
  db: EngineConnection,
  command: TemplateStateReadCommand,
) {
  return { type: command.type, inventory: readTemplateInventoryInDatabase(db) };
}
