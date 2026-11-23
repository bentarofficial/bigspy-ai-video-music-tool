# Goi sau khi tu cap nhat: dung rieng server, khong kill cay tien trinh chua chinh script nay.
$ErrorActionPreference = 'Stop'
Start-Sleep -Seconds 2
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root '.server.pid'
if (Test-Path $pidFile) {
    $serverPid = [int](Get-Content $pidFile | Select-Object -First 1)
    Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue
    Remove-Item $pidFile -Force
}
Start-Sleep -Seconds 1
& (Join-Path $PSScriptRoot 'setup.ps1') -Unattended
if ($LASTEXITCODE -ne 0) { throw 'Cai dat thu vien sau cap nhat that bai' }
# Cua so app van mo va tu tai lai trang -> chi chay server, khong mo cua so moi.
& (Join-Path $PSScriptRoot 'start.ps1') -NoWindow
