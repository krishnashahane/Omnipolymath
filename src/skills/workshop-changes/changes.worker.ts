import { runOmnipolymathStateWriteTransaction } from "../../state/omnipolymath-state-db.js";
import type { WorkerOperationHandlers } from "../../state/worker-operation-registry.js";
import {
  listWorkshopChangesInDatabase,
  recordWorkshopChangeInDatabase,
  type WorkshopChange,
  type WorkshopChangesQuery,
} from "./changes.kernel.js";

export const skillWorkshopOperations = {
  "skills.workshop.changes.list": (input: WorkshopChangesQuery, { open }) =>
    listWorkshopChangesInDatabase(open().db, input),
  "skills.workshop.changes.record": (input: WorkshopChange, { open, stateOptions }) =>
    runOmnipolymathStateWriteTransaction(
      (current) => recordWorkshopChangeInDatabase(current, input),
      { database: open(), ...stateOptions() },
      { operationLabel: "skill-workshop.changes.record" },
    ),
} satisfies WorkerOperationHandlers;
