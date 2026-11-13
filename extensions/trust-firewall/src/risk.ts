/**
 * Risk classification for tool calls.
 *
 * Every call lands in exactly one tier. The firewall uses the tier to decide
 * whether the call runs, needs human approval, or is blocked outright.
 */

export type RiskTier = "read" | "write" | "external" | "spend" | "irreversible";

export type RiskAssessment = {
  tier: RiskTier;
  /** Short machine-readable reasons, e.g. "rm -rf", "message.send". */
  reasons: string[];
};

const TIER_ORDER: Record<RiskTier, number> = {
  read: 0,
  write: 1,
  external: 2,
  spend: 3,
  irreversible: 4,
};

export function maxTier(a: RiskTier, b: RiskTier): RiskTier {
  return TIER_ORDER[a] >= TIER_ORDER[b] ? a : b;
}

export function tierAtLeast(tier: RiskTier, floor: RiskTier): boolean {
  return TIER_ORDER[tier] >= TIER_ORDER[floor];
}

/** Shell fragments whose effects cannot be taken back. */
const IRREVERSIBLE_SHELL: Array<[RegExp, string]> = [
  [/\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+/, "rm -rf"],
  [/\bgit\s+push\b[^\n]*(--force\b|--force-with-lease\b|\s-f\b)/, "git push --force"],
  [/\bgit\s+reset\s+--hard\b/, "git reset --hard"],
  [/\bgit\s+clean\s+-[a-zA-Z]*f/, "git clean -f"],
  [/\bgit\s+branch\s+-D\b/, "git branch -D"],
  [/\b(drop|truncate)\s+(table|database|schema)\b/i, "sql drop/truncate"],
  [/\bdelete\s+from\s+\w+\s*(;|$)/i, "sql delete without where"],
  [/\bmkfs(\.\w+)?\b/, "mkfs"],
  [/\bdd\s+[^\n]*\bof=\/dev\//, "dd to device"],
  [/\b(shutdown|reboot|halt)\b/, "power"],
  [/\bkubectl\s+delete\b/, "kubectl delete"],
  [/\bterraform\s+destroy\b/, "terraform destroy"],
  [/\b(aws\s+s3\s+rm|gsutil\s+rm|az\s+storage\s+blob\s+delete)\b/, "cloud object delete"],
  [/\bnpm\s+(publish|unpublish)\b/, "npm publish"],
  [/\bgh\s+(repo\s+delete|release\s+delete)\b/, "github delete"],
  [/\bchmod\s+-R\s+777\b/, "chmod 777"],
  [/\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, "pipe to shell"],
];

const EXTERNAL_SHELL: Array<[RegExp, string]> = [
  [/\bgit\s+push\b/, "git push"],
  [/\b(curl|wget|http)\b[^\n]*(-X\s*(POST|PUT|PATCH|DELETE)|--data|-d\s)/i, "http write"],
  [/\b(sendmail|mail|mutt)\b/, "email"],
  [/\bgh\s+(pr|issue|release)\s+(create|comment|merge|close|edit)\b/, "github write"],
  [/\bvercel\b[^\n]*--prod\b/, "production deploy"],
];

const SPEND_PATTERN =
  /(pay|payment|charge|invoice|purchase|checkout|transfer|wallet|stripe|order)/i;
const SEND_PATTERN = /(send|post|reply|publish|tweet|email|message|notify|share|forward|invite)/i;
const DELETE_PATTERN = /(delete|remove|destroy|purge|drop|wipe|revoke|unsubscribe|archive)/i;
const WRITE_PATTERN = /(write|edit|patch|create|update|move|rename|mkdir|apply|install|set|save)/i;
const SHELL_TOOLS = new Set(["exec", "bash", "shell", "process", "terminal", "run_command"]);

function shellCommand(params: Record<string, unknown>): string | undefined {
  for (const key of ["command", "cmd", "script", "input"]) {
    const value = params[key];
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      return value.join(" ");
    }
  }
  return undefined;
}

/** Classify a tool call. Unknown tools default to "write" (never "read"). */
export function assessToolCall(toolName: string, params: Record<string, unknown>): RiskAssessment {
  const name = toolName.toLowerCase();
  const reasons: string[] = [];
  let tier: RiskTier = "write";

  if (SHELL_TOOLS.has(name)) {
    const command = shellCommand(params) ?? "";
    for (const [rx, label] of IRREVERSIBLE_SHELL) {
      if (rx.test(command)) {
        reasons.push(label);
        tier = "irreversible";
      }
    }
    if (tier !== "irreversible") {
      for (const [rx, label] of EXTERNAL_SHELL) {
        if (rx.test(command)) {
          reasons.push(label);
          tier = "external";
        }
      }
    }
    if (reasons.length === 0) {
      reasons.push("shell");
    }
    return { tier, reasons };
  }

  if (
    /^(read|view|list|ls|grep|glob|search|find|get|fetch|web_search|web_fetch|memory_search|status)\b/.test(
      name,
    ) ||
    /_(read|list|get|search|status)$/.test(name)
  ) {
    return { tier: "read", reasons: ["read-only tool"] };
  }
  if (SPEND_PATTERN.test(name)) {
    return { tier: "spend", reasons: [`${toolName}: spend`] };
  }
  if (DELETE_PATTERN.test(name)) {
    return { tier: "irreversible", reasons: [`${toolName}: delete`] };
  }
  if (SEND_PATTERN.test(name)) {
    return { tier: "external", reasons: [`${toolName}: outbound`] };
  }
  const action = typeof params.action === "string" ? params.action : "";
  if (action) {
    if (DELETE_PATTERN.test(action)) {
      return { tier: "irreversible", reasons: [`${toolName}.${action}`] };
    }
    if (SPEND_PATTERN.test(action)) {
      return { tier: "spend", reasons: [`${toolName}.${action}`] };
    }
    if (SEND_PATTERN.test(action)) {
      return { tier: "external", reasons: [`${toolName}.${action}`] };
    }
    if (/^(read|list|get|search|status|view|show)/i.test(action)) {
      return { tier: "read", reasons: [`${toolName}.${action}`] };
    }
  }
  if (WRITE_PATTERN.test(name)) {
    reasons.push(`${toolName}: write`);
  } else {
    reasons.push(`${toolName}: unclassified (treated as write)`);
  }
  return { tier, reasons };
}
