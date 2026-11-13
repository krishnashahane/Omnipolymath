import { type Command, InvalidArgumentError } from "commander";
import { formatDocsLink } from "../../../packages/terminal-core/src/links.js";
import { isRich, theme } from "../../../packages/terminal-core/src/theme.js";
import { resolveCommitHash } from "../../infra/git-commit.js";
import { formatConsoleDiagnosticBlock } from "../../logging/json-console-line.js";
import { ALLOWED_LOG_LEVELS, tryParseLogLevel } from "../../logging/levels.js";
import { ExitError } from "../../runtime.js";
import { escapeRegExp } from "../../utils.js";
import { isRootVersionInvocation } from "../argv.js";
import { formatCliBannerLine, hasEmittedCliBanner } from "../banner.js";
import { CLI_NAME } from "../cli-name.js";
import { formatHelpExamples } from "../help-format.js";
import {
  getCommanderErrorCommandNames,
  getCommanderErrorCommandPath,
} from "./commander-parse-facts.js";
import { getCoreCliCommandDescriptors } from "./core-command-descriptors.js";
import { formatCliParseErrorOutput } from "./error-output.js";
import { getSubCliCommandMetadata } from "./subcli-command-metadata.js";

const CLI_NAME_PATTERN = escapeRegExp(CLI_NAME);
const CLI_LOG_LEVEL_VALUES = ALLOWED_LOG_LEVELS.join("|");
const ROOT_COMMANDS_WITH_SUBCOMMANDS = new Set([
  ...getCoreCliCommandDescriptors()
    .filter((descriptor) => descriptor.hasSubcommands)
    .map((descriptor) => descriptor.name),
  ...getSubCliCommandMetadata()
    .filter((descriptor) => descriptor.hasSubcommands)
    .map((descriptor) => descriptor.name),
]);
const ROOT_COMMANDS_HINT =
  "Hint: commands suffixed with * have subcommands. Run <command> --help for details.";

const EXAMPLES = [
  ["omnipolymath onboard", "Run guided setup for a local Gateway, workspace, auth, and channels."],
  ["omnipolymath setup --baseline", "Create the baseline config, workspace, and session folders."],
  ["omnipolymath configure", "Change models, Gateway, channels, plugins, skills, and health checks."],
  ["omnipolymath status", "Check Gateway, channel, model, and recent-session status."],
  ["omnipolymath doctor --fix", "Repair common config, service, plugin, and channel problems."],
  ["omnipolymath channels add", "Add or update a chat channel account with guided prompts."],
  ["omnipolymath channels status", "See connected messaging accounts and login state."],
  ["omnipolymath --dev gateway", "Run a dev Gateway (isolated state/config) on ws://127.0.0.1:19001."],
  ["omnipolymath gateway run --force", "Start the Gateway and replace anything bound to its port."],
  ["omnipolymath models status", "Show model/provider auth health before running agents."],
  ["omnipolymath plugins list", "Inspect enabled, disabled, and installed plugins."],
  [
    'omnipolymath agent --to +15555550123 --message "Run summary" --deliver',
    "Run one agent turn through the Gateway and optionally deliver the reply.",
  ],
  [
    'omnipolymath message send --channel telegram --target @mychat --message "Hi"',
    "Send via your Telegram bot.",
  ],
] as const;

export function formatProgramHelpOutput(str: string): string {
  // Commander emits plain section labels; decorate them after command-specific help renders.
  let output = str;
  const isRootHelp = new RegExp(
    `^Usage:\\s+${CLI_NAME_PATTERN}\\s+\\[options\\]\\s+\\[command\\]\\s*$`,
    "m",
  ).test(output);
  if (isRootHelp && /^Commands:/m.test(output)) {
    output = output.replace(/^Commands:/m, `Commands:\n  ${theme.muted(ROOT_COMMANDS_HINT)}`);
  }

  return output
    .replace(/^Usage:/gm, theme.heading("Usage:"))
    .replace(/^Options:/gm, theme.heading("Options:"))
    .replace(/^Commands:/gm, theme.heading("Commands:"));
}

export function configureProgramHelp(
  program: Command,
  ctx: { programVersion: string },
  options?: { commandsWithSubcommands?: ReadonlySet<string> },
) {
  const commandsWithSubcommands = new Set([
    ...ROOT_COMMANDS_WITH_SUBCOMMANDS,
    ...(options?.commandsWithSubcommands ?? []),
  ]);

  program
    .name(CLI_NAME)
    .description("")
    .version(ctx.programVersion)
    .option(
      "--container <name>",
      "Run the CLI inside a running Podman/Docker container named <name> (default: env OMNIPOLYMATH_CONTAINER)",
    )
    .option(
      "--dev",
      "Dev profile: isolate state under ~/.omnipolymath-dev, default gateway port 19001, and shift derived ports (browser/canvas)",
    )
    .option(
      "--profile <name>",
      "Use a named profile (isolates OMNIPOLYMATH_STATE_DIR/OMNIPOLYMATH_CONFIG_PATH under ~/.omnipolymath-<name>)",
    )
    .option(
      "--log-level <level>",
      `Global log level override for file + console (${CLI_LOG_LEVEL_VALUES})`,
      (value) => {
        const parsed = tryParseLogLevel(value);
        if (!parsed) {
          throw new InvalidArgumentError(`Invalid --log-level (use ${CLI_LOG_LEVEL_VALUES})`);
        }
        return parsed;
      },
    );

  program.option("--no-color", "Disable ANSI colors", false);
  program.helpOption("-h, --help", "Display help for command");
  program.helpCommand("help [command]", "Display help for command");

  program.configureHelp({
    sortSubcommands: true,
    sortOptions: true,
    optionTerm: (option) => theme.option(option.flags),
    subcommandTerm: (cmd) => {
      const isRootCommand = cmd.parent === program;
      const hasSubcommands = isRootCommand && commandsWithSubcommands.has(cmd.name());
      return theme.command(hasSubcommands ? `${cmd.name()} *` : cmd.name());
    },
  });

  program.configureOutput({
    writeOut: (str) => {
      process.stdout.write(formatProgramHelpOutput(str));
    },
    writeErr: (str) => {
      const message = formatProgramHelpOutput(str);
      process.stderr.write(formatConsoleDiagnosticBlock({ message }));
    },
    outputError: (str, write) => {
      write(
        formatCliParseErrorOutput(str, {
          argv: process.argv,
          commandPath: getCommanderErrorCommandPath(program),
          commandNames: getCommanderErrorCommandNames(program),
        }),
      );
    },
  });

  if (isRootVersionInvocation(process.argv)) {
    const commit = resolveCommitHash({ moduleUrl: import.meta.url });
    console.log(
      commit ? `Omnipolymath ${ctx.programVersion} (${commit})` : `Omnipolymath ${ctx.programVersion}`,
    );
    throw new ExitError(0);
  }

  program.addHelpText("beforeAll", () => {
    if (hasEmittedCliBanner() || process.env.OMNIPOLYMATH_SUPPRESS_HELP_BANNER === "1") {
      return "";
    }
    const rich = isRich();
    const line = formatCliBannerLine(ctx.programVersion, { richTty: rich, mode: "default" });
    return `\n${line}\n`;
  });

  const fmtExamples = formatHelpExamples(EXAMPLES);

  program.addHelpText("afterAll", ({ command }) => {
    if (command !== program) {
      return "";
    }
    const docs = formatDocsLink("/cli", "omnipolymath.vercel.app/docs/cli");
    return `\n${theme.heading("Examples:")}\n${fmtExamples}\n\n${theme.muted("Docs:")} ${docs}\n${theme.muted("Support:")} https://github.com/krishnashahane/Omnipolymath/issues`;
  });
}
