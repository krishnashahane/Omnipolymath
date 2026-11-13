/**
 * Verified skill store primitives: content-addressed skill digests, Ed25519
 * publisher signatures, a static permission scan, and a reputation score.
 */
import { createHash, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAX_FILES = 500;
const MAX_BYTES = 8 * 1024 * 1024;

/** SHA-256 over every file (sorted relative path + content). Symlinks are refused. */
export function digestSkillDir(dir: string): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        entry.name === "SIGNATURE.json"
      ) {
        continue;
      }
      const full = path.join(d, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`skill: symlink not allowed (${path.relative(dir, full)})`);
      }
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
      if (files.length > MAX_FILES) {
        throw new Error("skill: too many files");
      }
    }
  };
  walk(dir);
  const hash = createHash("sha256");
  let total = 0;
  for (const file of files.toSorted()) {
    const content = fs.readFileSync(file);
    total += content.length;
    if (total > MAX_BYTES) {
      throw new Error("skill: too large");
    }
    hash
      .update(path.relative(dir, file).split(path.sep).join("/"))
      .update("\0")
      .update(content)
      .update("\0");
  }
  return hash.digest("hex");
}

export type SkillSignature = {
  digest: string;
  publisher: string;
  publicKey: string;
  signature: string;
  signedAt: string;
};

export function signSkill(dir: string, publisher: string, privateKey: KeyObject): SkillSignature {
  const digest = digestSkillDir(dir);
  const signature = sign(null, Buffer.from(`${publisher}:${digest}`), privateKey).toString(
    "base64",
  );
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
  return { digest, publisher, publicKey, signature, signedAt: new Date().toISOString() };
}

export function verifySkill(
  dir: string,
  sig: SkillSignature,
  trustedPublishers: Record<string, string>,
): { ok: boolean; reason?: string } {
  const pinned = trustedPublishers[sig.publisher];
  if (!pinned) {
    return { ok: false, reason: "unknown publisher" };
  }
  if (pinned.trim() !== sig.publicKey.trim()) {
    return { ok: false, reason: "publisher key mismatch" };
  }
  const digest = digestSkillDir(dir);
  if (digest !== sig.digest) {
    return { ok: false, reason: "contents changed since signing" };
  }
  const ok = verify(
    null,
    Buffer.from(`${sig.publisher}:${digest}`),
    createPublicKey(pinned),
    Buffer.from(sig.signature, "base64"),
  );
  return ok ? { ok: true } : { ok: false, reason: "bad signature" };
}

export type PermissionFinding = { id: string; severity: "low" | "medium" | "high"; detail: string };

const SCAN_RULES: Array<{
  id: string;
  severity: PermissionFinding["severity"];
  rx: RegExp;
  detail: string;
}> = [
  {
    id: "pipe-to-shell",
    severity: "high",
    rx: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh\b/,
    detail: "downloads and executes remote code",
  },
  {
    id: "destructive-shell",
    severity: "high",
    rx: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|\bmkfs\b|\bdd\s+[^\n]*of=\/dev\//,
    detail: "destructive shell command",
  },
  {
    id: "secret-read",
    severity: "high",
    rx: /(~\/\.ssh|id_rsa|\.aws\/credentials|\.env\b|keychain|security\s+find-generic-password)/,
    detail: "reads credentials",
  },
  {
    id: "eval",
    severity: "medium",
    rx: /\beval\s*\(|new\s+Function\s*\(|child_process|subprocess\.(Popen|call)|os\.system/,
    detail: "dynamic code execution",
  },
  {
    id: "network-post",
    severity: "medium",
    rx: /\b(fetch|axios|requests)\b[^\n]*(POST|post\()|curl\b[^\n]*(-X\s*POST|--data)/,
    detail: "sends data to the network",
  },
  { id: "sudo", severity: "medium", rx: /\bsudo\b/, detail: "requests root" },
  {
    id: "obfuscation",
    severity: "medium",
    rx: /base64\s+(-d|--decode)|atob\(|\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){8,}/i,
    detail: "obfuscated payload",
  },
  {
    id: "env-access",
    severity: "low",
    rx: /process\.env|os\.environ|\$\{?[A-Z_]{3,}_(KEY|TOKEN|SECRET)\b/,
    detail: "reads environment secrets",
  },
];

export function scanSkillText(text: string): PermissionFinding[] {
  return SCAN_RULES.filter((r) => r.rx.test(text)).map(({ id, severity, detail }) => ({
    id,
    severity,
    detail,
  }));
}

/**
 * Reputation in 0..100. Signals: signature validity, scan findings, install
 * count (log-scaled), community rating, age, and reported incidents.
 */
export function reputationScore(s: {
  signed: boolean;
  findings: PermissionFinding[];
  installs: number;
  rating?: number;
  ageDays: number;
  incidents: number;
}): number {
  let score = s.signed ? 40 : 10;
  score += Math.min(20, Math.log10(1 + Math.max(0, s.installs)) * 5);
  score += s.rating ? ((Math.max(1, Math.min(5, s.rating)) - 1) / 4) * 20 : 8;
  score += Math.min(10, s.ageDays / 18);
  for (const f of s.findings) {
    score -= f.severity === "high" ? 25 : f.severity === "medium" ? 8 : 2;
  }
  score -= s.incidents * 30;
  return Math.max(0, Math.min(100, Math.round(score)));
}
