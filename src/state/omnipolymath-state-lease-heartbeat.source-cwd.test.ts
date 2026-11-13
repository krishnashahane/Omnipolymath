import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { withOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { withTempDir } from "../test-utils/temp-dir.js";
import { closeOmnipolymathStateDatabaseByPath } from "./omnipolymath-state-db-cache.js";
import { openOmnipolymathStateDatabase } from "./omnipolymath-state-db.js";

it("starts the real source heartbeat from a foreign cwd using the selected tsconfig", async () => {
  await withOmnipolymathTestState({ label: "heartbeat-source-cwd" }, async (state) => {
    const databasePath = openOmnipolymathStateDatabase({ env: state.env }).path;
    closeOmnipolymathStateDatabaseByPath(databasePath);
    await withTempDir("heartbeat-source-cwd-", async (cwd) => {
      const leaseModule = new URL("./omnipolymath-state-lease.ts", import.meta.url).href;
      const databaseModule = new URL("./omnipolymath-state-db.ts", import.meta.url).href;
      const script = `
        import assert from "node:assert/strict";
        import { withOmnipolymathStateLease } from ${JSON.stringify(leaseModule)};
        import { openOmnipolymathStateDatabase, closeOmnipolymathStateDatabaseForTest } from ${JSON.stringify(databaseModule)};
        try {
          await withOmnipolymathStateLease({
            scope: "core:heartbeat-source-cwd", key: "source",
            database: { scope: "shared", options: { env: process.env } },
            leaseMs: 10000, waitMs: 0, heartbeat: "worker",
          }, async (lease) => { lease.assertOwned(); });
          const { db } = openOmnipolymathStateDatabase({ env: process.env });
          assert.equal(db.prepare("SELECT count(*) AS n FROM state_leases WHERE scope = ?")
            .get("core:heartbeat-source-cwd").n, 0);
          console.log("heartbeat settled");
        } finally { closeOmnipolymathStateDatabaseForTest(); }
      `;
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          "--import",
          fileURLToPath(new URL("../../scripts/tsx.mjs", import.meta.url)),
          "--input-type=module",
          "--eval",
          script,
        ],
        {
          cwd,
          env: {
            ...state.env,
            TSX_TSCONFIG_PATH: fileURLToPath(new URL("../../tsconfig.json", import.meta.url)),
          },
          timeout: 30000,
        },
      );
      expect(stdout.trim()).toBe("heartbeat settled");
    });
  });
});
