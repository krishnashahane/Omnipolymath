# Omnipolymath Amazon Bedrock Provider

Official Omnipolymath provider plugin for Amazon Bedrock. It adds Bedrock model discovery, text generation, embeddings, and guardrail-aware provider routing for agents that use AWS-hosted models.

Install from Omnipolymath:

```bash
omnipolymath plugins install @omnipolymath/amazon-bedrock-provider
```

Configure AWS credentials and region through your normal Omnipolymath credential/profile setup, then select Bedrock models with the `amazon-bedrock/...` provider prefix.
