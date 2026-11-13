import type { Command } from "commander";
import {
  registerCommandGroups,
  shouldEagerRegisterSubcommands,
  type CommandGroupPlaceholder,
  type CommandGroupEntry,
  formatCliCommand,
  formatHelpExamples,
  theme,
} from "omnipolymath/plugin-sdk/cli-runtime";
import { addGatewayClientOptions } from "omnipolymath/plugin-sdk/gateway-runtime";
import { danger, defaultRuntime } from "omnipolymath/plugin-sdk/runtime-env";
import { formatDocsLink } from "omnipolymath/plugin-sdk/setup-tools";
import { resolveBrowserLazySubcommand } from "../../cli-output-mode.js";
import type { BrowserParentOpts } from "./browser-cli-shared.js";

const browserExamples = [
  "omnipolymath browser status",
  "omnipolymath browser start",
  "omnipolymath browser start --headless",
  "omnipolymath browser stop",
  "omnipolymath browser tabs",
  "omnipolymath browser open https://example.com",
  "omnipolymath browser focus abcd1234",
  "omnipolymath browser close abcd1234",
  "omnipolymath browser screenshot",
  "omnipolymath browser screenshot --full-page",
  "omnipolymath browser screenshot --ref 12",
  "omnipolymath browser snapshot",
  "omnipolymath browser snapshot --format aria --limit 200",
  "omnipolymath browser snapshot --efficient",
  "omnipolymath browser snapshot --labels",
  "omnipolymath browser navigate https://example.com",
  "omnipolymath browser resize 1280 720",
  "omnipolymath browser click 12 --double",
  "omnipolymath browser click-coords 120 340",
  'omnipolymath browser type 23 "hello" --submit',
  "omnipolymath browser press Enter",
  "omnipolymath browser hover 44",
  "omnipolymath browser drag 10 11",
  "omnipolymath browser select 9 OptionA OptionB",
  "omnipolymath browser upload /tmp/omnipolymath/uploads/file.pdf",
  "omnipolymath browser upload media://inbound/file.pdf",
  'omnipolymath browser fill --fields \'[{"ref":"1","value":"Ada"}]\'',
  "omnipolymath browser dialog --accept",
  'omnipolymath browser wait --text "Done"',
  "omnipolymath browser evaluate --fn '(el) => el.textContent' --ref 7",
  "omnipolymath browser evaluate --fn 'const title = document.title; return title;'",
  "omnipolymath browser console --level error",
  "omnipolymath browser pdf",
  "omnipolymath browser batch --actions-file plan.json",
  'omnipolymath browser batch --actions \'[{"kind":"wait","timeMs":500},{"kind":"click","ref":"12"},{"kind":"type","ref":"23","text":"hello"}]\'',
  "omnipolymath browser batch --actions-file plan.json --continue",
];

const command = (
  name: string,
  description: string,
  options?: CommandGroupPlaceholder["options"],
): CommandGroupPlaceholder => ({
  name,
  description,
  ...(options ? { options } : {}),
});

function browserCommandGroups(
  browser: Command,
  parentOpts: (cmd: Command) => BrowserParentOpts,
  pluginRoot?: string,
): CommandGroupEntry[] {
  return [
    {
      placeholders: [
        command("status", "Show browser status"),
        command("start", "Start the browser (no-op if already running)"),
        command("stop", "Stop the browser (best-effort)"),
        command("reset-profile", "Reset browser profile (moves it to Trash)"),
        command("tabs", "List open tabs"),
        command("tab", "Tab shortcuts (index-based)"),
        command("open", "Open a URL in a new tab"),
        command("focus", "Focus a tab by tab reference"),
        command("close", "Close a tab (tab reference optional)"),
        command("profiles", "List all browser profiles"),
        command("system-profiles", "List Chrome-family profiles available for cookie import"),
        command("import-profile", "Import cookies from a macOS Chrome-family profile"),
        command("create-profile", "Create a new browser profile"),
        command("delete-profile", "Delete a browser profile"),
        command("doctor", "Check browser plugin readiness", [
          { flags: "--deep", description: "Run a live snapshot check" },
        ]),
      ],
      register: async () => {
        const module = await import("./browser-cli-manage.js");
        module.registerBrowserManageCommands(browser, parentOpts);
      },
    },
    {
      placeholders: [
        command("cookie-sync", "Sync allowlisted macOS browser cookies to a managed profile"),
      ],
      register: async () => {
        const module = await import("./browser-cli-cookie-sync.js");
        module.registerBrowserCookieSyncCommand(browser, parentOpts);
      },
    },
    {
      placeholders: [
        command("screenshot", "Capture a screenshot (prints the saved path)"),
        command("snapshot", "Capture a snapshot (default: ai; aria is the accessibility tree)"),
      ],
      register: async () => {
        const module = await import("./browser-cli-inspect.js");
        module.registerBrowserInspectCommands(browser, parentOpts);
      },
    },
    {
      placeholders: [
        command("navigate", "Navigate the current tab to a URL"),
        command("resize", "Resize the viewport"),
        command("click", "Click an element by ref from snapshot"),
        command("click-coords", "Click viewport coordinates"),
        command("type", "Type into an element by ref from snapshot"),
        command("press", "Press a key"),
        command("hover", "Hover an element by ai ref"),
        command("scrollintoview", "Scroll an element into view by ref from snapshot"),
        command("drag", "Drag from one ref to another"),
        command("select", "Select option(s) in a select element"),
        command("upload", "Arm file upload for the next file chooser"),
        command("waitfordownload", "Wait for the next download (and save it)"),
        command("download", "Click a ref and save the resulting download"),
        command("dialog", "Arm the next modal dialog (alert/confirm/prompt)"),
        command("fill", "Fill a form with JSON field descriptors"),
        command("wait", "Wait for time, selector, URL, load state, or JS conditions"),
        command("evaluate", "Evaluate a function against the page or a ref"),
        command("batch", "Run a batch of browser actions in one call"),
      ],
      register: async () => {
        const module = await import("./browser-cli-actions-input/register.js");
        module.registerBrowserActionInputCommands(browser, parentOpts);
      },
    },
    {
      placeholders: [
        command("console", "Get recent console messages"),
        command("pdf", "Save page as PDF"),
        command("responsebody", "Wait for a network response and return its body"),
      ],
      register: async () => {
        const module = await import("./browser-cli-actions-observe.js");
        module.registerBrowserActionObserveCommands(browser, parentOpts);
      },
    },
    {
      placeholders: [
        command("highlight", "Highlight an element by ref"),
        command("errors", "Get recent page errors"),
        command("requests", "Get recent network requests (best-effort)"),
        command("trace", "Record a Playwright trace"),
      ],
      register: async () => {
        const module = await import("./browser-cli-debug.js");
        module.registerBrowserDebugCommands(browser, parentOpts);
      },
    },
    {
      placeholders: [
        command("cookies", "Read/write cookies"),
        command("storage", "Read/write localStorage/sessionStorage"),
        command("set", "Browser environment settings"),
      ],
      register: async () => {
        const module = await import("./browser-cli-state.js");
        module.registerBrowserStateCommands(browser, parentOpts);
      },
    },
    {
      placeholders: [command("extension", "Chrome extension install, status, and pairing")],
      register: async () => {
        const module = await import("./browser-cli-extension.js");
        module.registerBrowserExtensionCommands(browser, parentOpts, pluginRoot);
      },
    },
  ];
}

export function registerBrowserCli(
  program: Command,
  argv: string[] = process.argv,
  pluginRoot?: string,
) {
  const browser = program
    .command("browser")
    .description("Manage Omnipolymath's dedicated browser (Chrome/Chromium)")
    .option("--browser-profile <name>", "Browser profile name (default from config)")
    .option("--json", "Output machine-readable JSON", false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples(
          browserExamples.map((cmd) => [cmd, ""]),
          true,
        )}\n\n${theme.muted("Docs:")} ${formatDocsLink(
          "/cli/browser",
          "omnipolymath.vercel.app/docs/cli/browser",
        )}\n`,
    )
    .action(() => {
      const message = `Missing subcommand. Try: "${formatCliCommand("omnipolymath browser status")}"`;
      if (browser.opts<BrowserParentOpts>().json) {
        throw new Error(message);
      }
      browser.outputHelp();
      defaultRuntime.error(danger(message));
      defaultRuntime.exit(1);
    });

  addGatewayClientOptions(browser);

  const parentOpts = () => browser.opts<BrowserParentOpts>();

  const subcommand = resolveBrowserLazySubcommand(argv);
  registerCommandGroups(browser, browserCommandGroups(browser, parentOpts, pluginRoot), {
    eager: shouldEagerRegisterSubcommands(),
    primary: subcommand,
    registerPrimaryOnly: subcommand !== null,
  });
}
