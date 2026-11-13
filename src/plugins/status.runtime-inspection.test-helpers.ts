import fs from "node:fs";
import path from "node:path";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { OmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";

export function createDiagnosticsFixture(state: OmnipolymathTestState, cleanupThrows = false) {
  const id = "diagnostics-resource";
  const event = `diagnostics-resource-${path.basename(state.root)}`;
  const rootDir = state.path("plugin");
  const disposed = state.path("disposed.txt");
  fs.mkdirSync(rootDir);
  fs.writeFileSync(
    path.join(rootDir, "package.json"),
    JSON.stringify({
      name: id,
      version: "1.0.0",
      type: "module",
      omnipolymath: { extensions: ["./index.ts"] },
    }),
  );
  fs.writeFileSync(
    path.join(rootDir, "omnipolymath.plugin.json"),
    JSON.stringify({
      id,
      configSchema: { type: "object", properties: {} },
    }),
  );
  fs.writeFileSync(
    path.join(rootDir, "index.ts"),
    `
    import fs from "node:fs";
    export default { id: ${JSON.stringify(id)}, register(api) {
      const listener = () => {};
      process.on(${JSON.stringify(event)}, listener);
      api.lifecycle.onDispose(() => {
        process.removeListener(${JSON.stringify(event)}, listener);
        fs.appendFileSync(${JSON.stringify(disposed)}, "disposed\\n");
        ${cleanupThrows ? 'throw new Error("fixture cleanup rejected");' : ""}
      });
      api.registerService({
        get id() { api.lifecycle.signal.throwIfAborted(); return "diagnostics-resource-service"; },
        start() {}, stop() {},
      });
    } };
  `,
  );
  const config: OmnipolymathConfig = {
    commands: { text: true, plugins: true },
    agents: { defaults: { workspace: state.workspaceDir } },
    plugins: {
      enabled: true,
      allow: [id],
      load: { paths: [rootDir] },
      entries: { [id]: { enabled: true } },
      slots: { memory: "none" },
    },
  };
  return { id, event, config, disposed };
}
