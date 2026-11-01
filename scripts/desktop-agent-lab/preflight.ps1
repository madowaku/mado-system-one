# MSO-DM-M0.8: observation-only Windows PowerShell preflight.
# No installation, OS input, application launch, or data collection.
$ErrorActionPreference = 'Stop'
Write-Host 'MSO-DM-M0.8: observation-only preflight'
if ($env:OS -ne 'Windows_NT') {
  Write-Warning 'This experiment targets Windows. Stop here.'
  exit 2
}
$cmd = Get-Command 'agent-desktop' -ErrorAction SilentlyContinue
if (-not $cmd) {
  Write-Warning 'agent-desktop is not installed or not on PATH. Review upstream README before manual installation.'
  exit 1
}
Write-Host 'Found agent-desktop on PATH.'
& agent-desktop version
if ($LASTEXITCODE -ne 0) { throw 'agent-desktop version failed; stop.' }
Write-Host ''
Write-Host 'Next observation-only commands (run manually after reviewing privacy):'
Write-Host '  agent-desktop status'
Write-Host '  agent-desktop skills get desktop'
Write-Host '  agent-desktop skills get platform'
Write-Host '  agent-desktop list-apps'
Write-Host '  agent-desktop snapshot --app Notepad -i'
Write-Host ''
Write-Host 'Do NOT commit raw snapshots or screenshots. No UI actions are authorized by this script.'
