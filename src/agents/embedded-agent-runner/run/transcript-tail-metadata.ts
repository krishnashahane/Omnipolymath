import { isTranscriptOnlyOmnipolymathAssistantMessage } from "../../../shared/transcript-only-omnipolymath-assistant.js";
import type { SessionManager } from "../../sessions/index.js";

export const preserveTrailingTranscriptMetadata = (
  entry: ReturnType<SessionManager["getEntries"]>[number],
) =>
  entry.type === "custom" ||
  entry.type === "label" ||
  entry.type === "session_info" ||
  (entry.type === "message" && isTranscriptOnlyOmnipolymathAssistantMessage(entry.message));
