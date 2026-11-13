// Agent Workspace script supports Omnipolymath repository automation.
export function posixAgentWorkspaceScript(purpose: string): string {
  return `set -eu
workspace="\${OMNIPOLYMATH_WORKSPACE_DIR:-$HOME/.omnipolymath/workspace}"
mkdir -p "$workspace/.omnipolymath"
cat > "$workspace/IDENTITY.md" <<'IDENTITY_EOF'
# Identity

- Name: Omnipolymath
- Purpose: ${purpose}
IDENTITY_EOF
rm -f "$workspace/BOOTSTRAP.md"`;
}

export function windowsAgentWorkspaceScript(purpose: string): string {
  return `$workspace = $env:OMNIPOLYMATH_WORKSPACE_DIR
if (-not $workspace) { $workspace = Join-Path $env:USERPROFILE '.omnipolymath\\workspace' }
$stateDir = Join-Path $workspace '.omnipolymath'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
@'
# Identity

- Name: Omnipolymath
- Purpose: ${purpose}
'@ | Set-Content -Path (Join-Path $workspace 'IDENTITY.md') -Encoding UTF8
Remove-Item (Join-Path $workspace 'BOOTSTRAP.md') -Force -ErrorAction SilentlyContinue`;
}
