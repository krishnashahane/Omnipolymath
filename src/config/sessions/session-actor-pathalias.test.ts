import path from "node:path";
import { it } from "vitest";
import { openOmnipolymathAgentDatabase } from "../../state/omnipolymath-agent-db.js";
import { withOmnipolymathTestState } from "../../test-utils/omnipolymath-test-state.js";
import { captureRuntimeConfigAsyncReader } from "../io.runtime.js";
import {
  assertSessionActorPathAliasReuse,
  createAliasedSessionStateRoot,
} from "./session-actor-pathalias.test-support.js";

it("reuses the actor through admitted SQLite path aliases without crossing database identities", async () => {
  await withOmnipolymathTestState(
    { scenario: "minimal", prepareProfileCatalog: false },
    async (state) => {
      const alias = await createAliasedSessionStateRoot(state.root, state.stateDir);
      const aliases = {
        OMNIPOLYMATH_STATE_DIR: alias,
        OMNIPOLYMATH_CONFIG_PATH: path.join(alias, "omnipolymath.json"),
      };
      Object.assign(state.envVars, aliases);
      Object.assign(state.env, aliases);
      state.applyEnv();
      await captureRuntimeConfigAsyncReader()();
      const database = openOmnipolymathAgentDatabase({ agentId: "main" });
      await assertSessionActorPathAliasReuse(
        database,
        openOmnipolymathAgentDatabase({
          agentId: "main",
          path: path.join(path.dirname(database.path), "other.sqlite"),
        }),
        state.env,
      );
    },
  );
});
