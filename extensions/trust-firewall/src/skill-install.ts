/**
 * Verified skill store, enforced at install time.
 *
 * On every skill install the firewall scans the skill's text files for
 * dangerous permissions and checks an optional publisher signature
 * (`SIGNATURE.json`, Ed25519 over the content digest). Findings are reported
 * to the host's install flow; policy decides whether to block.
 */
import fs from "node:fs";
import path from "node:path";
import { scanSkillText, verifySkill, type SkillSignature } from "./skill-signing.js";

export type InstallFinding = {
  ruleId: string;
  severity: "info" | "warn" | "critical";
  file: string;
  line: number;
  message: string;
};

export type SkillPolicy = {
  blockHighRisk: boolean;
  requireSignature: boolean;
  trustedPublishers: Record<string, string>;
};

const TEXT_EXT = /\.(md|txt|sh|bash|zsh|py|js|mjs|cjs|ts|rb|ps1|json|ya?ml|toml)$/i;
const MAX_FILES = 300;
const MAX_FILE_BYTES = 512 * 1024;

function textFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (out.length >= MAX_FILES || e.name === ".git" || e.name === "node_modules") {
        continue;
      }
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && (TEXT_EXT.test(e.name) || !e.name.includes("."))) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

export function checkSkillInstall(
  sourcePath: string,
  policy: SkillPolicy,
): { findings: InstallFinding[]; block?: string } {
  const findings: InstallFinding[] = [];
  let dir = sourcePath;
  try {
    if (!fs.statSync(sourcePath).isDirectory()) {
      dir = path.dirname(sourcePath);
    }
  } catch {
    return { findings };
  }
  let high = 0;
  for (const file of textFiles(dir)) {
    let content: string;
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_FILE_BYTES) {
        continue;
      }
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const f of scanSkillText(content)) {
      if (f.severity === "high") {
        high++;
      }
      findings.push({
        ruleId: `trust-firewall/${f.id}`,
        severity: f.severity === "high" ? "critical" : f.severity === "medium" ? "warn" : "info",
        file: path.relative(dir, file) || path.basename(file),
        line: 1,
        message: f.detail,
      });
    }
  }

  const sigFile = path.join(dir, "SIGNATURE.json");
  let signed = false;
  if (fs.existsSync(sigFile)) {
    try {
      const sig = JSON.parse(fs.readFileSync(sigFile, "utf8")) as SkillSignature;
      const result = verifySkill(dir, sig, policy.trustedPublishers);
      if (result.ok) {
        signed = true;
        findings.push({
          ruleId: "trust-firewall/signature",
          severity: "info",
          file: "SIGNATURE.json",
          line: 1,
          message: `signed by trusted publisher ${sig.publisher}`,
        });
      } else {
        findings.push({
          ruleId: "trust-firewall/signature",
          severity: "critical",
          file: "SIGNATURE.json",
          line: 1,
          message: `signature check failed: ${result.reason}`,
        });
        if (result.reason !== "unknown publisher") {
          return { findings, block: `skill signature check failed (${result.reason})` };
        }
      }
    } catch (error) {
      findings.push({
        ruleId: "trust-firewall/signature",
        severity: "critical",
        file: "SIGNATURE.json",
        line: 1,
        message: `unreadable signature: ${String(error).slice(0, 120)}`,
      });
      return { findings, block: "skill signature is unreadable" };
    }
  }
  if (policy.requireSignature && !signed) {
    return { findings, block: "unsigned skill (skills.requireSignature is on)" };
  }
  if (policy.blockHighRisk && high > 0 && !signed) {
    return { findings, block: `${high} high-risk permission finding(s) in an unsigned skill` };
  }
  return { findings };
}
