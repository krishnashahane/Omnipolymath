import type { AssistantMessage, ToolResultMessage } from "@omnipolymath/llm-core";
import { asOptionalRecord } from "@omnipolymath/normalization-core/record-coerce";
import type { AgentMessage, ToolResultContentSource } from "./types.js";

type TurnTaintMetadata = {
  resultContentSource?: ToolResultContentSource;
  turnTainted?: true;
};

function readTurnTaintMetadata(message: AgentMessage): TurnTaintMetadata | undefined {
  const metadata = Reflect.get(message, "__omnipolymath");
  const record = asOptionalRecord(metadata);
  if (!record) {
    return undefined;
  }
  return {
    ...(record.resultContentSource === "network"
      ? { resultContentSource: record.resultContentSource }
      : {}),
    ...(record.turnTainted === true ? { turnTainted: true } : {}),
  };
}

export function toolResultTaintsTurn(message: ToolResultMessage): boolean {
  return readTurnTaintMetadata(message)?.resultContentSource === "network";
}

export function isActiveTurnTainted(messages: readonly AgentMessage[]): boolean {
  const boundary = messages.findLast((message) => {
    if (message.role === "user") {
      return true;
    }
    const metadata = readTurnTaintMetadata(message);
    return metadata?.turnTainted === true || metadata?.resultContentSource === "network";
  });
  return boundary !== undefined && boundary.role !== "user";
}

export function withAssistantTurnTaint(
  message: AssistantMessage,
  tainted: boolean,
): AssistantMessage {
  if (!tainted) {
    return message;
  }
  const taintedMessage = {
    ...message,
    __omnipolymath: { ...readTurnTaintMetadata(message), turnTainted: true },
  } satisfies AssistantMessage & { __omnipolymath: TurnTaintMetadata };
  return taintedMessage;
}

export function withToolResultContentSource(
  message: ToolResultMessage,
  source: ToolResultContentSource | undefined,
): ToolResultMessage {
  if (!source) {
    return message;
  }
  const sourcedMessage = {
    ...message,
    __omnipolymath: { ...readTurnTaintMetadata(message), resultContentSource: source },
  } satisfies ToolResultMessage & { __omnipolymath: TurnTaintMetadata };
  return sourcedMessage;
}
