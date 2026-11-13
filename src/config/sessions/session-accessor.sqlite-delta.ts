import { runSqliteReadSnapshotSync } from "../../infra/sqlite-transaction.js";
import type { OmnipolymathAgentReadOnlyDatabase } from "../../state/omnipolymath-agent-db-readonly-open.js";
import { openOmnipolymathAgentDatabase } from "../../state/omnipolymath-agent-db.js";
import type {
  SessionTranscriptRawDeltaLimits,
  SessionTranscriptRawDeltaResult,
  SessionTranscriptReadScope,
} from "./session-accessor.sqlite-contract.js";
import { readRawDeltaInTransaction } from "./session-accessor.sqlite-raw-delta-read.js";
import {
  resolveSqliteTranscriptReadScope,
  toDatabaseOptions,
  type ResolvedTranscriptReadScope,
} from "./session-accessor.sqlite-scope.js";
import { readSessionTranscriptHotWatermark } from "./session-accessor.sqlite-transcript-watermark-read.js";
import { normalizeRawDeltaLimits } from "./session-transcript-raw-cursor.js";
import { resolveSqliteSessionTranscriptReadFence } from "./session-transcript-read-fence.js";

/** Read one generation-consistent raw transcript page without parsing excluded payload rows. */
export function readTranscriptRawDelta(
  scope: SessionTranscriptReadScope,
  limits: SessionTranscriptRawDeltaLimits = {},
): SessionTranscriptRawDeltaResult {
  const resolved = resolveSqliteTranscriptReadScope(scope);
  return readTranscriptRawDeltaInDatabase(
    openOmnipolymathAgentDatabase(toDatabaseOptions(resolved)),
    resolved,
    limits,
  );
}

export function readTranscriptRawDeltaInDatabase(
  database: OmnipolymathAgentReadOnlyDatabase,
  resolved: ResolvedTranscriptReadScope,
  limits: SessionTranscriptRawDeltaLimits,
): SessionTranscriptRawDeltaResult {
  const { maxEvents, maxBytes } = normalizeRawDeltaLimits(limits);
  const readSnapshot = () => {
    const watermark = readSessionTranscriptHotWatermark(database, resolved.sessionId, {
      requireHot: true,
    });
    const beforeEventSeq = resolveSqliteSessionTranscriptReadFence({
      database,
      ...resolved,
    })?.beforeRawSeq;
    return readRawDeltaInTransaction(
      database.db,
      resolved,
      limits.cursor,
      maxEvents,
      maxBytes,
      beforeEventSeq,
      { generation: watermark.generation ?? undefined, indexedSeq: watermark.maxSeq ?? -1 },
    );
  };
  return database.db.isTransaction
    ? readSnapshot()
    : runSqliteReadSnapshotSync(database.db, readSnapshot, {
        databaseLabel: database.path,
        operationLabel: "session transcript raw delta",
      });
}
