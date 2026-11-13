import fs from "node:fs/promises";
import path from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import { requireNodeSqlite } from "../../infra/node-sqlite.js";
import * as snapshotSource from "../../infra/sqlite-snapshot-source.js";
import type { loadInstalledPluginIndexInstallRecords } from "../../plugins/installed-plugin-index-record-reader.js";
import { createPluginCache, withPluginCache } from "../../plugins/plugin-cache.js";
import { OMNIPOLYMATH_STATE_SCHEMA_VERSION } from "../../state/omnipolymath-state-db-contract.js";
import { closeOmnipolymathStateDatabaseAsync } from "../../state/omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "../../state/omnipolymath-state-db.paths.js";
import { OMNIPOLYMATH_STATE_SCHEMA_SQL } from "../../state/omnipolymath-state-schema.js";
import type { gatherDaemonStatus } from "./status.gather.js";

type Status = Awaited<ReturnType<typeof gatherDaemonStatus>>;
type InstalledRecordReader = typeof loadInstalledPluginIndexInstallRecords;

function officialPlugin(pluginId: string, resolvedVersion: string) {
  return {
    [pluginId]: { source: "npm", resolvedName: `@omnipolymath/${pluginId}`, resolvedVersion },
  };
}

export function registerStatusInstallRecordReadTests(opts: {
  captureLogs: (status: Status) => string;
  gatherStatus: () => Promise<Status>;
  setGatewayProbe: (probe: unknown) => void;
  setInstallRecordReader: (reader: InstalledRecordReader) => void;
  withStateConfig: <T>(run: () => Promise<T>) => Promise<T>;
}) {
  it("reports plugin drift without staging an unowned state database", async () => {
    const actual = await vi.importActual<{
      loadInstalledPluginIndexInstallRecords: InstalledRecordReader;
    }>("../../plugins/installed-plugin-index-record-reader.js");
    onTestFinished(() => closeOmnipolymathStateDatabaseAsync());
    using copy = vi
      .spyOn(snapshotSource, "prepareSqliteReadOnlyLocationAwaited")
      .mockRejectedValue(Object.assign(new Error("snapshot disk full"), { code: "ENOSPC" }));
    opts.setGatewayProbe({
      ok: true,
      url: "ws://127.0.0.1:19001",
      error: null,
      server: { version: "2026.5.4", connId: "c1" },
    });
    await opts.withStateConfig(async () => {
      const databasePath = resolveOmnipolymathStateSqlitePath();
      await fs.mkdir(path.dirname(databasePath), { recursive: true });
      const database = new (requireNodeSqlite().DatabaseSync)(databasePath);
      try {
        database.exec(
          `${OMNIPOLYMATH_STATE_SCHEMA_SQL}; PRAGMA user_version = ${OMNIPOLYMATH_STATE_SCHEMA_VERSION}`,
        );
        database.prepare("INSERT INTO config_machine_state VALUES (?, ?, ?)").run(
          "plugins.installedIndex",
          JSON.stringify({
            index: {
              installRecords: {
                brave: {
                  source: "npm",
                  spec: "@omnipolymath/brave-plugin@2026.5.3",
                  resolvedName: "@omnipolymath/brave-plugin",
                  resolvedVersion: "2026.5.3",
                },
                ...officialPlugin("whatsapp", "2026.5.4"),
              },
            },
          }),
          123,
        );
      } finally {
        database.close();
      }
      opts.setInstallRecordReader(actual.loadInstalledPluginIndexInstallRecords);
      await using cache = createPluginCache();
      const status = await withPluginCache(cache, opts.gatherStatus);
      expect(copy).not.toHaveBeenCalled();
      expect(status.pluginVersionDrift?.gatewayVersion).toBe("2026.5.4");
      expect(status.pluginVersionDrift?.drifts.map((drift) => drift.pluginId)).toEqual(["brave"]);
      expect(status.pluginVersionDrift?.drifts[0]?.targetResolution).toBeUndefined();
      const output = opts.captureLogs(status);
      expect(output).toContain("Plugin version drift: 1 active official plugin");
      expect(output).toContain("omnipolymath gateway status --deep");
      expect(output).not.toContain("brave:");
    });
  });
}
