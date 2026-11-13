import fs from "node:fs";
import { readSqliteSourceContentVersionSync } from "../infra/sqlite-snapshot-source.js";
import { getOmnipolymathDatabaseMaintenanceScope } from "./omnipolymath-state-db-async-lifecycle.js";
import { omnipolymathStateDatabaseCache } from "./omnipolymath-state-db-cache.js";
import { isExistingOmnipolymathStateSchema } from "./omnipolymath-state-db-schema-policy.js";
import { existingPathOrUndefined } from "./omnipolymath-state-db.paths.js";

const versions = new WeakMap<object, { fingerprint: string; version: string }>();

/** Returned metadata also invalidates rows when a write races cached hash selection. */
export function readAdmittedStateContentVersion(
  pathname: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const assertCurrent = () => {
    getOmnipolymathDatabaseMaintenanceScope()?.assertReadAdmission();
    omnipolymathStateDatabaseCache.assertOmnipolymathStateDatabaseFreshOpenAllowedAtPath(pathname, env);
  };
  assertCurrent();
  if (existingPathOrUndefined(pathname) === undefined) {
    return undefined;
  }
  const scope = getOmnipolymathDatabaseMaintenanceScope();
  const fingerprint = () => {
    const canonical = fs.realpathSync.native(pathname);
    return ["", "-wal", "-journal"]
      .map((suffix) => {
        const stat = fs.lstatSync(canonical + suffix, { bigint: true, throwIfNoEntry: false });
        const identity = stat && [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs];
        return `${canonical}:${identity?.join(":")}`;
      })
      .join("|");
  };
  const before = fingerprint();
  const previous = scope && versions.get(scope);
  const version =
    previous?.fingerprint === before
      ? previous.version
      : readSqliteSourceContentVersionSync(pathname);
  if (scope && version !== undefined && before === fingerprint()) {
    versions.set(scope, { fingerprint: before, version });
  }
  assertCurrent();
  return version && `${isExistingOmnipolymathStateSchema(pathname)}:${version}:${fingerprint()}`;
}
