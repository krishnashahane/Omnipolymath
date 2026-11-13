import { executeExistingOmnipolymathStateRead } from "../state/omnipolymath-state-db-readonly.js";
import type { OmnipolymathStateDatabaseOptions } from "../state/omnipolymath-state-db.js";
import type { OmnipolymathStateReadOptions } from "../state/omnipolymath-state-read.types.js";
import type { TemplateInventory } from "./inventory-read.kernel.js";

export async function readTemplateInventory(
  options: OmnipolymathStateDatabaseOptions = {},
  readOptions?: OmnipolymathStateReadOptions,
): Promise<TemplateInventory> {
  const reply = await executeExistingOmnipolymathStateRead(
    options,
    { type: "templates.inventory" },
    readOptions,
  );
  if (!reply) {
    return { installs: [], packages: [], workspaceFiles: [], mcpServers: [], cronJobs: [] };
  }
  return reply.inventory;
}
