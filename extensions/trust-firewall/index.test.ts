import type { OmnipolymathPluginApi } from "omnipolymath/plugin-sdk/plugin-entry";
import { createTestPluginApi } from "omnipolymath/plugin-sdk/plugin-test-api";
import type { PluginHookRegistration } from "omnipolymath/plugin-sdk/plugin-test-runtime";
import { expect, it } from "vitest";
import plugin from "./index.js";
import manifest from "./omnipolymath.plugin.json" with { type: "json" };

function register(pluginConfig: OmnipolymathPluginApi["pluginConfig"]) {
  const hooks: PluginHookRegistration[] = [];
  plugin.register(
    createTestPluginApi({
      pluginConfig,
      on: (hookName, handler) => {
        hooks.push({
          pluginId: manifest.id,
          source: "test",
          hookName,
          handler,
        } as PluginHookRegistration);
      },
    }),
  );
  const find = <K extends PluginHookRegistration["hookName"]>(name: K) => {
    const hook = hooks.find((h) => h.hookName === name);
    if (!hook) {
      throw new Error(`missing ${name} hook`);
    }
    return hook.handler as PluginHookRegistration<K>["handler"];
  };
  return { hooks, find };
}

it("is enabled by default and registers every trust hook", () => {
  expect(manifest.enabledByDefault).toBe(true);
  const { hooks } = register(undefined);
  expect(hooks.map((h) => h.hookName).toSorted()).toEqual(
    [
      "after_tool_call",
      "agent_end",
      "before_agent_run",
      "before_install",
      "before_model_resolve",
      "before_tool_call",
      "gateway_start",
      "llm_output",
      "resolve_exec_env",
    ].toSorted(),
  );
});

it("asks before irreversible tool calls and blocks in dry-run mode", async () => {
  const enforce = register(undefined).find("before_tool_call");
  const ask = await enforce(
    { toolName: "exec", params: { command: "rm -rf ~/projects" }, runId: "r1", toolCallId: "t1" },
    { toolName: "exec", runId: "r1" },
  );
  expect(ask?.requireApproval?.severity).toBe("critical");
  expect(ask?.requireApproval?.allowedDecisions).toEqual(["allow-once", "deny"]);
  expect(
    await enforce(
      { toolName: "read", params: { path: "a" }, runId: "r1" },
      { toolName: "read", runId: "r1" },
    ),
  ).toBeUndefined();

  const dry = register({ mode: "dry-run" }).find("before_tool_call");
  const blocked = await dry(
    { toolName: "write", params: { path: "a" }, runId: "r2" },
    { toolName: "write", runId: "r2" },
  );
  expect(blocked).toMatchObject({ block: true });
  expect(blocked?.blockReason).toContain("dry run");
});

it("lets runs through below the spend cap", async () => {
  const gate = register({ dailySpendCapUsd: 5 }).find("before_agent_run");
  expect(await gate({ prompt: "hi", messages: [] }, {})).toEqual({ outcome: "pass" });
});

it("rejects invalid configuration", () => {
  expect(() => register({ mode: "yolo" })).toThrow(/mode/);
});
