import fs from "node:fs";
import path from "node:path";
import { afterEach } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import {
  closeOmnipolymathStateDatabaseAsync,
  closeOmnipolymathStateDatabaseForTest,
} from "../state/omnipolymath-state-db.js";
import { captureEnv, setTestEnvValue } from "../test-utils/env.js";
import {
  detectLegacyWorkspaceState,
  migrateLegacyWorkspaceState,
} from "./state-migrations.workspace-setup.js";

export function useWorkspaceMigrationTestFixture() {
  let envSnapshot: ReturnType<typeof captureEnv> | undefined;
  const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
    afterEach(async () => {
      await closeOmnipolymathStateDatabaseAsync();
      closeOmnipolymathStateDatabaseForTest();
      envSnapshot?.restore();
      envSnapshot = undefined;
      cleanup();
    });
  });

  function setup() {
    const homeDir = tempDirs.make("omnipolymath-workspace-migration-home-");
    const stateDir = path.join(homeDir, ".omnipolymath");
    const workspaceDir = path.join(homeDir, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    envSnapshot ??= captureEnv(["HOME", "OMNIPOLYMATH_HOME", "OMNIPOLYMATH_STATE_DIR"]);
    setTestEnvValue("HOME", homeDir);
    setTestEnvValue("OMNIPOLYMATH_STATE_DIR", stateDir);
    const cfg = {
      agents: { defaults: { workspace: workspaceDir } },
    } satisfies OmnipolymathConfig;
    return {
      cfg,
      env: { ...process.env, HOME: homeDir, OMNIPOLYMATH_STATE_DIR: stateDir },
      homeDir,
      stateDir,
      workspaceDir,
    };
  }

  function detect(context: {
    cfg: OmnipolymathConfig;
    env: NodeJS.ProcessEnv;
    homeDir: string;
    stateDir: string;
    workspaceDir: string;
  }) {
    return detectLegacyWorkspaceState({
      cfg: context.cfg,
      stateDir: context.stateDir,
      env: context.env,
      homedir: () => context.homeDir,
      doctorOnlyStateMigrations: true,
    });
  }

  async function migrate(context: Parameters<typeof detect>[0]) {
    return await migrateLegacyWorkspaceState({
      detected: await detect(context),
      env: context.env,
      stateDir: context.stateDir,
    });
  }

  return { detect, migrate, setup };
}
