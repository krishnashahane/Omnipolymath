/** ACP runtime error exports wired to Omnipolymath secret redaction. */
import { configureAcpErrorRedactor } from "@omnipolymath/acp-core";
import { redactToolPayloadText } from "../../logging/redact.js";

// Core must import ACP errors and error text only through this barrel so the
// canonical redactor is configured first. It merges operator patterns with the
// defaults so custom logging policy cannot disable provider-token coverage.
configureAcpErrorRedactor(redactToolPayloadText);

export * from "@omnipolymath/acp-core/runtime/errors";
export * from "@omnipolymath/acp-core/runtime/error-text";
