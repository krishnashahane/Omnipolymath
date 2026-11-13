import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";

export function createBedrockAwsSdkConfig(): OmnipolymathConfig {
  return {
    models: {
      providers: {
        "amazon-bedrock": {
          auth: "aws-sdk",
          baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
          api: "bedrock-converse-stream",
          models: [],
        },
      },
    },
    auth: {
      profiles: {
        "amazon-bedrock:default": {
          provider: "amazon-bedrock",
          mode: "aws-sdk",
        },
      },
    },
  };
}
