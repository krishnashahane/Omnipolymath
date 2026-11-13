import { vi } from "vitest";
import * as existingWrites from "../../state/omnipolymath-state-db-existing-write.js";

export function beforeIntentWriteAdmission(operation: () => void) {
  const write = existingWrites.runExistingOmnipolymathStateWriteTransaction;
  vi.spyOn(existingWrites, "runExistingOmnipolymathStateWriteTransaction").mockImplementation(
    (mutate, options, contract) => {
      if (contract.operationLabel === "gateway.restart-intent.write") {
        operation();
      }
      return write(mutate, options, contract);
    },
  );
}
