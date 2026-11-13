import type { Result } from "@omnipolymath/normalization-core/result";
import type { DatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import type {
  AgentDeletionJournalEntry,
  AgentDeletionJournalInput,
} from "./agent-deletion-journal.types.js";
import type { OmnipolymathStateLeaseIdentity } from "./omnipolymath-state-lease.types.js";

export type AgentDeletionInput = Omit<AgentDeletionJournalInput, "operationId" | "deleteFiles"> &
  Partial<Pick<AgentDeletionJournalInput, "deleteFiles">>;

type AgentDeletionJournalMutation =
  | {
      kind: "begin";
      entry: AgentDeletionInput;
      operationId: string;
      expectedJournal: AgentDeletionJournalEntry | null;
    }
  | { kind: "rollback"; journal: AgentDeletionJournalEntry };

export type AgentDeletionJournalTransport = (
  mutation: AgentDeletionJournalMutation,
  authority: {
    identity: OmnipolymathStateLeaseIdentity;
    sourceIdentity: DatabasePathIdentity;
    signal: AbortSignal;
    assertCurrent: () => void;
  },
) => Promise<Result<AgentDeletionJournalEntry | null, Error>>;
