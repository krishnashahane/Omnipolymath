import { StartupMaintenanceRequiredError } from "../infra/startup-maintenance-required.js";

export const LEGACY_SKILL_WORKSHOP_COLLECTION_REVIEWS_INDEX =
  "idx_skill_workshop_collection_reviews_workspace_time";

type OmnipolymathStateDatabaseSchemaMigrationRequiredKind =
  | "audit-events-v2"
  | "legacy-cron-run-logs"
  | "legacy-workshop-review-index";

export class OmnipolymathStateDatabaseSchemaMigrationRequiredError extends StartupMaintenanceRequiredError {
  constructor(
    override readonly kind: OmnipolymathStateDatabaseSchemaMigrationRequiredKind,
    readonly pathname: string,
  ) {
    super(
      kind,
      `Omnipolymath state database schema migration required (${kind}) at ${pathname}; run omnipolymath doctor --fix to migrate it.`,
    );
    this.name = "OmnipolymathStateDatabaseSchemaMigrationRequiredError";
  }
}

/** Runtime readers report malformed legacy state without entering repair mode. */
export function normalizeOmnipolymathStateSchemaReadError(error: unknown, pathname: string): unknown {
  if (
    error instanceof Error &&
    error.message.startsWith(
      `malformed database schema (${LEGACY_SKILL_WORKSHOP_COLLECTION_REVIEWS_INDEX})`,
    )
  ) {
    const required = new OmnipolymathStateDatabaseSchemaMigrationRequiredError(
      "legacy-workshop-review-index",
      pathname,
    );
    required.cause = error;
    return required;
  }
  return error;
}

// Preserve typed refusals and cancellation reasons while adding missing startup context.
export function annotateStartupStateInspectionFailure(
  failure: unknown,
  pathname: string,
  signal?: AbortSignal,
): unknown {
  if (!signal?.aborted && failure instanceof Error && !failure.message.includes(pathname)) {
    failure.message = `Omnipolymath state database ${pathname} failed startup inspection: ${failure.message}`;
  }
  return failure;
}
