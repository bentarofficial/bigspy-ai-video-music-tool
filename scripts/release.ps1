# Phat hanh ban moi: .\scripts\release.ps1 1.0.1   -> GitHub Actions tu build Setup.exe + app-update.zip
param([Parameter(Mandatory)][string]$Version)
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Set-Content VERSION $Version -NoNewline
git add -A
git commit -m "Release v$Version"
git tag "v$Version"
git push origin HEAD "v$Version"
