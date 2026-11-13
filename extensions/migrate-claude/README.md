# Claude Migration

Bring Claude Code and Claude Desktop instructions, MCP servers, and skills into
Omnipolymath. The migration provider discovers supported local state and shows a
plan before applying changes.

## Get started

Preview the import:

```bash
omnipolymath migrate claude --dry-run
```

Use `--from <path>` to choose a Claude home or project. After reviewing the plan,
run `omnipolymath migrate apply claude` and follow the prompts. Apply backs up
existing Omnipolymath state; target conflicts require an explicit decision.

Hooks, broad permission settings, and opaque credential state are not activated
automatically. Review archive-only items separately.

See [Migrating from Claude](https://omnipolymath.vercel.app/docs/install/migrating-claude) for
import coverage, conflicts, and post-import verification.
