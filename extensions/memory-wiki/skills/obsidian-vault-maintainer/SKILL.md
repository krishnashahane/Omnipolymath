---
name: obsidian-vault-maintainer
description: Maintain an Obsidian-friendly memory wiki vault with wikilinks, frontmatter, and official Obsidian CLI awareness.
---

Use this skill when the memory-wiki vault render mode is `obsidian` or the user wants the wiki to play nicely with Obsidian.

- Start from `omnipolymath wiki status` to confirm the vault mode and whether the official Obsidian CLI is available.
- Use `omnipolymath wiki obsidian status` before shelling out, then prefer the dedicated helpers like `omnipolymath wiki obsidian search`, `omnipolymath wiki obsidian open`, `omnipolymath wiki obsidian command`, and `omnipolymath wiki obsidian daily`.
- Prefer `[[Wikilinks]]`, stable filenames, and frontmatter that works with Obsidian dashboards and Dataview-style queries.
- Keep generated sections repeatable so Obsidian users can safely add handwritten notes around them.
- If the official Obsidian CLI is enabled, check that it works before depending on it. Do not assume the app is installed, running, or configured.
- Pair renames with link repair.
