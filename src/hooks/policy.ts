import type { HookConfig } from "../config/types.hooks.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { HookPolicyEntry, HookSource } from "./types.js";

export type HookEnableStateReason = "disabled in config" | "workspace hook (disabled by default)";

type HookEnableState = {
  enabled: boolean;
  reason?: HookEnableStateReason;
};

type HookResolutionCollision<T> = {
  name: string;
  kept: T;
  ignored: T;
};

const HOOK_SOURCE_PRECEDENCE: Record<HookSource, number> = {
  "omnipolymath-bundled": 10,
  "omnipolymath-plugin": 20,
  "omnipolymath-managed": 30,
  "omnipolymath-workspace": 40,
};

export function resolveHookConfig(
  config: OmnipolymathConfig | undefined,
  hookKey: string,
): HookConfig | undefined {
  return config?.hooks?.internal?.entries?.[hookKey];
}

/** Resolve whether a hook is enabled before runtime requirement checks. */
export function resolveHookEnableState(params: {
  entry: HookPolicyEntry;
  hookConfig?: HookConfig;
}): HookEnableState {
  const { entry, hookConfig } = params;

  if (entry.hook.source === "omnipolymath-plugin") {
    return { enabled: true };
  }
  if (hookConfig?.enabled === false) {
    return { enabled: false, reason: "disabled in config" };
  }

  if (entry.hook.source === "omnipolymath-workspace" && hookConfig?.enabled !== true) {
    return { enabled: false, reason: "workspace hook (disabled by default)" };
  }

  return { enabled: true };
}

export function resolveHookEntries<T extends HookPolicyEntry>(
  entries: T[],
  opts?: {
    onCollisionIgnored?: (collision: HookResolutionCollision<T>) => void;
  },
): T[] {
  const ordered = entries.toSorted(
    (a, b) => HOOK_SOURCE_PRECEDENCE[a.hook.source] - HOOK_SOURCE_PRECEDENCE[b.hook.source],
  );

  const merged = new Map<string, T>();
  for (const entry of ordered) {
    const existing = merged.get(entry.hook.name);
    if (!existing) {
      merged.set(entry.hook.name, entry);
      continue;
    }
    // Precedence orders sources, but workspace code is isolated and bundled/plugin ties keep the first entry.
    const sameSource = entry.hook.source === existing.hook.source;
    if (
      entry.hook.source === "omnipolymath-workspace"
        ? sameSource
        : !sameSource || entry.hook.source === "omnipolymath-managed"
    ) {
      merged.set(entry.hook.name, entry);
      continue;
    }
    opts?.onCollisionIgnored?.({
      name: entry.hook.name,
      kept: existing,
      ignored: entry,
    });
  }

  return Array.from(merged.values());
}
