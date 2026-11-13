import { existsSync } from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { defaultRuntime } from "../runtime.js";
import { recordAgentDatabaseAdmissions } from "../state/agent-database-admission.js";
import { recordAgentProvenance } from "../state/agent-provenance.js";
import { closeOmnipolymathStateDatabaseAsync } from "../state/omnipolymath-state-db.js";
import { resolveOmnipolymathStateSqlitePath } from "../state/omnipolymath-state-db.paths.js";
import { observeMainThreadSql } from "../test-utils/main-thread-sql-spies.test-support.js";
import { withOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { agentsListCommand } from "./agents.commands.list.js";

let config: OmnipolymathConfig;
vi.mock("./config-validation.js", () => ({ requireValidConfig: async () => config }));

const runtime = {
  log: vi.fn<(...args: unknown[]) => void>(),
  writeJson: vi.fn<(value: unknown) => void>(),
};

let state: Parameters<Parameters<typeof withOmnipolymathTestState>[1]>[0];
let sql: ReturnType<typeof observeMainThreadSql> | undefined;
it.aroundEach(async (runTest) => {
  await withOmnipolymathTestState(
    { layout: "state-only", label: "provenance-cli" },
    async (fixture) => {
      state = fixture;
      recordAgentDatabaseAdmissions([], { env: state.env });
      vi.clearAllMocks();
      vi.spyOn(defaultRuntime, "log").mockImplementation(runtime.log);
      vi.spyOn(defaultRuntime, "writeJson").mockImplementation(runtime.writeJson);
      try {
        await runTest();
        await closeOmnipolymathStateDatabaseAsync();
        sql?.expectIdle();
      } finally {
        sql?.restore();
        vi.restoreAllMocks();
        sql = undefined;
        await closeOmnipolymathStateDatabaseAsync();
      }
    },
  );
});

function configureRoster(ids: string[]) {
  config = {
    agents: {
      ownership: "explicit",
      entries: Object.fromEntries(ids.map((id) => [id, { workspace: path.join(state.root, id) }])),
    },
  };
}

it("keeps an empty JSON roster free of provenance storage", async () => {
  configureRoster([]);
  await agentsListCommand({ json: true });
  expect(runtime.writeJson.mock.calls[0]?.[0]).toEqual([]);
  expect(existsSync(resolveOmnipolymathStateSqlitePath(state.env))).toBe(false);
});

it("serves JSON from worker provenance through reopen", async () => {
  configureRoster(["main", "child", "legacy"]);
  const at = (nowMs: number) => ({ env: state.env, nowMs });
  await recordAgentProvenance("Main", { createdVia: "operator" }, at(10));
  await recordAgentProvenance("Child", { createdVia: "agent", creatorAgentId: "Main" }, at(20));
  await recordAgentProvenance("retired", { createdVia: "template" }, at(30));
  await closeOmnipolymathStateDatabaseAsync();
  requireNodeSqlite();
  sql = observeMainThreadSql({ includeClose: true });
  sql.calibrate();
  await agentsListCommand({ json: true });
  const output = runtime.writeJson.mock.calls[0]?.[0];
  expect(output).toMatchObject([
    { id: "main", createdVia: "operator", createdAt: 10 },
    { id: "child", createdVia: "agent", creatorAgentId: "main", createdAt: 20 },
    { id: "legacy" },
  ]);
  expect(output).not.toHaveProperty("2.createdVia");
});

it("enriches growing rosters in configured order", async () => {
  const ids = Array.from({ length: 300 }, (_, index) => `worker-${299 - index}`);
  configureRoster(ids);
  for (const [index, id] of ids.entries()) {
    await recordAgentProvenance(id, { createdVia: "operator" }, { env: state.env, nowMs: index });
  }
  await closeOmnipolymathStateDatabaseAsync();
  await agentsListCommand({ json: true });
  expect(runtime.writeJson.mock.calls[0]?.[0]).toMatchObject(
    ids.map((id, createdAt) => ({ id, createdVia: "operator", createdAt })),
  );
});
