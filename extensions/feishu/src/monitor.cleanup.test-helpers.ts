import { closeOmnipolymathStateDatabaseForTest } from "omnipolymath/plugin-sdk/channel-ingress-test-runtime";
import { closeOmnipolymathStateDatabaseAsync } from "omnipolymath/plugin-sdk/sqlite-runtime-testing";
import { botOpenIds } from "./monitor.state.js";

export async function cleanupFeishuMonitorStateForTests(): Promise<void> {
  botOpenIds.clear();
  await closeOmnipolymathStateDatabaseAsync();
  closeOmnipolymathStateDatabaseForTest();
}
