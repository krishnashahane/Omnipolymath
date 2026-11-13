import { formatSqliteErrorCodeSuffix } from "../infra/sqlite-error-diagnostics.js";
import { OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS } from "./omnipolymath-state-db-contract.js";

export type OmnipolymathDatabaseVerifyResult = {
  path: string;
  ok: boolean;
  error?: string;
  terminal?: boolean;
};

function formatVerifyError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return `${message}${formatSqliteErrorCodeSuffix(error)}`;
}

export async function verifyOmnipolymathDatabase(target: {
  path: string;
  label: string;
  check: "quick" | "full";
}): Promise<OmnipolymathDatabaseVerifyResult> {
  const [integrity, source] = await Promise.all([
    import("../infra/sqlite-integrity.js"),
    import("../infra/sqlite-source-handle.js"),
  ]);
  const failed = (error: unknown): OmnipolymathDatabaseVerifyResult => ({
    path: target.path,
    ok: false,
    error: formatVerifyError(error),
    terminal: error instanceof Error && integrity.isTerminalSqliteIntegrityError(error),
  });
  let result: OmnipolymathDatabaseVerifyResult = { path: target.path, ok: true };
  try {
    source.withSqliteSourceReadDatabase(target.path, "source", (reader) => {
      try {
        reader.exec(`PRAGMA busy_timeout = ${OMNIPOLYMATH_SQLITE_BUSY_TIMEOUT_MS}; BEGIN;`);
        integrity.assertSqliteIntegrity(reader, target.label, { check: target.check });
        reader.exec("ROLLBACK;");
      } catch (error) {
        // Preserve the check's classification if the source reader also fails to close.
        result = failed(error);
      }
    });
  } catch (error) {
    if (result.ok) {
      result = failed(error);
    }
  }
  return result;
}

// Synchronous admission waits for native close without opening a source reader in its process.
if (process.argv[2] === "--omnipolymath-database-verify-sync" && process.argv[3]) {
  const pathname = process.argv[3];
  void verifyOmnipolymathDatabase({ path: pathname, label: pathname, check: "full" })
    .then((result) => {
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
