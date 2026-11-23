# Cai thu vien Python + Node lan dau, va lai khi requirements.txt / package.json doi (sau khi cap nhat).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$files = 'requirements.txt', 'remotion\package.json'
$hash = ($files | ForEach-Object { (Get-FileHash $_ -Algorithm SHA256).Hash }) -join ''
$marker = Join-Path $root '.deps.hash'
if ((Test-Path $marker) -and ((Get-Content $marker -Raw).Trim() -eq $hash) -and (Test-Path 'remotion\node_modules')) { exit 0 }

try { $pythonExe = & (Join-Path $PSScriptRoot 'find-python.ps1') }
catch { Write-Host $_ -ForegroundColor Red; Read-Host 'Nhan Enter de thoat'; exit 1 }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host 'Thieu Node.js 18+ (https://nodejs.org). Cai dat roi mo lai tool.' -ForegroundColor Red
    Read-Host 'Nhan Enter de thoat'; exit 1
}
Write-Host '== Dang cai thu vien Python (lan dau co the mat vai phut) ==' -ForegroundColor Cyan
& $pythonExe -m pip install --disable-pip-version-check -r requirements.txt
if ($LASTEXITCODE) { Read-Host 'Cai Python loi. Nhan Enter de thoat'; exit 1 }
Write-Host '== Dang cai Remotion (npm install) ==' -ForegroundColor Cyan
Push-Location remotion; npm install --no-audit --no-fund; $rc = $LASTEXITCODE; Pop-Location
if ($rc) { Read-Host 'npm install loi. Nhan Enter de thoat'; exit 1 }
if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env' }
$hash | Out-File -Encoding ascii $marker
exit 0
