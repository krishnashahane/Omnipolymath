import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";

export function createAdminMemberRoleConfig(): OmnipolymathConfig {
  return {
    gateway: {
      roles: {
        default: "member",
        definitions: {
          admin: { scopes: ["operator.admin"], agents: "*", sessions: { others: "write" } },
          member: { scopes: ["operator.read"], agents: [], sessions: { others: "none" } },
        },
      },
    },
  };
}
