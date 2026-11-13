// Github Copilot tests cover provider auth.contract plugin behavior.
import { describeGithubCopilotProviderAuthContract } from "omnipolymath/plugin-sdk/provider-test-contracts";
import { DEFAULT_COPILOT_MODEL } from "./model-metadata.js";

describeGithubCopilotProviderAuthContract(() => import("./index.js"), DEFAULT_COPILOT_MODEL);
