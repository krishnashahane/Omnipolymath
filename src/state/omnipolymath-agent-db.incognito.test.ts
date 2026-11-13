import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { withOmnipolymathAgentDatabaseReadOnly } from "./omnipolymath-agent-db-readonly.js";
import {
  isIncognitoOmnipolymathAgentSqlitePath,
  openOmnipolymathAgentDatabase,
  resolveIncognitoOmnipolymathAgentSqlitePath,
  withOmnipolymathAgentDatabaseAsync,
} from "./omnipolymath-agent-db.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

describe("incognito sentinel database refusal", () => {
  it.runIf(process.platform === "win32")(
    "matches mixed separators on drive and UNC roots without folding filename case",
    () => {
      for (const stateDir of ["C:\\incognito-state", "\\\\server\\share\\incognito-state"]) {
        const options = { agentId: "worker", env: { OMNIPOLYMATH_STATE_DIR: stateDir } };
        const sentinel = resolveIncognitoOmnipolymathAgentSqlitePath(options);
        expect(isIncognitoOmnipolymathAgentSqlitePath(sentinel.replaceAll("\\", "/"), options)).toBe(
          true,
        );
        expect(
          isIncognitoOmnipolymathAgentSqlitePath(
            path.join(path.dirname(sentinel), path.basename(sentinel).toUpperCase()),
            options,
          ),
        ).toBe(false);
      }
    },
  );

  it("matches only the normalized sentinel for the current owner and state root", () => {
    const env = { OMNIPOLYMATH_STATE_DIR: path.join(os.tmpdir(), "incognito-path-root") };
    const options = { agentId: "worker", env };
    const sentinel = resolveIncognitoOmnipolymathAgentSqlitePath(options);
    const basename = path.basename(sentinel);
    for (const pathname of [
      sentinel,
      path.relative(process.cwd(), sentinel),
      `${sentinel}${path.sep}`,
      `${sentinel}${path.sep}.`,
      `${sentinel}${path.sep}..${path.sep}${basename}`,
    ]) {
      expect(isIncognitoOmnipolymathAgentSqlitePath(pathname, options), pathname).toBe(true);
    }
    for (const pathname of [
      path.join(path.dirname(sentinel), "omnipolymath-agent.sqlite"),
      path.join(env.OMNIPOLYMATH_STATE_DIR, basename),
      `${sentinel}-wal`,
      `${sentinel} `,
      path.join(path.dirname(sentinel), basename.toUpperCase()),
    ]) {
      expect(isIncognitoOmnipolymathAgentSqlitePath(pathname, options), pathname).toBe(false);
    }
    expect(isIncognitoOmnipolymathAgentSqlitePath(sentinel, { ...options, agentId: "other" })).toBe(
      false,
    );
    env.OMNIPOLYMATH_STATE_DIR = path.join(env.OMNIPOLYMATH_STATE_DIR, "changed");
    expect(isIncognitoOmnipolymathAgentSqlitePath(sentinel, options)).toBe(false);
    expect(
      isIncognitoOmnipolymathAgentSqlitePath(resolveIncognitoOmnipolymathAgentSqlitePath(options), options),
    ).toBe(true);
  });

  it.each([false, true])(
    "refuses SQLite opens without altering the sentinel (exists=%s)",
    async (exists) => {
      const stateDir = tempDirs.make("omnipolymath-incognito-refusal-");
      const env = { OMNIPOLYMATH_STATE_DIR: stateDir };
      const sentinel = resolveIncognitoOmnipolymathAgentSqlitePath({ agentId: "main", env });
      const options = { agentId: "main", env, path: sentinel };
      if (exists) {
        fs.mkdirSync(path.dirname(sentinel), { recursive: true });
        fs.writeFileSync(sentinel, "operator data", "utf8");
      }
      const run = vi.fn();
      expect(() => openOmnipolymathAgentDatabase(options)).toThrow("memory session actor");
      await expect(withOmnipolymathAgentDatabaseAsync(options, run)).rejects.toThrow(
        "memory session actor",
      );
      expect(withOmnipolymathAgentDatabaseReadOnly(run, options)).toEqual({
        found: false,
        reason: "database-missing",
      });
      expect(run).not.toHaveBeenCalled();
      if (exists) {
        expect(fs.readFileSync(sentinel, "utf8")).toBe("operator data");
        expect(fs.readdirSync(path.dirname(sentinel))).toEqual([path.basename(sentinel)]);
      } else {
        expect(fs.readdirSync(stateDir)).toEqual([]);
      }
    },
  );
});
