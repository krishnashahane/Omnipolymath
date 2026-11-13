// Argv invocation tests cover CLI argv normalization before command dispatch.
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { resolveCliArgvInvocation } from "./argv-invocation.js";
import { getCommanderCommandPath } from "./program/commander-parse-facts.js";

describe("argv-invocation", () => {
  it("resolves root help and empty command path", () => {
    expect(resolveCliArgvInvocation(["node", "omnipolymath", "--help"])).toEqual({
      argv: ["node", "omnipolymath", "--help"],
      commandPath: [],
      primary: null,
      hasHelpOrVersion: true,
      isRootHelpInvocation: true,
    });
  });

  it("resolves command path and primary with root options", () => {
    expect(
      resolveCliArgvInvocation(["node", "omnipolymath", "--profile", "work", "gateway", "status"]),
    ).toEqual({
      argv: ["node", "omnipolymath", "--profile", "work", "gateway", "status"],
      commandPath: ["gateway", "status"],
      primary: "gateway",
      hasHelpOrVersion: false,
      isRootHelpInvocation: false,
    });
  });

  it.each([
    ["skills", ["--agent", "verify"], ["skills"]],
    ["skills", ["--", "verify"], ["skills", "verify"]],
  ])("matches Commander for %s %j", async (rootName, args, expectedPath) => {
    const program = new Command().name("omnipolymath").enablePositionalOptions();
    const root = program.command(rootName).option("--agent <id>").option("--json");
    const child = root.command("verify");
    let parsedPath: string[] = [];
    for (const command of [root, child]) {
      command.action(() => {
        parsedPath = getCommanderCommandPath(command);
      });
    }
    const argv = ["node", "omnipolymath", rootName, ...args];

    await program.parseAsync(argv);

    expect(parsedPath).toEqual(expectedPath);
    expect(resolveCliArgvInvocation(argv).commandPath).toEqual(parsedPath);
  });

  it.each([["help", "update", "cleanup"]])(
    "recognizes update help without promoting scoped version flags: %j",
    (...args) => {
      expect(resolveCliArgvInvocation(["node", "omnipolymath", ...args]).hasHelpOrVersion).toBe(true);
    },
  );
});
