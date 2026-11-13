/**
 * File snapshots that make `write`, `edit` and `apply_patch` undoable.
 *
 * Before a file-changing tool runs, the firewall stores the current bytes of
 * every target file in a content-addressed blob store. After the tool runs it
 * records the new hash. Undo restores the old bytes only when the file still
 * holds exactly what the agent wrote, so it never clobbers later human edits.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Files larger than this are recorded but not snapshotted. */
export const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_CALL = 64;

export type FileSnapshot = {
  path: string;
  /** Whether the file existed before the tool ran. */
  existed: boolean;
  /** SHA-256 of the content before the tool ran (when it existed). */
  beforeSha256?: string;
  /** Permission bits before the tool ran, restored on undo. */
  mode?: number;
  /** SHA-256 of the content right after the tool ran; undefined until known or when deleted. */
  afterSha256?: string | null;
  /** Why the file could not be snapshotted, if it could not. */
  skipped?: string;
};

export type RestoreStatus =
  | "restored"
  | "deleted"
  | "unchanged"
  | "conflict"
  | "missing-blob"
  | "not-snapshotted"
  | "would-restore"
  | "would-delete";

export type RestoreResult = { path: string; status: RestoreStatus; detail?: string };

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

function hashFile(file: string): string | null {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) {
      return null;
    }
    return sha256(fs.readFileSync(file));
  } catch {
    return null;
  }
}

/**
 * Expand `~`, resolve relative paths against the agent workspace. Returns
 * undefined for a relative path when the workspace is unknown, rather than
 * guessing a directory and snapshotting the wrong file.
 */
export function resolveTargetPath(raw: string, workspaceDir?: string): string | undefined {
  let p = raw.trim();
  if (p === "~" || p.startsWith("~/")) {
    p = path.join(os.homedir(), p.slice(1));
  }
  if (path.isAbsolute(p)) {
    return path.normalize(p);
  }
  return workspaceDir ? path.resolve(workspaceDir, p) : undefined;
}

/** Paths a file-changing tool call will touch. Unknown tools return []. */
export function fileTargets(
  toolName: string,
  params: Record<string, unknown>,
  derivedPaths: readonly string[] = [],
): string[] {
  const name = toolName.toLowerCase();
  const out = new Set<string>();
  if (name === "write" || name === "edit") {
    for (const key of ["path", "file_path", "filePath"]) {
      const v = params[key];
      if (typeof v === "string" && v.trim()) {
        out.add(v);
        break;
      }
    }
  } else if (name === "apply_patch") {
    for (const p of derivedPaths) {
      out.add(p);
    }
    const patch = ["input", "patch", "diff"]
      .map((k) => params[k])
      .find((v): v is string => typeof v === "string");
    if (patch) {
      const rx = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm;
      for (const m of patch.matchAll(rx)) {
        out.add(m[1]!.trim());
      }
    }
  }
  return [...out].slice(0, MAX_FILES_PER_CALL);
}

export class SnapshotStore {
  private readonly memory = new Map<string, Buffer>();

  /** `dir` undefined keeps blobs in memory (tests and hosts without a state dir). */
  constructor(private readonly dir?: string) {}

  private blobPath(hash: string): string | undefined {
    return this.dir ? path.join(this.dir, hash.slice(0, 2), hash) : undefined;
  }

  private putBlob(data: Buffer): string {
    const hash = sha256(data);
    const file = this.blobPath(hash);
    if (!file) {
      this.memory.set(hash, data);
      return hash;
    }
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, data, { mode: 0o600 });
      fs.renameSync(tmp, file);
    }
    return hash;
  }

  private getBlob(hash: string): Buffer | undefined {
    const file = this.blobPath(hash);
    if (!file) {
      return this.memory.get(hash);
    }
    try {
      const data = fs.readFileSync(file);
      return sha256(data) === hash ? data : undefined;
    } catch {
      return undefined;
    }
  }

  /** Record the state of `file` before a tool changes it. */
  capture(file: string): FileSnapshot {
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(file);
    } catch {
      return { path: file, existed: false };
    }
    if (stat.isSymbolicLink()) {
      return { path: file, existed: true, skipped: "symlink" };
    }
    if (!stat.isFile()) {
      return { path: file, existed: true, skipped: "not a regular file" };
    }
    if (stat.size > MAX_SNAPSHOT_BYTES) {
      return { path: file, existed: true, skipped: `larger than ${MAX_SNAPSHOT_BYTES} bytes` };
    }
    try {
      return {
        path: file,
        existed: true,
        beforeSha256: this.putBlob(fs.readFileSync(file)),
        mode: stat.mode & 0o7777,
      };
    } catch (error) {
      return { path: file, existed: true, skipped: `unreadable: ${String(error).slice(0, 120)}` };
    }
  }

  /** Fill in what the tool left behind, so undo can detect later edits. */
  settle(snapshot: FileSnapshot): FileSnapshot {
    return { ...snapshot, afterSha256: hashFile(snapshot.path) };
  }

  /**
   * Put files back the way they were. Newest change first. A file is only
   * touched when it still matches what the agent wrote (unless `force`).
   */
  restore(
    snapshots: readonly FileSnapshot[],
    opts: { dryRun?: boolean; force?: boolean } = {},
  ): RestoreResult[] {
    const results: RestoreResult[] = [];
    for (const snap of snapshots) {
      if (snap.skipped) {
        results.push({ path: snap.path, status: "not-snapshotted", detail: snap.skipped });
        continue;
      }
      const current = hashFile(snap.path);
      const target = snap.existed ? (snap.beforeSha256 ?? null) : null;
      if (current === target) {
        results.push({ path: snap.path, status: "unchanged" });
        continue;
      }
      if (!opts.force && snap.afterSha256 !== undefined && current !== snap.afterSha256) {
        results.push({
          path: snap.path,
          status: "conflict",
          detail: "the file changed after the agent touched it; rerun with --force to overwrite",
        });
        continue;
      }
      if (!snap.existed) {
        if (opts.dryRun) {
          results.push({ path: snap.path, status: "would-delete" });
          continue;
        }
        if (current !== null) {
          fs.rmSync(snap.path, { force: true });
        }
        results.push({ path: snap.path, status: "deleted" });
        continue;
      }
      const data = this.getBlob(snap.beforeSha256!);
      if (!data) {
        results.push({ path: snap.path, status: "missing-blob" });
        continue;
      }
      if (opts.dryRun) {
        results.push({ path: snap.path, status: "would-restore" });
        continue;
      }
      fs.mkdirSync(path.dirname(snap.path), { recursive: true });
      const tmp = `${snap.path}.omnipolymath-undo.${process.pid}.tmp`;
      fs.writeFileSync(tmp, data, { mode: snap.mode ?? 0o644 });
      if (snap.mode !== undefined) {
        fs.chmodSync(tmp, snap.mode);
      }
      fs.renameSync(tmp, snap.path);
      results.push({ path: snap.path, status: "restored" });
    }
    return results;
  }
}
