import {
  closeOmnipolymathStateDatabaseForTest,
  openOmnipolymathStateDatabase,
} from "../state/omnipolymath-state-db.js";

/** Each profile needs the shared database and its matching local credential owner. */
export function initializeExistingUpdateProfile(env: NodeJS.ProcessEnv = process.env): void {
  openOmnipolymathStateDatabase({ env });
  closeOmnipolymathStateDatabaseForTest();
}
