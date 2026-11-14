/**
 * Host guard for shell commands that run outside a sandbox.
 *
 * When the agent sandbox is off (or Docker is not installed), shell commands
 * run directly on the user's machine. The risk tiers already catch commands
 * whose effects cannot be undone; this guard adds the commands that change the
 * host itself: privilege escalation, system and shell-profile files, global
 * installs, services, credentials stores and remote shells.
 */

export type UnsandboxedShellPolicy = "allow" | "approve-risky" | "approve-all";

export const UNSANDBOXED_SHELL_POLICIES: UnsandboxedShellPolicy[] = [
  "allow",
  "approve-risky",
  "approve-all",
];

const HOST_RISK: Array<[RegExp, string]> = [
  [/(^|[\s;&|(])(sudo|doas|pkexec)\s/, "privilege escalation"],
  [/(^|[\s;&|(])su(\s+-|\s+root\b|\s*$)/, "privilege escalation"],
  [
    /(>|\btee\b[^\n|;]*)\s*\/(etc|usr|bin|sbin|lib|opt|var|System|Library|boot)\//,
    "system file write",
  ],
  [
    /(>|\btee\b[^\n|;]*|\b(cp|mv|ln|sed\s+-i[^\n]*))\s*[^\n;|&]*(~|\$HOME)\/\.(zshrc|bashrc|bash_profile|profile|zprofile|config\/fish)/,
    "shell profile edit",
  ],
  [/(~|\$HOME)\/\.ssh\/|\bssh-keygen\b|\bssh-add\b/, "ssh keys"],
  [/\b(chown|chmod)\s+(-R\s+)?[^\n]*\s\/(?!tmp\b)/, "ownership/permissions on system path"],
  [
    /\bcrontab\b|\blaunchctl\s+(load|bootstrap|enable|submit)\b|\bsystemctl\s+(enable|start|restart|stop|disable|mask)\b/,
    "persistent service",
  ],
  [
    /\b(npm|pnpm|yarn)\s+(i|install|add)\s+[^\n]*(-g\b|--global\b)|\bbun\s+(add|install)\s+[^\n]*-g\b/,
    "global package install",
  ],
  [
    /\b(brew|apt|apt-get|yum|dnf|pacman|zypper|apk|port|snap|choco|winget)\s+(install|remove|uninstall|upgrade)\b/,
    "system package change",
  ],
  [/\bpip3?\s+install\b(?![^\n]*--user\b)(?![^\n]*\s-t\s)/, "pip install"],
  [
    /\bsecurity\s+(find|dump|delete|add)-\w+|\bdefaults\s+(write|delete)\b|\bosascript\b|\bcsrutil\b|\bspctl\b/,
    "macOS system settings",
  ],
  [/\b(ssh|scp|sftp|rsync)\s+[^\n]*\b[\w.-]+@[\w.-]+/, "remote shell"],
  [/\b(nc|ncat|netcat|socat)\b[^\n]*\s-(l|e)\b/, "network listener"],
  [/\bbase64\s+(-d|--decode)\b[^\n]*\|\s*(ba|z)?sh\b|\beval\s+"?\$\(/, "obfuscated execution"],
  [/\b(kill|pkill|killall)\s+(-9\s+)?(-1\b|[a-zA-Z])/, "kill processes"],
  [/\bhistory\s+-c\b|\bunset\s+HISTFILE\b|\bshred\b/, "covering tracks"],
];

/** Reasons a shell command would change the host, or an empty list. */
export function hostRiskReasons(command: string): string[] {
  const reasons = new Set<string>();
  for (const [rx, label] of HOST_RISK) {
    if (rx.test(command)) {
      reasons.add(label);
    }
  }
  return [...reasons];
}

/**
 * Decide whether an unsandboxed shell command needs a human.
 * Returns the reasons to show, or undefined when no extra approval is needed.
 */
export function unsandboxedShellApproval(
  command: string,
  policy: UnsandboxedShellPolicy,
): string[] | undefined {
  if (policy === "allow") {
    return undefined;
  }
  if (policy === "approve-all") {
    return ["unsandboxed shell"];
  }
  const reasons = hostRiskReasons(command);
  return reasons.length ? reasons.map((r) => `unsandboxed: ${r}`) : undefined;
}
