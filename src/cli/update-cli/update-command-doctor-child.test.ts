import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { UPDATE_POST_INSTALL_DOCTOR_RESULT_PATH_ENV } from "../../infra/update-doctor-result.js";
import { createUpdateRun, getUpdateRun } from "../../infra/update-run-ledger.js";
import { defaultRuntime } from "../../runtime.js";
import { OMNIPOLYMATH_STATE_SCHEMA_VERSION } from "../../state/omnipolymath-state-db-contract.js";
import { closeOmnipolymathStateDatabaseAsync } from "../../state/omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "../../state/omnipolymath-state-db.paths.js";
import { createUpdateProgress } from "./progress.js";
import { runUpdateDoctorProcess } from "./update-command-doctor-child.js";

const dirs = useAutoCleanupTempDirTracker(afterAll);
afterAll(() => closeOmnipolymathStateDatabaseAsync());

it.each([0, 23])("readmits the baseEnv database after Doctor exits with %s", async (exitCode) => {
  const root = dirs.make("doctor-schema-handoff-");
  const env = { HOME: root, OMNIPOLYMATH_STATE_DIR: path.join(root, "doctor-state") };
  const run = createUpdateRun({ trigger: "cli" }, { env });
  const result = await runUpdateDoctorProcess(
    { runId: run.runId, root },
    [
      process.execPath,
      "-e",
      `const {DatabaseSync}=require('node:sqlite');
       const db=new DatabaseSync(process.argv[1]);
       db.exec(${JSON.stringify(`BEGIN IMMEDIATE; PRAGMA user_version=${OMNIPOLYMATH_STATE_SCHEMA_VERSION + 1}; UPDATE schema_meta SET schema_version=${OMNIPOLYMATH_STATE_SCHEMA_VERSION + 1} WHERE meta_key='primary'; COMMIT;`)});
       db.close(); process.exitCode=${exitCode};`,
      resolveOmnipolymathStateSqlitePath(env),
    ],
    {
      baseEnv: env,
      env: { [UPDATE_POST_INSTALL_DOCTOR_RESULT_PATH_ENV]: path.join(root, "doctor-result.json") },
      timeoutMs: 5_000,
    },
  );
  expect(result.code, result.stderr).toBe(exitCode);
  expect(() => getUpdateRun(run.runId, { env })).toThrow(/newer schema version/);
});

it("keeps live progress observation from refusing the Doctor's exclusive state custody", async () => {
  const root = dirs.make("doctor-progress-custody-");
  const env = { HOME: root, OMNIPOLYMATH_STATE_DIR: path.join(root, "doctor-state") };
  const run = createUpdateRun({ trigger: "cli" }, { env });
  await closeOmnipolymathStateDatabaseAsync();
  const log = vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});
  const presentation = createUpdateProgress(true, { runId: run.runId, env });
  try {
    // The first committed phase proves the parent's reader is open before the child starts.
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith("Phase: requested"), {
      timeout: 10_000,
    });
    const result = await runUpdateDoctorProcess(
      { runId: run.runId, root },
      [
        process.execPath,
        "-e",
        `const {DatabaseSync}=require('node:sqlite');
         const db=new DatabaseSync(process.argv[1]);
         db.exec("PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; ROLLBACK;");
         db.close();`,
        resolveOmnipolymathStateSqlitePath(env),
      ],
      {
        baseEnv: env,
        env: {
          [UPDATE_POST_INSTALL_DOCTOR_RESULT_PATH_ENV]: path.join(root, "doctor-result.json"),
        },
        timeoutMs: 5_000,
      },
    );
    expect(result.code, result.stderr).toBe(0);
  } finally {
    presentation.dispose();
    log.mockRestore();
  }
});
