# Omnipolymath on Windows: https://omnipolymath.vercel.app/install.ps1
#
# Omnipolymath runs on Windows through WSL2. This script checks for WSL and
# prints the exact next steps. It does not change your system.

$ErrorActionPreference = "Stop"

Write-Host "Omnipolymath installer for Windows" -ForegroundColor White

$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wsl) {
  Write-Host ""
  Write-Host "WSL2 is not installed. Open PowerShell as Administrator and run:" -ForegroundColor Yellow
  Write-Host "  wsl --install"
  Write-Host "Restart, open the Ubuntu app, then run:"
  Write-Host "  curl -fsSL https://omnipolymath.vercel.app/install.sh | bash"
  exit 1
}

Write-Host ""
Write-Host "WSL is available. Open your Linux distribution (for example: wsl) and run:" -ForegroundColor Green
Write-Host "  curl -fsSL https://omnipolymath.vercel.app/install.sh | bash"
Write-Host ""
Write-Host "Guide: https://omnipolymath.vercel.app/docs/platforms/windows"
