import { definePluginEntry } from "omnipolymath/plugin-sdk/plugin-entry";

/**
 * Omnipolymath ID Access page. The plugin only ships a Control UI page;
 * invites, approvals and removals are owner-signed statements it sends to the
 * Gateway's own omnipolymathId.* methods, so it registers nothing on the Gateway.
 */
export default definePluginEntry({
  id: "omnipolymath-id-access",
  name: "Omnipolymath ID people",
  description: "Invite people to this claw, approve their requests, see and remove members.",
  register() {},
});
