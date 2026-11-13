import { definePluginEntry } from "omnipolymath/plugin-sdk/plugin-entry";
import { qaLabGatewayDefinition } from "./src/gateway-registration.js";

export default definePluginEntry(qaLabGatewayDefinition);
