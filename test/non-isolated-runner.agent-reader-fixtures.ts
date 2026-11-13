import path from "node:path";

export function agentReaderFixtureFiles(
  repoRoot: string,
  fixtureRoot: string,
): Record<string, string> {
  const source = (name: string) => JSON.stringify(path.join(repoRoot, "src", name));
  const imports = `import type { DatabaseSync } from "node:sqlite";
import { afterAll, expect, it, vi } from "vitest";
import { resolveGlobalSingleton } from ${source("shared/global-singleton.ts")};
import { hasOmnipolymathAgentDatabaseAsyncResources } from ${source("state/omnipolymath-agent-db-resources.ts")};
const root = ${JSON.stringify(path.join(fixtureRoot, "agent-reader-state"))};
const probeKey = Symbol.for("fixture.agentReader");
const probe = resolveGlobalSingleton<{ reader?: DatabaseSync; afterAllReached: boolean }>(
  probeKey,
  () => ({ afterAllReached: false }),
);
`;
  return {
    "11-a-agent-reader.test.ts": `${imports}
import { openOmnipolymathAgentDatabase } from ${source("state/omnipolymath-agent-db.ts")};
import { closeOmnipolymathAgentDatabaseByPathAsync } from ${source("state/omnipolymath-agent-db-lifecycle.ts")};
import { withOmnipolymathAgentDatabaseReadOnly } from ${source("state/omnipolymath-agent-db-readonly.ts")};
vi.mock(${source("state/omnipolymath-agent-db-lifecycle.ts")}, async (importOriginal) => ({
  ...await importOriginal<typeof import(${source("state/omnipolymath-agent-db-lifecycle.ts")})>(),
  closeOmnipolymathAgentDatabasesAsync: async () => {},
}));
it("retains an ordinary agent reader through file completion", async () => {
  const options = { agentId: "main", env: { OMNIPOLYMATH_STATE_DIR: root } };
  const writer = openOmnipolymathAgentDatabase(options);
  await closeOmnipolymathAgentDatabaseByPathAsync(writer.path);
  expect(writer.db.isOpen).toBe(false);
  const read = withOmnipolymathAgentDatabaseReadOnly(({ db }) => db, options);
  expect(read.found).toBe(true);
  if (!read.found) {
    throw new Error("Missing synthetic agent database");
  }
  probe.reader = read.value;
  expect(probe.reader.isOpen).toBe(true);
  expect(hasOmnipolymathAgentDatabaseAsyncResources()).toBe(true);
});
afterAll(() => {
  expect(probe.reader?.isOpen, "cached reader must remain open through afterAll").toBe(true);
  probe.afterAllReached = true;
});
`,
    "11-b-agent-reader.test.ts": `${imports}
it("retires the prior file's cached agent reader and resources", async () => {
  try {
    expect(probe.afterAllReached, "producer afterAll must precede B in the same worker").toBe(true);
    expect(probe.reader?.isOpen, "prior cached reader must close during runner drain").toBe(false);
    expect(hasOmnipolymathAgentDatabaseAsyncResources(), "prior agent resources must retire before B").toBe(false);
  } finally {
    const lifecycle = await vi.importActual<typeof import(${source("state/omnipolymath-agent-db-lifecycle.ts")})>(${source("state/omnipolymath-agent-db-lifecycle.ts")});
    await lifecycle.closeOmnipolymathAgentDatabasesAsync(root);
    Reflect.deleteProperty(globalThis, probeKey);
  }
});
`,
  };
}
