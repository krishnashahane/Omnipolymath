---
summary: "CLI reference for `omnipolymath completion` (generate/install shell completion scripts)"
read_when:
  - You want shell completions for zsh/bash/fish/PowerShell
  - You need to cache completion scripts under Omnipolymath state
title: "Completion"
---

# `omnipolymath completion`

Generate shell completion scripts, cache them under Omnipolymath state, and optionally install them into your shell profile.

## Usage

```bash
omnipolymath completion                          # print the detected shell's script
omnipolymath completion --shell fish             # print fish script
omnipolymath completion --write-state            # cache scripts for all shells
omnipolymath completion --write-state --install  # cache, then install in one step
omnipolymath completion --shell bash --write-state
```

## Options

- `-s, --shell <shell>`: shell target, one of `zsh`, `bash`, `powershell`, or `fish`. Detected from `$SHELL`, otherwise PowerShell on Windows and zsh elsewhere.
- `-i, --install`: install completion by adding a source line for the cached script to your shell profile
- `--write-state`: write completion script(s) to `$OMNIPOLYMATH_STATE_DIR/completions` (default `~/.omnipolymath/completions`) without printing to stdout. With `--shell` it writes only that shell, otherwise all four.
- `-y, --yes`: skip install confirmation prompts (non-interactive)

## Install flow

`--install` points your profile at the cached script, so the cache must exist first. If the cache is missing, the command fails and tells you to run `omnipolymath completion --write-state`. Combine `--write-state --install` to do both in one step. Without `--shell`, the command preserves a recognized `$SHELL`. When `$SHELL` is missing or unrecognized, it defaults to PowerShell on Windows and zsh elsewhere.

The install writes a small `# Omnipolymath Completion` block into your shell profile and replaces any older slow `source <(omnipolymath completion ...)` lines with the cached source line:

| Shell      | Profile                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| bash       | `~/.bashrc` (falls back to `~/.bash_profile` when `~/.bashrc` is missing)                                                                                                                  |
| fish       | `~/.config/fish/config.fish`                                                                                                                                                               |
| powershell | `~/.config/powershell/Microsoft.PowerShell_profile.ps1` (on Windows: `Documents/PowerShell/Microsoft.PowerShell_profile.ps1`, or `Documents/WindowsPowerShell/...` for Windows PowerShell) |
| zsh        | `$ZDOTDIR/.zshrc` when `ZDOTDIR` is defined; otherwise `~/.zshrc` (an empty `ZDOTDIR` resolves to `/.zshrc`)                                                                               |

On macOS and Linux, PowerShell uses `$XDG_CONFIG_HOME/powershell/Microsoft.PowerShell_profile.ps1` when `XDG_CONFIG_HOME` is nonempty, falling back to the path above otherwise.

Profile changes are staged beside the destination and atomically replace it only after a complete durable write. A failed install leaves an existing profile unchanged.
Profiles must be regular files; symlinks to regular files are supported. Pipes and
other special files are rejected before reading, so completion does not wait for a writer.

Installed source lines preserve literal cache paths, including spaces, quotes, dollar signs, and backslashes. Reinstalling replaces Omnipolymath's previous source line after the state directory changes. On Windows, PowerShell profiles and cached scripts containing non-ASCII text declare UTF-8 with a BOM so Windows PowerShell can read Unicode paths and completion values. Existing UTF-16 PowerShell profiles retain their encoding on all platforms.

Installation messages display control characters in profile paths as visible escapes. If the reload command would contain terminal controls, the installer tells you to restart your shell instead; the installed profile still uses the literal path.

A user-managed portable hook for the same cached script (for example `[[ -f "${HOME}/.omnipolymath/completions/omnipolymath.bash" ]] && source "${HOME}/.omnipolymath/completions/omnipolymath.bash"`, as a dotfile manager would write) is recognized as completion being configured. Doctor and `completion --install` leave such managed lines byte-for-byte untouched instead of appending a duplicate literal-path block.

## Permission failures

If Doctor or onboarding cannot update your shell profile, completion remains
optional and setup continues. When a cache is available, the warning includes a
command to load that cache in your current matching shell session. Run the complete
command as printed. This does not install completion for future shell sessions.

For persistent installation, resolve the reported permission or read-only error
before retrying `omnipolymath completion --install`. The failure location may be a
staging directory or a symlink target, not the profile itself. Atomic replacement
also needs write access to the destination directory. The installer uses the
profile selected in the table above. It has no profile-file destination option.

## Notes

- Without `--install` or `--write-state`, the command prints the script to stdout.
- Completion generation eagerly loads the full command tree, including plugin CLI commands, so nested subcommands are included.
- If invalid configuration prevents plugin discovery, generation warns and still includes core commands. Repair the configuration and regenerate to include plugin commands.
- Bash completion supports both `--flag value` and `--flag=value`, including named profiles before nested commands and single-quoted, double-quoted, or backslash-escaped value prefixes.
- Zsh completion supports both `--flag value` and `--flag=value`. Commands with hyphens or underscores, nested command paths, and aliases retain their own option completions. Regenerate cached scripts with `omnipolymath completion --shell zsh --write-state` after upgrading.
- After an option terminator (`--`), Bash completes command names but does not suggest options or option values.
- PowerShell completes commands and option values at the cursor, including when later arguments are already present.
- `omnipolymath update` refreshes the core completion cache automatically without loading plugin CLI commands. Run `omnipolymath completion --write-state` to include plugin commands. `omnipolymath doctor` can repair missing or stale completion setups.

## Related

- [CLI reference](/cli)
