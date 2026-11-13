import { runOmnipolymathStateWriteTransaction } from "../../state/omnipolymath-state-db.js";
import type { WorkerOperationHandlers } from "../../state/worker-operation-registry.js";
import {
  readSkillUsageInDatabase,
  recordSkillUsageInDatabase,
  type PreparedSkillUsage,
} from "./skill-usage.kernel.js";

export const skillUsageOperations = {
  "skills.usage.read": (input: { skillFiles: readonly string[] }, { open }) =>
    readSkillUsageInDatabase(open(), input.skillFiles),
  "skills.usage.record": (input: PreparedSkillUsage, { open, stateOptions }) =>
    runOmnipolymathStateWriteTransaction((current) => recordSkillUsageInDatabase(current, input), {
      database: open(),
      ...stateOptions(),
    }),
} satisfies WorkerOperationHandlers;
