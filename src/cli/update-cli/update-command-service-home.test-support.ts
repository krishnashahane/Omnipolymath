import fs from "node:fs/promises";
import path from "node:path";
import { expect, vi } from "vitest";
import * as omnipolymathTmp from "../../infra/tmp-omnipolymath-dir.js";
import { resolveManagedUpdateLeaseDatabasePath } from "../../infra/update-managed-service-handoff-lease.js";
import { withTestDir } from "../../test-helpers/temp-dir.js";
import { withEnvAsync } from "../../test-utils/env.js";

export async function withServiceHome(run: (home: string) => Promise<void>): Promise<void> {
  await withTestDir({ prefix: "omnipolymath-update-service-" }, async (home) => {
    const temporary = vi.spyOn(omnipolymathTmp, "resolvePreferredOmnipolymathTmpDir").mockReturnValue(home);
    try {
      const databasePath = resolveManagedUpdateLeaseDatabasePath();
      expect(databasePath).toBe(path.join(home, "managed-update-handoffs.sqlite"));
      expect(await fs.realpath(path.dirname(databasePath))).toBe(home);
      await withEnvAsync(
        {
          HOME: home,
          USERPROFILE: home,
          APPDATA: path.join(home, "AppData"),
          OMNIPOLYMATH_GATEWAY_PORT: undefined,
          OMNIPOLYMATH_HOME: undefined,
          OMNIPOLYMATH_STATE_DIR: undefined,
          OMNIPOLYMATH_CONFIG_PATH: undefined,
          OMNIPOLYMATH_PROFILE: undefined,
          OMNIPOLYMATH_SUPERVISOR_MODE: undefined,
          OMNIPOLYMATH_SERVICE_MARKER: undefined,
          OMNIPOLYMATH_SERVICE_KIND: undefined,
        },
        () => run(home),
      );
    } finally {
      temporary.mockRestore();
    }
  });
}
