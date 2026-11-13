import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Command, Option } from "commander";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { registerAcpCli } from "./acp-cli.js";
import { getCompletionScript, registerCompletionCli } from "./completion-cli.js";
import {
  createAliasedCompletionProgram,
  createCompletionProgram,
  createDocumentedCompletionProgram as documentedProgram,
  itWithFish,
  itWithPowerShell,
  PowerShellCompletionRunner,
  runGeneratedBashCompletion as runBash,
  runGeneratedFishCompletion as runFish,
} from "./completion-cli.test-support.js";
import { registerModelsCli } from "./models-cli.js";

const powershell = new PowerShellCompletionRunner();
const powerShellQuotedChoices = [
  ["Jane's", "Jane''s"],
  ["Jane‘s", "Jane‘‘s"],
  ["Jane’s", "Jane’’s"],
  ["Jane‚s", "Jane‚‚s"],
  ["Jane‛s", "Jane‛‛s"],
] as const;
const itUnix = it.skipIf(process.platform === "win32");
const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterAll(() => powershell.close());

function optionalChoices(): Command {
  const program = choiceProgram(["auto", "manual", "-legacy"], "--mode [mode]", "Mode");
  return program.option("--json", "JSON output");
}

function choiceProgram(choices: string[], flags = "--value <value>", description = "Value") {
  return new Command().name("omnipolymath").addOption(new Option(flags, description).choices(choices));
}

function commandAt(program: Command, ...names: string[]): Command {
  return names.reduce((parent, name) => {
    const command = parent.commands.find((candidate) => candidate.name() === name);
    assert(command, `Missing fixture command: ${name}`);
    return command;
  }, program);
}

function runZsh(script: string, options: { timeout?: number; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync("zsh", ["-fc", script], { encoding: "utf8", ...options });
}

function runZshScript(script: string, timeout?: number): string | undefined {
  const result = runZsh(script, { timeout });
  if (result.error) {
    if ("code" in result.error && result.error.code === "ENOENT") {
      return undefined;
    }
    throw result.error;
  }
  expect(result).toMatchObject({ stderr: "", status: 0 });
  return result.stdout;
}

type NativeShell = "bash" | "fish" | "powershell";
async function complete(shell: NativeShell, program: Command, line: string) {
  return shell === "bash"
    ? runBash(program, line.split(" "))
    : shell === "fish"
      ? runFish(program, line)
      : powershell.complete(program, line);
}

const literalChoices = {
  bash: [
    ["it's literal", "it\\'s"],
    ["$(printf OMNIPOLYMATH_COMPLETION_VALUE_EXECUTED >&2)", "$("],
  ],
  fish: [
    ["it's literal", "it"],
    ["literal $(printf OMNIPOLYMATH_COMPLETION_VALUE_EXECUTED >&2)", "literal"],
  ],
  powershell: [
    ["Jane's", "Ja"],
    ["literal $(Write-Error OMNIPOLYMATH_COMPLETION_VALUE_EXECUTED)", "literal"],
  ],
} satisfies Record<NativeShell, [string, string][]>;

describe("completion-cli", () => {
  for (const [shell, nativeTest] of [
    ["bash", itUnix],
    ["fish", itWithFish],
    ["powershell", itWithPowerShell],
  ] as const) {
    nativeTest(`offers root global flags after subcommands in ${shell}`, async () => {
      const program = new Command()
        .name("omnipolymath")
        .enablePositionalOptions()
        .option("--profile <name>", "Profile")
        .option("--log-level <level>", "Log level")
        .option("--container <name>", "Container")
        .option("--no-color", "Disable colors")
        .option("--root-only", "Positional root option");
      const group = program.command("group").alias("g").option("--parent-only");
      group.command("status").option("--json");
      for (const [line, expected] of [
        ["omnipolymath g status --pr", ["--profile"]],
        ["omnipolymath group status --no-c", ["--no-color"]],
        ["omnipolymath group status --log", ["--log-level"]],
        ["omnipolymath group status --cont", ["--container"]],
        ["omnipolymath group status --root", []],
        ["omnipolymath group status --parent", []],
      ] as const) {
        expect(await complete(shell, program, line), line).toEqual(expected);
      }
    });

    if (shell !== "fish") {
      nativeTest.each([
        ["omnipolymath --mode --j", ["--json"]],
        ["omnipolymath --mode -l", ["-legacy"]],
      ])(`preserves optional choices in ${shell}: %s`, async (line, expected) => {
        expect(await complete(shell, optionalChoices(), line)).toEqual(expected);
      });
    }
    nativeTest.each(literalChoices[shell])(
      `keeps ${shell} choice %s inert`,
      async (value, prefix) => {
        const program = choiceProgram([value]);
        const expected = shell === "powershell" ? `'${value.replaceAll("'", "''")}'` : value;
        expect(await complete(shell, program, `omnipolymath --value ${prefix}`)).toEqual([expected]);
        if (shell !== "fish") {
          expect(await complete(shell, program, `omnipolymath --value=${prefix}`)).toEqual([
            `--value=${expected}`,
          ]);
        }
      },
    );
  }

  itUnix.each(["built-in", "root"] as const)("keeps %s zsh descriptions literal", (scope) => {
    const program = new Command().name("omnipolymath");
    let describedCommand: Command;
    let commandPath: string[] = [];
    if (scope === "built-in") {
      registerModelsCli(program);
      describedCommand = commandAt(program, "models", "auth", "logout");
      commandPath = ["models", "auth"];
    } else {
      describedCommand = program
        .command("inspect")
        .alias("review")
        .description('Show John\'s "literal" $OMNIPOLYMATH_COMPLETION_LITERAL with `models auth list`');
    }
    const stdout = runZshScript(
      `${getCompletionScript("zsh", program)}
OMNIPOLYMATH_COMPLETION_LITERAL=expanded-value
models() { printf '%s\\n' "OMNIPOLYMATH_COMPLETION_DESCRIPTION_EVALUATED:$*" >&2; }
typeset -a command_path line
command_path=(${commandPath.join(" ")})
_arguments() {
  if (( \${#command_path} )); then
    state=args
    line=("$command_path[1]")
    shift command_path
    return
  fi
  state=''
  local spec
  for spec in "$@"; do
    if [[ "$spec" == "1: :"* ]]; then
      local -a action
      eval "action=( \${spec#1: :} )"
      printf '%s\\0' "\${action[@]}"
    fi
  done
}
_omnipolymath_root_completion
`,
      10_000,
    );
    if (stdout === undefined) {
      return;
    }
    const action = stdout.split("\0").filter(Boolean);
    expect(action.slice(0, 2)).toEqual(["_values", "command"]);
    for (const name of [describedCommand.name(), ...describedCommand.aliases()]) {
      expect(action).toContain(`${name}[${describedCommand.description()}]`);
    }
  });

  itUnix("keeps zsh choice and option description boundaries literal", () => {
    const description = "Use $OMNIPOLYMATH_STATE_DIR with `model/list` and John's profile";
    const program = choiceProgram([
      "two words",
      'say "hello"',
      "it's literal",
      "literal $(printf OMNIPOLYMATH_COMPLETION_VALUE_EXECUTED >&2)",
      "literal `printf OMNIPOLYMATH_COMPLETION_VALUE_EXECUTED >&2`",
    ]).option("--literal", description);
    const stdout = runZshScript(`${getCompletionScript("zsh", program)}
_arguments() { printf '%s\\n' "$@"; }
_omnipolymath_root_completion
`);
    if (stdout === undefined) {
      return;
    }
    expect(stdout).toContain("two\\ words");
    expect(stdout).toContain('say\\ \\"hello\\"');
    expect(stdout).toContain("OMNIPOLYMATH_COMPLETION_VALUE_EXECUTED");
    expect(stdout).toContain(`--literal[${description}]`);
  });

  itUnix("completes zsh options and distinct command paths", async (ctx) => {
    if (runZshScript("zmodload zsh/zpty") === undefined) {
      ctx.skip();
    }
    const program = new Command().name("omnipolymath");
    registerCompletionCli(program);
    registerAcpCli(program);
    const proof = program.command("proof").alias("p");
    proof.command("foo-bar").alias("hyphen-alias").option("--hyphen-only");
    proof.command("foo_bar").option("--underscore-only");
    proof.command("a").command("b").option("--nested-only");
    proof.command("a_b").option("--flat-only");
    const cases = [
      ["omnipolymath completion -ys f", "omnipolymath completion -ys fish"],
      ["omnipolymath completion --shell=f", "omnipolymath completion --shell=fish"],
      ["omnipolymath completion -s f", "omnipolymath completion -s fish"],
      ["omnipolymath completion -yi --shell f", "omnipolymath completion -yi --shell fish"],
      ["omnipolymath acp -vv cl", "omnipolymath acp -vv client"],
      ["omnipolymath proof foo-bar --hy", "omnipolymath proof foo-bar --hyphen-only"],
      ["omnipolymath proof foo_bar --un", "omnipolymath proof foo_bar --underscore-only"],
      ["omnipolymath proof a b --ne", "omnipolymath proof a b --nested-only"],
      ["omnipolymath proof a_b --fl", "omnipolymath proof a_b --flat-only"],
      ["omnipolymath p hyphen-alias --hy", "omnipolymath p hyphen-alias --hyphen-only"],
    ];
    const tempDir = tempDirs.make("omnipolymath-zsh-completion-");
    await fs.writeFile(
      path.join(tempDir, ".zshrc"),
      `autoload -Uz compinit
compinit -u -D
${getCompletionScript("zsh", program)}
PROMPT='OMNIPOLYMATH_READY> '
omnipolymath_capture_completion() {
  print -r -- "OMNIPOLYMATH_RESULT:$BUFFER"
  print -r -- OMNIPOLYMATH_RESULT_END
  zle reset-prompt
}
zle -N omnipolymath_capture_completion
bindkey -e
bindkey '^X' omnipolymath_capture_completion
`,
      "utf8",
    );
    const result = runZsh(
      `zmodload zsh/zpty
zpty completion zsh -di
{
  zpty -r completion output '*OMNIPOLYMATH_READY>*'
${cases
  .map(
    ([line]) => `  zpty -w -n completion '${line}'$'\t\x18'
  zpty -r completion output '*OMNIPOLYMATH_RESULT_END*'
  print -r -- "$output"
  zpty -w -n completion $'\x15'`,
  )
  .join("\n")}
} always {
  zpty -d completion
}
`,
      {
        timeout: 15_000,
        env: { ...process.env, HOME: tempDir, ZDOTDIR: tempDir, TERM: "xterm" },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({ stderr: "", status: 0 });
    const completed = [...result.stdout.matchAll(/OMNIPOLYMATH_RESULT:([^\r\n]*)/g)].map((match) =>
      match[1]?.trimEnd(),
    );
    expect(completed).toEqual(cases.map(([, expected]) => expected));
  });

  itUnix("defers zsh registration until compinit is available", async () => {
    const probe = runZsh("exit 0");
    if (probe.error) {
      if (
        "code" in probe.error &&
        (probe.error.code === "ENOENT" || probe.error.code === "EACCES")
      ) {
        return;
      }
      throw probe.error;
    }
    const tempDir = tempDirs.make("omnipolymath-zsh-completion-");
    const scriptPath = path.join(tempDir, "omnipolymath.zsh");
    await fs.writeFile(scriptPath, getCompletionScript("zsh", createCompletionProgram()), "utf8");
    const result = runZsh(
      `
            source ${JSON.stringify(scriptPath)}
            [[ -z "\${_comps[omnipolymath]-}" ]] || exit 10
            [[ "\${precmd_functions[(r)_omnipolymath_register_completion]}" = "_omnipolymath_register_completion" ]] || exit 11
            autoload -Uz compinit
            compinit -C
            _omnipolymath_register_completion
            [[ -z "\${precmd_functions[(r)_omnipolymath_register_completion]}" ]] || exit 12
            [[ "\${_comps[omnipolymath]-}" = "_omnipolymath_root_completion" ]]
          `,
      {
        env: {
          ...process.env,
          HOME: tempDir,
          ZDOTDIR: tempDir,
        },
      },
    );
    expect(result.stderr).not.toContain("command not found: compdef");
    expect(result.status).toBe(0);
  });

  itWithPowerShell("matches literal PowerShell choice prefixes", async () => {
    expect(
      await powershell.complete(
        choiceProgram(["alpha", "a*literal", "a[bracket]"]),
        "omnipolymath --value A*",
      ),
    ).toEqual(["'a*literal'"]);
  });

  it.each(powerShellQuotedChoices)(
    "escapes PowerShell literals containing %s",
    (value, escaped) => {
      const program = choiceProgram([value]);
      program.command("group").command(value).alias(`alias-${value}`).option("--json");
      const script = getCompletionScript("powershell", program);
      expect(script).toContain(`@('${escaped}')`);
      for (const name of [escaped, `alias-${escaped}`]) {
        expect(script).toContain(`'group ${name}' {`);
        expect(script).toContain(`if ($commandPath -eq 'group ${name}')`);
      }
    },
  );

  itWithPowerShell.each(powerShellQuotedChoices)(
    "completes PowerShell choices and command paths containing %s",
    async (value, escaped) => {
      const program = choiceProgram([value]);
      program.command("group").command(value).alias(`alias-${value}`).option("--json");
      expect(await powershell.complete(program, "omnipolymath --value Ja")).toEqual([`'${escaped}'`]);
      expect(await powershell.complete(program, "omnipolymath --value=Ja")).toEqual([
        `--value='${escaped}'`,
      ]);
      for (const name of [escaped, `alias-${escaped}`]) {
        expect(await powershell.complete(program, `omnipolymath group '${name}' --j`)).toEqual([
          "--json",
        ]);
      }
    },
  );

  itWithFish.each([
    ["omnipolymath gateway -t=secret status -", createCompletionProgram, ["--json"]],
    [
      "omnipolymath gateway status restart -",
      () => {
        const program = createCompletionProgram();
        commandAt(program, "gateway", "status").argument("[query...]", "Search query");
        return program;
      },
      ["--json"],
    ],
    [
      "omnipolymath --color a",
      () => choiceProgram(["always", "never"], "-c, --color [when]", ""),
      expect.arrayContaining(["always"]),
    ],
  ] as const)("completes Fish line %s", (line, makeProgram, expected) => {
    expect(runFish(makeProgram(), line)).toEqual(expected);
  });

  it("uses Commander's parsed flags instead of value placeholder syntax", () => {
    const program = new Command()
      .name("omnipolymath")
      .option("--trigger-script <path|->", "Condition script file, or - for stdin")
      .option("--ws, --workspace <name>", "Workspace");
    const fishScript = getCompletionScript("fish", program);
    expect(fishScript).toContain(
      "complete -c omnipolymath -n \"__omnipolymath_command_path_matches\" -l trigger-script -r -d 'Condition script file, or - for stdin'",
    );
    expect(fishScript).not.toContain(" -s > ");
    expect(fishScript).toContain(" -l ws -l workspace -r -d 'Workspace'");
    expect(getCompletionScript("bash", program)).not.toContain("--trigger-script ->");
    expect(getCompletionScript("zsh", program)).not.toContain("{--trigger-script,->}");
  });

  itUnix("uses nearest inherited Bash choices", () => {
    const program = createAliasedCompletionProgram();
    program.addOption(
      new Option("--channel <channel>", "Update channel").choices(["stable", "beta"]),
    );
    commandAt(program, "cron").addOption(
      new Option("--channel <channel>", "Cron channel").choices(["production", "preview"]),
    );
    expect(runBash(program, ["omnipolymath", "cron", "create", "--channel=pre"])).toEqual([
      "--channel=preview",
    ]);
  });

  itUnix("keeps hyphenated Bash short-cluster values", () => {
    const program = new Command()
      .name("omnipolymath")
      .option("-v, --verbose", "Verbose output")
      .addOption(new Option("-m, --mode <mode>").choices(["-legacy"]));
    expect(runBash(program, ["omnipolymath", "-vm", "-le"])).toEqual(["-legacy"]);
  });

  itWithPowerShell.each([
    ["omnipolymath 'completion' --shell f", ["fish"]],
    ["omnipolymath 'gateway' 'status' --j", ["--json"]],
    ["omnipolymath gateway --token 'status' --f", ["--force"]],
    ["omnipolymath gateway --token --token --f", ["--force"]],
    ["omnipolymath gateway --token --f", []],
    ["omnipolymath completion -ysf", ["-ysfish"]],
    ["omnipolymath completion -ys f", ["fish"]],
    ["omnipolymath completion --shell 'f", ["fish"]],
    ['omnipolymath completion --shell "f', ["fish"]],
    ["omnipolymath completion --shell='f", ["--shell=fish"]],
    ["omnipolymath completion --shell f --yes", ["fish"], 29],
    ["omnipolymath completion --shell fxsh", ["fish"], 29],
    ["omnipolymath completion --shell 'fxsh'", ["fish"], 30],
    ['omnipolymath completion --shell="fxsh"', ["--shell=fish"], 30],
    ["omnipolymath compzzz", ["completion"], 13],
  ] as const)("completes PowerShell line %s", async (commandLine, expected, cursor?: number) => {
    expect(await powershell.complete(documentedProgram(), commandLine, cursor)).toEqual(expected);
  });
});
