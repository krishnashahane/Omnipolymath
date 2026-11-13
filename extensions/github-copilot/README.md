# GitHub Copilot

Use models available to your GitHub Copilot account in Omnipolymath. This plugin
provides account login, model discovery, and embeddings. Model access depends on
your Copilot plan and organization policy.

## Get started

Sign in with GitHub's device flow:

```bash
omnipolymath models auth login-github-copilot
```

Then browse models with `omnipolymath models list --provider github-copilot` and
select one for your agent. Enterprise accounts can use the dedicated Enterprise
login option.

This is the model provider; the separate Copilot SDK harness plugin runs native
Copilot agent sessions. See the [GitHub Copilot guide](https://omnipolymath.vercel.app/docs/providers/github-copilot)
for both options and account requirements.
