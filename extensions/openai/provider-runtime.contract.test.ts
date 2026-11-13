// Openai tests cover provider runtime.contract plugin behavior.
import { describeOpenAIProviderRuntimeContract } from "omnipolymath/plugin-sdk/provider-test-contracts";
import manifest from "./omnipolymath.plugin.json" with { type: "json" };

describeOpenAIProviderRuntimeContract(
  () => import("./index.js"),
  manifest.modelCatalog.providers.openai,
);
