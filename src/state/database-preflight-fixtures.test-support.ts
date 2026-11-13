import fs from "node:fs";
import nodePath from "node:path";
import { expect, vi } from "vitest";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import * as snapshots from "../infra/sqlite-snapshot-source.js";
import { OMNIPOLYMATH_AGENT_SCHEMA_VERSION as agent } from "./omnipolymath-agent-db-contract.js";
import * as agentDb from "./omnipolymath-agent-db.js";
import { resolveOmnipolymathAgentSqlitePath } from "./omnipolymath-agent-db.paths.js";
import {
  assertOmnipolymathDatabasesReady as assertReady,
  preflightOmnipolymathDatabaseSchemas as inspectSchemas,
} from "./omnipolymath-database-preflight.js";
import { OMNIPOLYMATH_STATE_SCHEMA_VERSION as state } from "./omnipolymath-state-db-contract.js";
import * as stateDb from "./omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "./omnipolymath-state-db.paths.js";

type ReadinessOptions = Parameters<typeof assertReady>[0];
type InspectionOptions = Parameters<typeof inspectSchemas>;

export function databaseFixture(dir: string, extraEnv?: NodeJS.ProcessEnv) {
  const env = { ...extraEnv, OMNIPOLYMATH_STATE_DIR: dir };
  return {
    dir,
    env,
    statePath: resolveOmnipolymathStateSqlitePath(env),
    agentPath: (agentId = "main") => resolveOmnipolymathAgentSqlitePath({ agentId, env }),
    state: () => stateDb.openOmnipolymathStateDatabase({ env }),
    agent: (agentId = "main", pathname?: string) =>
      agentDb.openOmnipolymathAgentDatabase({ agentId, path: pathname, env }),
    close: closeDatabases,
    doctor: (targets: readonly { agentId: string; path: string }[] = [], config?: OmnipolymathConfig) =>
      assertReady({ env, config, operation: "doctor", configuredAgentDatabaseTargets: targets }),
    ready: (
      config?: OmnipolymathConfig,
      operation: "gateway-startup" | "gateway-restart" = "gateway-startup",
      callbacks: Pick<ReadinessOptions, "onAgentInspection" | "onRegisteredAgentDatabases"> = {},
    ) =>
      operation === "gateway-startup"
        ? assertReady({ env, config: config ?? {}, operation, ...callbacks })
        : assertReady({ env, config, operation, ...callbacks }),
    inspect: (options: Omit<InspectionOptions[0], "env"> = {}, purpose?: InspectionOptions[1]) =>
      inspectSchemas({ env, ...options }, purpose),
  };
}

export const supportedVersions = { state, agent };
export const compatible = { incompatible: [], indeterminate: [] };

export const versionRow = (
  kind: "state" | "agent",
  path: string,
  foundVersion: number,
  supportedVersion?: number,
) => ({
  kind,
  path,
  foundVersion,
  ...(supportedVersion === undefined ? {} : { supportedVersion }),
});

export function failureRow(kind: "state" | "agent", path: string, reason: unknown) {
  return { kind, path, reason };
}

export const agentConfig = (ids: string[], systemAgent: string): OmnipolymathConfig => ({
  agents: {
    entries: Object.fromEntries(ids.map((id) => [id, {}])),
    defaults: { systemAgent: { agentId: systemAgent } },
  },
});

export const expectFiles = (paths: string[], exists: boolean) =>
  expect(paths.map((pathname) => fs.existsSync(pathname))).toEqual(paths.map(() => exists));

export function closeDatabases() {
  agentDb.closeOmnipolymathAgentDatabasesForTest();
  stateDb.closeOmnipolymathStateDatabaseForTest();
}

export const openRawDatabase = (pathname: string, options: { readOnly?: boolean } = {}) =>
  new (requireNodeSqlite().DatabaseSync)(pathname, options);

export function execSql(pathname: string, sql: string) {
  using database = openRawDatabase(pathname);
  database.exec(sql);
}

export function rejectSnapshot(pathname: string, message: string, normalize = false) {
  const prepare = snapshots.prepareSqliteReadOnlyLocation;
  return vi
    .spyOn(snapshots, "prepareSqliteReadOnlyLocation")
    .mockImplementation((source, options) => {
      if ((normalize ? nodePath.resolve(source) : source) === pathname) {
        throw new Error(message);
      }
      return prepare(source, options);
    });
}
