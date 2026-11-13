import { VERSION } from "../version.js";
export { normalizeAcpProvenanceMode } from "@omnipolymath/acp-core/types";

/** ACP agent identity advertised during protocol initialization. */
export const ACP_AGENT_INFO = {
  name: "omnipolymath-acp",
  title: "Omnipolymath ACP Gateway",
  version: VERSION,
};
