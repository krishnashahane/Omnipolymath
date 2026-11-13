import { describeSglangProviderDiscoveryContract } from "omnipolymath/plugin-sdk/provider-test-contracts";

describeSglangProviderDiscoveryContract({
  load: () => import("./index.js"),
});
