import fs from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { readUpdatePhysicalDatabaseGenerations } from "../infra/update-physical-database-generations.js";
import { closeOmnipolymathAgentDatabaseByPathAsync } from "../state/omnipolymath-agent-db-lifecycle.js";
import { openOmnipolymathAgentDatabase } from "../state/omnipolymath-agent-db.js";
import { closeOmnipolymathStateDatabaseAsync } from "../state/omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "../state/omnipolymath-state-db.paths.js";
import { withOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { createDoctorMaintenanceState } from "./doctor-maintenance-state.js";

it("drains an admitted custom agent outside the state root and retains original write capture", async () => {
  await withOmnipolymathTestState({ scenario: "external-service", layout: "split" }, async (state) => {
    const pathname = state.path("custom-agent", "omnipolymath-agent.sqlite");
    const seeded = openOmnipolymathAgentDatabase({ agentId: "main", path: pathname, env: state.env });
    await closeOmnipolymathAgentDatabaseByPathAsync(seeded.path, "main");
    await closeOmnipolymathStateDatabaseAsync();
    const db = openNodeSqliteDatabase(pathname);
    db.exec(
      "PRAGMA auto_vacuum=NONE; VACUUM; CREATE TABLE retained(value TEXT); INSERT INTO retained VALUES('custom agent');",
    );
    db.close();
    expect(pathname.startsWith(`${state.stateDir}${path.sep}`)).toBe(false);

    const unrelatedEnv = { ...state.env, OMNIPOLYMATH_STATE_DIR: state.path("unrelated-state") };
    const unrelated = openOmnipolymathAgentDatabase({ agentId: "other", env: unrelatedEnv });
    const sharedPath = resolveOmnipolymathStateSqlitePath(state.env);
    const generations = await readUpdatePhysicalDatabaseGenerations([sharedPath, pathname]);
    const controller = new AbortController();
    const maintenance = await createDoctorMaintenanceState({
      params: {
        root: null,
        options: { repair: true, nonInteractive: true },
        runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
        databaseGenerations: generations,
      },
      env: state.env,
      signal: controller.signal,
      deadline: () => undefined,
      assertReadCurrent() {},
      settle: (operation) => operation(),
      warn: vi.fn(),
    });
    try {
      await maintenance.acquire();
      // A bootstrap handle under the owner but outside its resources scope must
      // still settle. Root-filtered drainage alone cannot find this custom path.
      const held = maintenance.owner!.run(() =>
        openOmnipolymathAgentDatabase({
          agentId: "main",
          path: pathname,
          env: state.env,
        }),
      );
      expect(held.db.isOpen).toBe(true);
      await expect(
        maintenance.enableSqliteReclamation([
          {
            agentId: "main",
            path: pathname,
            realPath: fs.realpathSync(pathname),
            source: "configured",
          },
        ]),
      ).resolves.toEqual({ warnings: [] });
      expect(held.db.isOpen).toBe(false);
      expect(unrelated.db.isOpen).toBe(true);
      const observed = openNodeSqliteDatabase(pathname, { readOnly: true });
      try {
        expect(observed.prepare("PRAGMA auto_vacuum").get()?.auto_vacuum).toBe(2);
        expect(observed.prepare("SELECT value FROM retained").get()?.value).toBe("custom agent");
      } finally {
        observed.close();
      }
      expect(maintenance.receipt).toBeUndefined();
      await maintenance.release();
      expect(maintenance.receipt).toMatchObject({ unchanged: false });
      expect(maintenance.receipt?.generations[pathname]).not.toBe(generations[pathname]);
    } finally {
      await maintenance.release();
      await closeOmnipolymathAgentDatabaseByPathAsync(unrelated.path, "other");
    }
  });
});
