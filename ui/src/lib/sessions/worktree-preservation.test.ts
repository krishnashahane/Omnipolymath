import { describe, expect, it } from "vitest";
import {
  formatPreservedWorktreeConfirmation,
  formatPreservedWorktreesNotice,
} from "./worktree-preservation.ts";

describe("preserved session worktree presentation", () => {
  it("formats single and batch guidance with the preserved reasons", () => {
    const busy = {
      id: "wt-busy",
      branch: "omnipolymath/busy-task",
      path: "/worktrees/busy-task",
      reason: "busy" as const,
    };
    const snapshot = {
      id: "wt-snapshot",
      branch: "omnipolymath/snapshot-task",
      path: "/worktrees/snapshot-task",
      reason: "snapshot-failed" as const,
    };

    expect(formatPreservedWorktreeConfirmation(snapshot)).toBe(
      "Session needs attention: Omnipolymath could not create a safety snapshot.",
    );
    expect(formatPreservedWorktreesNotice([busy, snapshot])).toBe(
      "Managed worktrees:\nomnipolymath/busy-task — live run or cleanup active\nomnipolymath/snapshot-task — Omnipolymath could not create a safety snapshot",
    );
  });
});
