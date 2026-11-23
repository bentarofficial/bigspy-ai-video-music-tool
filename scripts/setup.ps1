# Cai thu vien Python + Node lan dau, va lai khi requirements.txt / package.json doi (sau khi cap nhat).
param([switch]$Unattended)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
try { $pythonExe = & (Join-Path $PSScriptRoot 'find-python.ps1') }
catch { Write-Host $_ -ForegroundColor Red; if (-not $Unattended) { Read-Host 'Nhan Enter de thoat' }; exit 1 }
$hash = & $pythonExe -c "import hashlib, pathlib; print(''.join(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest().upper() for p in ('requirements.txt', 'remotion/package.json')))"
if ($LASTEXITCODE -ne 0) { exit 1 }
$marker = Join-Path $root '.deps.hash'
if ((Test-Path $marker) -and ((Get-Content $marker -Raw).Trim() -eq $hash) -and (Test-Path 'remotion\node_modules')) { exit 0 }

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host 'Thieu Node.js 18+ (https://nodejs.org). Cai dat roi mo lai tool.' -ForegroundColor Red
    if (-not $Unattended) { Read-Host 'Nhan Enter de thoat' }; exit 1
}
Write-Host '== Dang cai thu vien Python (lan dau co the mat vai phut) ==' -ForegroundColor Cyan
& $pythonExe -m pip install --disable-pip-version-check -r requirements.txt
if ($LASTEXITCODE) { if (-not $Unattended) { Read-Host 'Cai Python loi. Nhan Enter de thoat' }; exit 1 }
Write-Host '== Dang cai Remotion (npm install) ==' -ForegroundColor Cyan
Push-Location remotion; npm install --no-audit --no-fund; $rc = $LASTEXITCODE; Pop-Location
if ($rc) { if (-not $Unattended) { Read-Host 'npm install loi. Nhan Enter de thoat' }; exit 1 }
if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env' }
$hash | Out-File -Encoding ascii $marker
exit 0
