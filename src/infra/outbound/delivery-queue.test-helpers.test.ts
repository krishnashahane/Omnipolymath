import fs from "node:fs";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  isOmnipolymathStateDatabaseOpen,
  openOmnipolymathStateDatabase,
} from "../../state/omnipolymath-state-db.js";
import { installDeliveryQueueTmpDirHooks } from "./delivery-queue.test-helpers.js";

describe("installDeliveryQueueTmpDirHooks", () => {
  let caseDir = "";

  // Parent hooks run after the fixture's inner afterEach, before its afterAll.
  afterEach(() => {
    expect(isOmnipolymathStateDatabaseOpen()).toBe(false);
  });

  afterAll(() => {
    expect(fs.existsSync(caseDir)).toBe(false);
  });

  describe("per-case cleanup", () => {
    const { tmpDir } = installDeliveryQueueTmpDirHooks();

    it("closes state per case and removes the directory after the suite", () => {
      caseDir = tmpDir();
      openOmnipolymathStateDatabase({ env: { ...process.env, OMNIPOLYMATH_STATE_DIR: caseDir } });
      expect(isOmnipolymathStateDatabaseOpen()).toBe(true);
      expect(fs.existsSync(caseDir)).toBe(true);
    });
  });
});
