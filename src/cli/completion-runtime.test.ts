import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it as baseIt, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { withEnvAsync } from "../test-utils/env.js";
import {
  type CompletionShell,
  formatCompletionReloadCommand,
  installCompletion,
  isCompletionInstalled,
  removeCompletionRegistrations,
  resolveCompletionCachePath,
  resolveCompletionProfileHint,
  resolveCompletionProfilePath,
  resolveShellFromEnv,
  usesSlowDynamicCompletion,
} from "./completion-runtime.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const windowsShells = {
  core: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
  legacy: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
};

const completionTest = (portable = false, statePrefix = "omnipolymath-completion-state-") =>
  baseIt.extend<{ homeDir: string; stateDir: string }>({
    homeDir: async ({ task }, use) => use(tempDirs.make(`omnipolymath-home-${task.id}-`)),
    stateDir: [
      async ({ homeDir }, use) => {
        const stateDir = portable ? path.join(homeDir, ".omnipolymath") : tempDirs.make(statePrefix);
        await withEnvAsync(
          {
            HOME: homeDir,
            USERPROFILE: homeDir,
            OMNIPOLYMATH_STATE_DIR: stateDir,
            XDG_CONFIG_HOME: undefined,
            ZDOTDIR: undefined,
          },
          () => use(stateDir),
        );
      },
      { auto: true },
    ],
  });
const it = completionTest();
const portableIt = completionTest(true);
const literalIt = completionTest(false, "completion-$dollar Ada's !42-$state's-");

async function writeText(filePath: string, content: string | Buffer) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}
const writeCompletionCache = (shell: CompletionShell, content = "# completion\n") =>
  writeText(resolveCompletionCachePath(shell, "omnipolymath"), content);
const writeProfile = (shell: CompletionShell, content: string | Buffer) =>
  writeText(resolveCompletionProfilePath(shell), content);

const readProfile = (profilePath: string) => fs.readFile(profilePath, "utf8");
const removeSelectedCompletion = (stateDir: string, assertCurrent = () => {}) =>
  removeCompletionRegistrations({ stateDirs: [stateDir], preservePaths: [], assertCurrent });

it.skipIf(process.platform === "win32")(
  "escapes terminal controls in installation messages without changing profile paths",
  async ({ homeDir }) => {
    const profileDir = path.join(
      homeDir,
      "profiles-café\u001b[31m\noperator-forged\tend\rrow\u0007",
    );
    vi.stubEnv("ZDOTDIR", profileDir);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cachePath = await writeCompletionCache("zsh");

    await installCompletion("zsh", false);
    const profilePath = path.join(profileDir, ".zshrc");
    const installed = await readProfile(profilePath);
    expect(installed).toContain(cachePath);
    await installCompletion("zsh", false);
    expect(await readProfile(profilePath)).toBe(installed);

    const messages = [...warn.mock.calls, ...log.mock.calls].map((args) => args.join(" "));
    expect(messages.some((message) => message.includes("Profile not found"))).toBe(true);
    expect(messages.some((message) => message.includes("Installing completion"))).toBe(true);
    expect(messages).toContain("Completion installed. Restart your shell to load it.");
    expect(messages.some((message) => message.includes("already installed"))).toBe(true);
    for (const message of messages) {
      expect(message).not.toMatch(/\p{Cc}/u);
    }
    expect(messages.join("\n")).toContain("profiles-café\\noperator-forged\\tend\\rrow");
  },
);

it.skipIf(process.platform === "win32").for([false, true])(
  "rejects non-regular profiles without replacing them (FIFO=%s)",
  async (fifo, { homeDir }) => {
    await writeCompletionCache("zsh");
    const profilePath = path.join(homeDir, ".zshrc");
    await (fifo ? execFileSync("mkfifo", [profilePath]) : fs.symlink("/dev/null", profilePath));
    await expect(isCompletionInstalled("zsh")).rejects.toThrow(/regular file/);
    await expect(usesSlowDynamicCompletion("zsh")).rejects.toThrow(/regular file/);
    await expect(installCompletion("zsh", true)).rejects.toThrow(/regular file/);
    if (fifo) {
      expect((await fs.lstat(profilePath)).isFIFO()).toBe(true);
    }
  },
);

function expectProfileMode(profilePath: string) {
  return process.platform === "win32"
    ? Promise.resolve()
    : fs.stat(profilePath).then((stat) => expect(stat.mode & 0o777).toBe(0o640));
}

it.skipIf(process.platform === "win32").for([
  ["zsh", "ZDOTDIR", ".zshrc"],
  ["fish", "XDG_CONFIG_HOME", "fish/config.fish"],
  ["powershell", "XDG_CONFIG_HOME", "powershell/Microsoft.PowerShell_profile.ps1"],
  ["zsh", "HOME", ".zshrc"],
  ["bash", "HOME", ".bash_profile"],
  ["fish", "HOME", ".config/fish/config.fish"],
] as const)(
  "preserves %s profile traversal through symlinked %s before parent components",
  async ([shell, variable, profileName], { homeDir }) => {
    const profileParent = tempDirs.make(`omnipolymath-${shell}-symlink-profiles-`);
    const nestedProfiles = path.join(profileParent, "nested");
    const linkedProfiles = path.join(homeDir, "linked-profiles");
    await fs.mkdir(nestedProfiles, { recursive: true });
    await fs.symlink(nestedProfiles, linkedProfiles, "dir");
    const startupDir = `${linkedProfiles}${path.sep}..`;
    vi.stubEnv(variable, startupDir);
    const cachePath = await writeCompletionCache(shell, "OMNIPOLYMATH_COMPLETION_LOADED=ready\n");
    await installCompletion(shell, true, "omnipolymath");
    await expect(readProfile(path.join(profileParent, profileName))).resolves.toContain(cachePath);
    const hintRoot =
      shell === "powershell" ? startupDir : variable !== "HOME" ? "~/linked-profiles/.." : "~";
    expect(resolveCompletionProfileHint(shell)).toBe(`${hintRoot}/${profileName}`);
  },
);

it.each([
  ["", "/.zshrc"],
  ["~/literal startup", "./~/literal startup/.zshrc"],
  ["../startup", "../startup/.zshrc"],
])("preserves literal and set-but-empty Zsh startup directories: %s", (root, expected) => {
  vi.stubEnv("ZDOTDIR", root);
  const resolve = root === "" ? resolveCompletionProfilePath : resolveCompletionProfileHint;
  expect(resolve("zsh")).toBe(expected.replaceAll("/", path.sep));
});

literalIt.for(["bash", "zsh"] as const)(
  "loads literal %s profiles with spaces and quotes",
  async (shell) => {
    const bash = shell === "bash";
    const profilePath = bash
      ? resolveCompletionProfilePath(shell)
      : path.join(tempDirs.make("omnipolymath zsh Ada's !42 reload profile-"), ".shellrc");
    await fs.writeFile(
      profilePath,
      bash ? "export COMPLETION_PROOF=value\\ \n" : "OMNIPOLYMATH_COMPLETION_LOADED=ready\n",
    );
    if (bash) {
      await writeCompletionCache(shell, "complete -W 'status' omnipolymath\n");
      await installCompletion(shell, true, "omnipolymath");
      await expect(isCompletionInstalled(shell, "omnipolymath")).resolves.toBe(true);
      await expect(usesSlowDynamicCompletion(shell, "omnipolymath")).resolves.toBe(false);
    }
    const reloadCommand = formatCompletionReloadCommand(shell, profilePath);
    if (!bash) {
      expect(reloadCommand).toBe(`source '${profilePath.replaceAll("'", "'\\''")}'`);
    }
    const probe = bash
      ? 'complete -p omnipolymath; printf "<%s>\\n" "$COMPLETION_PROOF"'
      : '[ "$OMNIPOLYMATH_COMPLETION_LOADED" = ready ]';
    const result = spawnSync(
      shell,
      [...(bash ? ["--noprofile", "--norc"] : []), "-c", `${reloadCommand}; ${probe}`],
      { encoding: "utf8" },
    );
    if (bash) {
      expect(result).toMatchObject({ stderr: "", status: 0 });
      expect(result.stdout).toBe("complete -W 'status' omnipolymath\n<value >\n");
    } else if (result.error) {
      expect(result.error).toHaveProperty("code", expect.stringMatching(/^(ENOENT|EACCES)$/));
    } else {
      expect(result).toMatchObject({ stderr: "", status: 0 });
    }
  },
);

it.for([
  ["install", "Failed to install completion: injected completion profile write failure"],
  ["remove", "injected completion profile write failure"],
  ["invalidate", "completion ownership invalidated"],
  ["concurrent", "Completion profile changed during cleanup"],
] as const)(
  "preserves an existing profile when atomic publication fails: %s",
  async ([operation, error], { homeDir, stateDir }) => {
    const cachePath = await writeCompletionCache("zsh");
    const original =
      "export IMPORTANT=keep\n" + (operation === "install" ? "" : `source "${cachePath}"\n`);
    const profilePath = await writeProfile("zsh", original);
    const edit = operation === "concurrent" ? "export CONCURRENT=keep\n" : "";
    await fs.chmod(profilePath, 0o640);
    const open = fs.open;
    let current = true;
    vi.spyOn(fs, "open").mockImplementation(async (...args) => {
      const handle = await open(...args);
      const sync = handle.sync.bind(handle);
      vi.spyOn(handle, "sync").mockImplementation(async () => {
        await sync();
        if (operation === "invalidate") {
          current = false;
        } else if (edit) {
          await fs.appendFile(profilePath, edit);
        } else {
          await handle.truncate(1);
          throw new Error("injected completion profile write failure");
        }
      });
      return handle;
    });
    const assertCurrent = () => {
      if (!current) {
        throw new Error("completion ownership invalidated");
      }
    };
    await expect(
      operation === "install"
        ? installCompletion("zsh", true, "omnipolymath")
        : removeSelectedCompletion(stateDir, assertCurrent),
    ).rejects.toThrow(error);
    await expect(readProfile(profilePath)).resolves.toBe(original + edit);
    await expectProfileMode(profilePath);
    expect(await fs.readdir(homeDir)).toEqual([".zshrc"]);
  },
);

it.skipIf(process.platform === "win32").for([false, true])(
  "preserves a profile symlink while writing its target (dangling=%s)",
  async (dangling, { homeDir, stateDir }) => {
    const cachePath = await writeCompletionCache("zsh");
    const targetDir = dangling
      ? path.join(homeDir, "managed")
      : tempDirs.make("completion-target-");
    const targetPath = path.join(targetDir, "zshrc");
    const profilePath = path.join(homeDir, ".zshrc");
    await fs.mkdir(targetDir, { recursive: true });
    if (!dangling) {
      await fs.writeFile(targetPath, "export IMPORTANT=keep\n", "utf8");
    }
    await fs.symlink(dangling ? path.join("managed", "zshrc") : targetPath, profilePath);
    await installCompletion("zsh", true, "omnipolymath");
    expect((await fs.lstat(profilePath)).isSymbolicLink()).toBe(true);
    const profile = await readProfile(targetPath);
    if (dangling) {
      expect(await fs.readlink(profilePath)).toBe(path.join("managed", "zshrc"));
      expect(profile).toContain("# Omnipolymath Completion");
    } else {
      expect(profile).toContain("export IMPORTANT=keep\n");
      expect(profile).toContain(cachePath);
    }
    const alias = path.join(homeDir, ".bashrc");
    await fs.symlink(targetPath, alias);
    await expect(removeSelectedCompletion(stateDir)).resolves.toEqual([profilePath]);
    await expect(readProfile(targetPath)).resolves.toBe(
      dangling ? "" : "export IMPORTANT=keep\n\n",
    );
    expect((await fs.lstat(profilePath)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(alias)).toBe(targetPath);
  },
);

literalIt(
  "replaces the current fish source after the literal state directory changes",
  async ({ stateDir }) => {
    const shell = "fish";
    const previousStateDir = tempDirs.make(
      `omnipolymath-completion-previous-${process.platform === "win32" ? "" : '"'}$state's ‘quoted’-`,
    );
    const profilePath = resolveCompletionProfilePath(shell);
    await withEnvAsync({ OMNIPOLYMATH_STATE_DIR: previousStateDir }, async () => {
      await writeCompletionCache(shell, "# previous completion\n");
      await installCompletion(shell, true, "omnipolymath");
    });
    const previousSource = (await readProfile(profilePath)).trim().split("\n").at(-1)!;

    await writeCompletionCache(shell, "# current completion\n");
    await installCompletion(shell, true, "omnipolymath");

    const profile = await readProfile(profilePath);
    expect(profile).not.toContain(previousSource);
    expect(profile.match(/^# Omnipolymath Completion$/gm)).toHaveLength(1);
    await expect(isCompletionInstalled(shell, "omnipolymath")).resolves.toBe(true);
    await installCompletion(shell, true, "omnipolymath");
    await expect(readProfile(profilePath)).resolves.toBe(profile);
    await expect(removeSelectedCompletion(stateDir)).resolves.toEqual([profilePath]);
    await expect(readProfile(profilePath)).resolves.toBe("");
  },
);

it("preserves unrelated sources during installation and selected-state removal", async ({
  homeDir,
  stateDir: root,
}) => {
  const stateDir = path.join(root, process.platform === "win32" ? "state" : "literal\nstate");
  vi.stubEnv("OMNIPOLYMATH_STATE_DIR", stateDir);
  const cachePath = await writeCompletionCache("bash", "# current completion\n");
  const unrelatedSource = 'source "/opt/tools/completions/omnipolymath.zsh"';
  const unmarkedPriorSource = 'source "/opt/tools/completions/omnipolymath.bash"';
  const markedUserSources = [
    "source '/opt/tools/not-completions/omnipolymath.bash'",
    "source '/opt/tools/completions/omnipolymath.zsh'",
    "[ -f '/other/completions/omnipolymath.bash' ] && source '/opt/tools/completions/omnipolymath.bash'",
    '[ -f "/opt/tools/completions/omnipolymath.bash" ] && source "/opt/tools/completions/omnipolymath.bash"; export IMPORTANT=keep',
    "source '/opt/tools/completions/omnipolymath.bash'; export IMPORTANT=keep",
    'source "/old/completions/omnipolymath.bash"; printf "%s" "/other/completions/omnipolymath.bash"',
    "source '/opt/tools/completions/omnipolymath.bash",
    '. "/opt/tools/completions/omnipolymath.bash"',
  ];
  const profilePath = await writeProfile(
    "bash",
    [
      unrelatedSource,
      unmarkedPriorSource,
      ...markedUserSources.flatMap((source) => ["# Omnipolymath Completion", source]),
      "",
    ].join("\n"),
  );

  await installCompletion("bash", true, "omnipolymath");

  const profile = await readProfile(profilePath);
  for (const source of [unrelatedSource, unmarkedPriorSource, ...markedUserSources]) {
    expect(profile).toContain(`${source}\n`);
  }
  expect(profile).toContain(cachePath);

  const keptState = path.join(stateDir, "kept");
  const keptCache = resolveCompletionCachePath("bash", "omnipolymath", keptState);
  const retained =
    [unrelatedSource, unmarkedPriorSource, ...markedUserSources].join("\n") +
    `\n# Omnipolymath Completion\r\nexport IMPORTANT=keep\n# Omnipolymath Completion\nsource "${keptCache}"\r\nsource "${cachePath}"; export COMPOUND=keep\r\nsource <(omnipolymath completion --shell bash)\n`;
  const content = Buffer.from(
    `# Omnipolymath Completion\r\n[ -f "${cachePath}" ] && source "${cachePath}"\n${retained}source "${cachePath}"`,
  );
  const expected = Buffer.from(retained);
  expected[0] = 0xff;
  content[content.indexOf(retained)] = 0xff;
  const profiles = [path.join(homeDir, ".bashrc"), profilePath];
  for (const file of profiles) {
    await fs.writeFile(file, content);
    await fs.chmod(file, 0o640);
  }
  const opts = { stateDirs: [stateDir, keptState], preservePaths: [keptState] };
  const tree = await fs.readdir(homeDir);
  for (const removal of [{ dryRun: true }, { assertCurrent: () => {} }] as const) {
    await expect(removeCompletionRegistrations({ ...opts, ...removal })).resolves.toEqual(profiles);
    for (const file of profiles) {
      await expect(fs.readFile(file)).resolves.toEqual("dryRun" in removal ? content : expected);
      await expectProfileMode(file);
    }
    expect(await fs.readdir(homeDir)).toEqual(tree);
  }
});

it.for([
  ["bash", undefined, 'source <(omnipolymath completion --shell bash >"$HOME/completion.log")'],
  [
    "bash",
    'eval "$(omnipolymath completion --shell bash)"',
    "alias refresh_omnipolymath='omnipolymath completion --write-state'",
  ],
  [
    "powershell",
    "omnipolymath completion --shell powershell | Out-String | Invoke-Expression",
    "$refresh = 'omnipolymath completion --write-state' # café",
  ],
] as const)(
  "migrates %s completion without deleting user commands: %s",
  async ([shell, replaced, retained], { stateDir }) => {
    // PowerShell loads BOM-marked UTF-16 profiles on every platform.
    const bom = shell === "powershell" ? "\uFEFF" : "";
    const encoding = bom ? "utf16le" : "utf8";
    await writeCompletionCache(shell);
    const lines = [replaced, retained, ""].filter((line) => line !== undefined).join("\n");
    const profilePath = await writeProfile(shell, Buffer.from(bom + lines, encoding));
    await expect(usesSlowDynamicCompletion(shell, "omnipolymath")).resolves.toBe(Boolean(replaced));
    await installCompletion(shell, true, "omnipolymath");
    const profile = (await fs.readFile(profilePath)).toString(encoding);
    expect(profile).toContain(retained + "\n");
    await expect(isCompletionInstalled(shell, "omnipolymath")).resolves.toBe(true);
    if (replaced) {
      expect(profile).not.toContain(replaced);
      await expect(removeSelectedCompletion(stateDir)).resolves.toEqual([profilePath]);
      const removed = Buffer.from(`${bom}${retained}\n\n`, encoding);
      await expect(fs.readFile(profilePath)).resolves.toEqual(removed);
    }
  },
);

it.each([
  ["powershell", "C:\\Users\\Ada\\profile.ps1", ". 'C:\\Users\\Ada\\profile.ps1'"],
  ["bash", "~/Ada's !42 profile/.shellrc", "source ~/'Ada'\\''s !42 profile/.shellrc'"],
] as const)("quotes literal %s reload paths with native expansion", (shell, profile, expected) => {
  expect(formatCompletionReloadCommand(shell, profile)).toBe(expected);
});

it.each([
  ["C:\\Windows\\System32\\cmd.exe", "win32", "powershell", "PowerShell"],
  [windowsShells.core, "win32", "powershell", "PowerShell"],
  [windowsShells.legacy, "win32", "powershell", "WindowsPowerShell"],
  [undefined, "linux", "zsh", undefined],
] as const)("detects %s on %s and resolves its profile", (shell, platform, expected, directory) => {
  const home = "C:\\Users\\Ada";
  vi.spyOn(process, "platform", "get").mockReturnValue(platform);
  vi.spyOn(os, "homedir").mockReturnValue(home);
  vi.stubEnv("HOME", undefined);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("SHELL", shell);
  expect(resolveShellFromEnv()).toBe(expected);
  if (directory) {
    expect(resolveCompletionProfilePath("powershell")).toBe(
      path.win32.join(home, "Documents", directory, "Microsoft.PowerShell_profile.ps1"),
    );
  }
});

it("rejects missing-cache installation and leaves an empty home untouched by removal dry-run", async ({
  homeDir,
  stateDir,
}) => {
  await expect(installCompletion("zsh", true, "omnipolymath")).rejects.toThrow(
    "Completion cache not found",
  );
  await expect(
    removeCompletionRegistrations({ stateDirs: [stateDir], preservePaths: [], dryRun: true }),
  ).resolves.toEqual([]);
  expect(await fs.readdir(homeDir)).toEqual([]);
  const cachePath = resolveCompletionCachePath("bash", "omnipolymath");
  await writeProfile(
    "bash",
    `# Omnipolymath Completion\n[ -f "${cachePath}" ] && source "${cachePath}"\n`,
  );
  await expect(isCompletionInstalled("bash", "omnipolymath")).resolves.toBe(true);
});

portableIt.skipIf(process.platform === "win32").for([
  [
    "bash",
    '# User text 合法 � 😀\n# Omnipolymath Completion\n[[ -f "${HOME}/.omnipolymath/completions/omnipolymath.bash" ]] && source "${HOME}/.omnipolymath/completions/omnipolymath.bash"',
    true,
  ],
  [
    "fish",
    'test -f "$HOME/.omnipolymath/completions/omnipolymath.fish"; and source "$HOME/.omnipolymath/completions/omnipolymath.fish"',
    true,
  ],
  [
    "bash",
    '# Omnipolymath Completion\n[ -f "$HOME/.other/completions/omnipolymath.bash" ] && source "$HOME/.other/completions/omnipolymath.bash"',
    false,
  ],
] as const)(
  "preserves %s hook %s (recognized=%s)",
  async ([shell, hook, recognized], { homeDir, stateDir }) => {
    const profilePath = path.join(
      homeDir,
      shell === "bash" ? ".bashrc" : ".config/fish/config.fish",
    );
    const cachePath = await writeCompletionCache(
      shell,
      shell === "bash"
        ? "complete -W 'completion doctor' omnipolymath\n"
        : "# cached fish completion\n",
    );
    if (shell === "bash" && recognized) {
      expect(cachePath).toBe(path.join(stateDir, "completions", "omnipolymath.bash"));
    }
    await writeText(profilePath, hook + "\n");
    await expect(isCompletionInstalled(shell, "omnipolymath")).resolves.toBe(recognized);
    await installCompletion(shell, true, "omnipolymath");
    const first = await readProfile(profilePath);
    if (recognized) {
      expect(first).toBe(hook + "\n");
    } else {
      expect(first).toContain(hook.split("\n")[1] + "\n");
      expect(first).toContain("# Omnipolymath Completion");
      expect(first).toContain(cachePath);
      await expect(isCompletionInstalled(shell, "omnipolymath")).resolves.toBe(true);
    }
    await installCompletion(shell, true, "omnipolymath");
    await expect(readProfile(profilePath)).resolves.toBe(first);
    if (shell === "bash" && recognized) {
      const freshBash = spawnSync(
        "bash",
        ["-c", `source "${profilePath}" && complete -p omnipolymath`],
        { encoding: "utf8" },
      );
      expect(freshBash).toMatchObject({ stderr: "", status: 0 });
      expect(freshBash.stdout).toContain("omnipolymath");
    }
    await expect(removeSelectedCompletion(stateDir)).resolves.toEqual(
      recognized ? [] : [profilePath],
    );
    await expect(readProfile(profilePath)).resolves.toBe(
      recognized ? hook + "\n" : hook.split("\n")[1] + "\n\n",
    );
  },
);
