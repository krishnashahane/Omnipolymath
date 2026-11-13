import { openOmnipolymathStateDatabase } from "../../state/omnipolymath-state-db.js";
import {
  findLiveRegistryWorktreeByOwnerInDatabase,
  getRegistryWorktreeInDatabase,
  listRegistryWorktreesInDatabase,
  worktreeReadOperations,
} from "./registry-read.kernel.js";
import type { ManagedWorktreeOwnerKind, ManagedWorktreeRecord } from "./types.js";

export function getRegistryWorktree(
  env: NodeJS.ProcessEnv,
  id: string,
): ManagedWorktreeRecord | undefined {
  return getRegistryWorktreeInDatabase(openOmnipolymathStateDatabase({ env }).db, id);
}

export function findLiveRegistryWorktreeByOwner(
  env: NodeJS.ProcessEnv,
  ownerKind: ManagedWorktreeOwnerKind,
  ownerId: string,
): ManagedWorktreeRecord | undefined {
  return findLiveRegistryWorktreeByOwnerInDatabase(
    openOmnipolymathStateDatabase({ env }).db,
    ownerKind,
    ownerId,
  );
}

export function findLiveRegistryWorktreeByPath(
  env: NodeJS.ProcessEnv,
  worktreePath: string,
): ManagedWorktreeRecord | undefined {
  return worktreeReadOperations["worktrees.findLiveByPath"](
    { path: worktreePath },
    openOmnipolymathStateDatabase({ env }).db,
  ).value;
}

export function listRegistryWorktrees(env: NodeJS.ProcessEnv): ManagedWorktreeRecord[] {
  return listRegistryWorktreesInDatabase(openOmnipolymathStateDatabase({ env }).db);
}
