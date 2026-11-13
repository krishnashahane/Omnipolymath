import { asOptionalObjectRecord } from "@omnipolymath/normalization-core/record-coerce";
import { normalizeOptionalString } from "@omnipolymath/normalization-core/string-coerce";
import { VERSION } from "../version.js";
import type { ConfigFileSnapshot, OmnipolymathConfig } from "./types.js";
import { shouldWarnOnTouchedVersion } from "./version.js";

/** Override env var for intentional older-binary destructive config actions. */
export const ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS_ENV =
  "OMNIPOLYMATH_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS";

/** Block payload shown when an older binary would mutate newer-written config. */
export type FutureConfigActionBlock = {
  action: string;
  currentVersion: string;
  touchedVersion: string;
  message: string;
  hints: string[];
};

type FutureConfigGuardParams = {
  action: string;
  snapshot?: Pick<ConfigFileSnapshot, "config" | "sourceConfig"> | null;
  config?: OmnipolymathConfig | null;
  currentVersion?: string;
  env?: Record<string, string | undefined>;
  /** Select recovery guidance for service startup, which ignores the override. */
  serviceMode?: boolean;
};

function allowOlderBinaryDestructiveActions(env: Record<string, string | undefined>): boolean {
  const raw = env[ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function resolveTouchedVersion(params: FutureConfigGuardParams): string | null {
  const readSourceVersion = (value: unknown): string | undefined => {
    const meta = asOptionalObjectRecord(asOptionalObjectRecord(value)?.meta);
    return normalizeOptionalString(meta?.lastTouchedVersion);
  };
  return (
    readSourceVersion(params.snapshot?.sourceConfig) ??
    readSourceVersion(params.snapshot?.config) ??
    readSourceVersion(params.config) ??
    null
  );
}

/** Resolves whether a destructive action should be blocked by future config metadata. */
export function resolveFutureConfigActionBlock(
  params: FutureConfigGuardParams,
): FutureConfigActionBlock | null {
  const env = params.env ?? process.env;
  if (allowOlderBinaryDestructiveActions(env)) {
    return null;
  }

  const currentVersion = params.currentVersion ?? VERSION;
  const touchedVersion = resolveTouchedVersion(params);
  if (!touchedVersion || !shouldWarnOnTouchedVersion(currentVersion, touchedVersion)) {
    return null;
  }

  return {
    action: params.action,
    currentVersion,
    touchedVersion,
    message: `Refusing to ${params.action} because this Omnipolymath binary (${currentVersion}) is older than the config last written by Omnipolymath ${touchedVersion}.`,
    hints: [
      "Run the newer omnipolymath binary on PATH, or reinstall the intended gateway service from the newer install.",
      params.serviceMode
        ? "For an intentional downgrade, restore a verified pre-update backup with its matching Omnipolymath release. See https://omnipolymath.vercel.app/docs/install/updating/rollback-and-recovery#downgrade."
        : `Set ${ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS_ENV}=1 only for an intentional downgrade or recovery action.`,
    ],
  };
}

/** Formats a future-config action block for CLI/service error output. */
export function formatFutureConfigActionBlock(block: FutureConfigActionBlock): string {
  return [block.message, ...block.hints].join("\n");
}
