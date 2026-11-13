import type { Insertable, Selectable } from "kysely";
import type { DB as OmnipolymathStateKyselyDatabase } from "../state/omnipolymath-state-db.generated.js";

type ManagedImageRetentionClass = "transient" | "history";

export type ManagedImageRecord = {
  attachmentId: string;
  sessionKey: string;
  agentId?: string;
  messageId: string | null;
  createdAt: string;
  updatedAt?: string;
  retentionClass?: ManagedImageRetentionClass;
  alt: string;
  original: {
    mediaRoot: string;
    mediaId: string;
    mediaSubdir: string;
    contentType: string;
    width: number | null;
    height: number | null;
    sizeBytes: number | null;
    filename: string | null;
  };
};

export type ManagedImageRecordDatabase = Pick<
  OmnipolymathStateKyselyDatabase,
  "managed_outgoing_image_records"
>;
export type ManagedImageRecordRow = Omit<
  Selectable<ManagedImageRecordDatabase["managed_outgoing_image_records"]>,
  "record_json"
>;
export type ManagedImageRecordInsert = Insertable<
  ManagedImageRecordDatabase["managed_outgoing_image_records"]
>;
export type ManagedImageRecordEntry = {
  record: ManagedImageRecord;
  cleanupPending: boolean;
};

export type ManagedImageRecordAttachment = {
  attachmentId: string;
  sessionKey: string;
  messageId: string;
  updatedAt: string;
};
