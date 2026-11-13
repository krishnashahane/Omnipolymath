import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChildEnv } from "./ci-run-node-test-shard.mts";
import { createVitestCacheWarmGroups } from "./lib/ci-node-test-plan.mts";
import { BUN_UI_TEST_ENV, resolveCiTestRuntimePolicy } from "./lib/ci-test-runtime.mts";
import { runManagedCommand } from "./lib/managed-child-process.mts";

// Consumer entrypoints choose their own reusable cache leaves; the planner owns
// membership for both backend-local protected seeds. Ordinary warming follows
// ordinary CI; explicit full validation also primes every Node collection.
const hosted = process.env.CACHE_WARM_PLATFORM === "linux-hosted";
const runtimePolicy = resolveCiTestRuntimePolicy({
  OMNIPOLYMATH_CI_TEST_RUNTIME_POLICY: process.env.OMNIPOLYMATH_CI_TEST_RUNTIME_POLICY?.trim() || "bun-all",
});
const groups = createVitestCacheWarmGroups(hosted ? "hybrid-hosted" : "full");
const ui = groups.find((group) => group.shard_name === "cache-warm:ui-package");
if (!ui?.includePatterns) {
  throw new Error("Missing UI cache seed");
}
const scratch = mkdtempSync(join(tmpdir(), "omnipolymath-cache-warm-"));
const collectionArgs = ["--testNamePattern=(?!)"];
const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  OMNIPOLYMATH_CI_TEST_RUNTIME_POLICY: "node",
  OMNIPOLYMATH_NODE_TEST_VITEST_ARGS_JSON: JSON.stringify(collectionArgs),
  OMNIPOLYMATH_NODE_TEST_PLAN_CONCURRENCY: "1",
  // The final Node UI collection prunes both roots after all producers join.
  OMNIPOLYMATH_VITEST_FS_MODULE_CACHE_WRITER: "0",
  OMNIPOLYMATH_NODE_COMPILE_CACHE_WRITER: "0",
};
delete baseEnv.OMNIPOLYMATH_VITEST_INCLUDE_FILE;
delete baseEnv.OMNIPOLYMATH_VITEST_POST_SHARD_INCLUDE_FILE;
let exitCode = 0;
let interrupted = false;
let completed = false;
const collect = async (bin: string, args: string[], env: NodeJS.ProcessEnv) => {
  if (interrupted) {
    return;
  }
  const code = await runManagedCommand({
    bin,
    args,
    env,
    requireProcessTreeExit: true,
    onSignal() {
      interrupted = true;
    },
  });
  exitCode ||= code;
};

try {
  if (hosted) {
    const tooling = groups.find((group) => group.shard_name === "cache-warm:hosted-tooling");
    if (!tooling?.includePatterns) {
      throw new Error("Missing hosted CI-routing cache seed");
    }
    await collect("pnpm", ["test", ...tooling.includePatterns, ...collectionArgs], {
      ...baseEnv,
      OMNIPOLYMATH_TEST_PROJECTS_PARALLEL: "3",
    });
    for (const [script, prefix, concurrency] of [
      ["test:contracts:plugins", "cache-warm:hosted-contracts-plugin", "1"],
      ["test:contracts:channels", "cache-warm:hosted-contracts-channel-", "4"],
    ] as const) {
      const includeFile = join(scratch, `${concurrency}.json`);
      writeFileSync(
        includeFile,
        JSON.stringify(
          groups
            .filter((group) => group.shard_name.startsWith(prefix))
            .flatMap((group) => group.includePatterns ?? []),
        ),
      );
      await collect("pnpm", [script, ...collectionArgs], {
        ...baseEnv,
        OMNIPOLYMATH_TEST_PROJECTS_PARALLEL: concurrency,
        OMNIPOLYMATH_VITEST_INCLUDE_FILE: includeFile,
      });
    }
    // Direct entrypoints retain the Node tooling and contract seeds. Only the
    // tooling inventory also has a Bun consumer; contract lanes remain on Node.
    await collect(process.execPath, ["--import", "tsx", "scripts/ci-run-node-test-shard.mts"], {
      ...baseEnv,
      OMNIPOLYMATH_CI_TEST_RUNTIME_POLICY: "bun-all",
      OMNIPOLYMATH_NODE_TEST_GROUPS_JSON: JSON.stringify([tooling]),
    });
  } else {
    await collect(process.execPath, ["--import", "tsx", "scripts/ci-run-node-test-shard.mts"], {
      ...baseEnv,
      OMNIPOLYMATH_CI_TEST_RUNTIME_POLICY: runtimePolicy,
      OMNIPOLYMATH_NODE_TEST_GROUPS_JSON: JSON.stringify(groups.filter((group) => group !== ui)),
    });
  }

  // Collection is intentionally a partial selection, so invoke the normal
  // Vitest launcher directly instead of the CI runtime-admission policy.
  const bunEnv = buildChildEnv(
    { kind: "group", name: ui.shard_name, plan: ui },
    { ...baseEnv, ...BUN_UI_TEST_ENV, NODE_OPTIONS: undefined },
    scratch,
    0,
    { runtime: "bun", cacheSlot: 0 },
  );
  // Keep the inherited Bun selection: the launcher verifies it, and CI resolves the
  // pinned fork from PATH, which is not an OMNIPOLYMATH_BUN_PATH file.
  bunEnv.OMNIPOLYMATH_VITEST_POST_SHARD_INCLUDE_FILE = bunEnv.OMNIPOLYMATH_VITEST_INCLUDE_FILE;
  delete bunEnv.OMNIPOLYMATH_VITEST_INCLUDE_FILE;
  await collect(
    process.execPath,
    ["scripts/run-vitest.mjs", "run", "--config", ...ui.configs, ...collectionArgs],
    bunEnv,
  );
  await collect(process.execPath, ["--import", "tsx", "scripts/ci-run-node-test-shard.mts"], {
    ...baseEnv,
    NODE_OPTIONS: undefined,
    OMNIPOLYMATH_NODE_TEST_GROUPS_JSON: JSON.stringify([ui]),
    OMNIPOLYMATH_VITEST_FS_MODULE_CACHE_WRITER: process.env.OMNIPOLYMATH_VITEST_FS_MODULE_CACHE_WRITER,
    OMNIPOLYMATH_NODE_COMPILE_CACHE_WRITER: process.env.OMNIPOLYMATH_NODE_COMPILE_CACHE_WRITER,
  });
  process.exitCode = exitCode;
  completed = true;
} finally {
  if (completed) {
    rmSync(scratch, { recursive: true, force: true });
  }
}
