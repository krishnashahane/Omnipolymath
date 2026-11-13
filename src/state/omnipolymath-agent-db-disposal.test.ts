import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { observeHostDataSql } from "../../test/helpers/sqlite-statement-execution-counter.js";
import { createSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import { sessionChanges } from "../sessions/session-row-changes.js";
import { disposeOmnipolymathAgentDatabaseByPath } from "./omnipolymath-agent-db-disposal.js";
import { useAgentDatabaseDirectories } from "./omnipolymath-agent-db-lifecycle.test-support.js";
import {
  isOmnipolymathAgentDatabaseRegistryChange,
  listOmnipolymathRegisteredAgentDatabases,
} from "./omnipolymath-agent-db-registry-listing.js";
import { openOmnipolymathAgentDatabase } from "./omnipolymath-agent-db.js";
import { resolveOmnipolymathAgentSqlitePath } from "./omnipolymath-agent-db.paths.js";
import type { AgentDatabaseRequestExecutionSource } from "./omnipolymath-agent-execution-admission-contract.js";
import { captureOmnipolymathAgentDatabaseExecution } from "./omnipolymath-agent-execution.js";
const tempDirs = useAgentDatabaseDirectories();

function createTempStateDir(): string {
  return fs.realpathSync(tempDirs.make("agent-db-disposal-"));
}

function fixture(agentId = "main") {
  const env = { OMNIPOLYMATH_STATE_DIR: createTempStateDir() };
  const options = { agentId, env };
  return { ...options, path: resolveOmnipolymathAgentSqlitePath(options) };
}

function dispose(options: ReturnType<typeof fixture>) {
  return disposeOmnipolymathAgentDatabaseByPath(options.path, { env: options.env });
}

function registry(options: ReturnType<typeof fixture>) {
  return listOmnipolymathRegisteredAgentDatabases({ env: options.env });
}

function expectRegistry(
  options: ReturnType<typeof fixture>,
  ...owners: { agentId: string; path: string }[]
) {
  expect(registry(options)).toEqual(
    owners.map(({ agentId, path: pathname }) =>
      expect.objectContaining({ agentId, path: pathname }),
    ),
  );
}

function aliasedFixture(options = fixture()) {
  const alias = path.join(options.env.OMNIPOLYMATH_STATE_DIR, "alias");
  const directory = path.dirname(options.path);
  fs.mkdirSync(directory, { recursive: true });
  fs.symlinkSync(directory, alias, process.platform === "win32" ? "junction" : "dir");
  return {
    options,
    aliased: { ...options, path: path.join(alias, path.basename(options.path)) },
  };
}

function source(): AgentDatabaseRequestExecutionSource {
  return {
    assertCurrent() {},
    createAdmission(binding) {
      return () => ({
        nativeLocations: binding.nativeLocations,
        admission: createSqliteWorkerOperationAdmission((request, grant) => {
          binding.authorize(request);
          if (!grant()) {
            throw new Error("Disposal fixture lost admission");
          }
        }, binding.attachment),
      });
    },
  };
}

it("fences an absent disposal before a successor can open", async () => {
  const options = fixture("worker-1");
  const disposal = dispose(options);
  try {
    expect(() => openOmnipolymathAgentDatabase(options)).toThrow("resources are closing");
  } finally {
    await expect(disposal).resolves.toBe(false);
  }
  const successor = openOmnipolymathAgentDatabase(options);
  expect(successor.db.isOpen).toBe(true);
});

it("disposes only its exact cached owner and unregisters that registry row", async () => {
  const options = fixture("worker-1");
  const first = openOmnipolymathAgentDatabase(options);
  const second = openOmnipolymathAgentDatabase({ agentId: "worker-2", env: options.env });

  expect(await dispose(options)).toBe(true);
  expect(first.db.isOpen).toBe(false);
  expect(second.db.isOpen).toBe(true);
  expectRegistry(options, second);
  expect(await dispose(options)).toBe(false);
  expect(second.db.isOpen).toBe(true);

  const reopened = openOmnipolymathAgentDatabase(options);
  expectRegistry(options, reopened, second);
});

it("rejects a file replacement during registry removal publication", async () => {
  const options = fixture();
  const native = openOmnipolymathAgentDatabase(options);
  const originalInode = fs.statSync(options.path, { bigint: true }).ino;
  const retiredPath = path.join(path.dirname(options.path), "retired.sqlite");
  let replacementInode: bigint | undefined;
  const unsubscribe = sessionChanges.subscribeFacts((change) => {
    if (!isOmnipolymathAgentDatabaseRegistryChange(change) || replacementInode !== undefined) {
      return;
    }
    fs.renameSync(options.path, retiredPath);
    fs.copyFileSync(retiredPath, options.path, fs.constants.COPYFILE_EXCL);
    replacementInode = fs.statSync(options.path, { bigint: true }).ino;
  });
  using _ = { [Symbol.dispose]: () => unsubscribe() };

  await expect(dispose(options)).rejects.toThrow("SQLite database file identity changed");
  expect(native.db.isOpen).toBe(false);
  expect(replacementInode).toBeDefined();
  expect(replacementInode).not.toBe(originalInode);
  expect(fs.statSync(options.path, { bigint: true }).ino).toBe(replacementInode);
  expect(registry(options)).toEqual([]);
});

it.runIf(process.platform !== "win32")(
  "refuses to dispose a symlinked database with duplicate native owners",
  async () => {
    const { options, aliased } = aliasedFixture();
    const database = openOmnipolymathAgentDatabase(options);
    const alias = openOmnipolymathAgentDatabase(aliased);
    await expect(dispose(options)).rejects.toThrow("multiple native owners");
    expect(database.db.isOpen).toBe(true);
    expect(alias.db.isOpen).toBe(true);
  },
);

it("disposes a worker-created database through its registry owner without host data SQL", async () => {
  const options = fixture();
  const siblingOptions = {
    ...options,
    agentId: "sibling",
    path: path.join(options.env.OMNIPOLYMATH_STATE_DIR, "sibling.sqlite"),
  };
  const execution = captureOmnipolymathAgentDatabaseExecution(options);
  const sibling = captureOmnipolymathAgentDatabaseExecution(siblingOptions);
  try {
    await execution.prepare(source());
    await sibling.prepare(source());
    await execution.release();
    expect(registry(options)).toHaveLength(2);
    const sql = observeHostDataSql();
    {
      using _ = { [Symbol.dispose]: () => sql.restore() };

      await expect(dispose(options)).resolves.toBe(true);
      expect(sql.queries).toEqual([]);
    }
    expectRegistry(options, siblingOptions);
    sibling.assertCurrent();
  } finally {
    await Promise.allSettled([execution.release(), sibling.release()]);
  }
});

it.each(["registered", "unregistered"] as const)(
  "drains a %s worker through its native or newly discovered alias",
  async (kind) => {
    const root = fixture();
    const registered = kind === "registered";
    const options = registered
      ? root
      : {
          ...root,
          path: path.join(root.env.OMNIPOLYMATH_STATE_DIR, "imports", "archive.sqlite"),
        };
    let aliased = registered ? aliasedFixture(options).aliased : undefined;
    const native = aliased && openOmnipolymathAgentDatabase(aliased);
    const execution = captureOmnipolymathAgentDatabaseExecution(options);
    try {
      await execution.prepare(source());
      expect(registry(options)).toEqual(
        registered ? [expect.objectContaining({ path: aliased?.path })] : [],
      );
      aliased ??= aliasedFixture(options).aliased;
      await expect(dispose(aliased)).resolves.toBe(registered);
      if (native) {
        expect(native.db.isOpen).toBe(false);
      }
      expect(() => execution.assertCurrent()).toThrow(/closed/);
      expect(registry(options)).toEqual([]);
    } finally {
      await execution.release();
    }
  },
);
