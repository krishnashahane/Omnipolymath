// Matrix plugin module implements monitor route test support behavior.
export {
  registerSessionBindingAdapter,
  testing,
} from "omnipolymath/plugin-sdk/session-binding-runtime";
export { resolveAgentRoute } from "omnipolymath/plugin-sdk/routing";
export {
  createTestRegistry,
  setActivePluginRegistry,
} from "omnipolymath/plugin-sdk/plugin-test-runtime";
export type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
