import { createOmnipolymathStateSchemaEnsurer } from "./omnipolymath-state-feature-schema-ensure.js";

export const ensureAgentProvenanceSchema = createOmnipolymathStateSchemaEnsurer({
  table: "agent_provenance",
  operationLabel: "agent-provenance.schema.ensure",
});
