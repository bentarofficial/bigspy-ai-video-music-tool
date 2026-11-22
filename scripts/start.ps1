# Khởi động server ẩn rồi mở giao diện trong cửa sổ ứng dụng riêng (Edge/Chrome --app).
# Đóng cửa sổ -> dừng server (nếu chính lần chạy này khởi động server).
# -Browser: mở tab trình duyệt thường (dùng cho start.bat khi chạy từ mã nguồn).
# -NoWindow: chỉ chạy server (dùng khi tự cập nhật, cửa sổ cũ tự tải lại).
param([switch]$Browser, [switch]$NoWindow)
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$port = 8790
$url = "http://127.0.0.1:$port"
$pidFile = Join-Path $root '.server.pid'
New-Item -ItemType Directory -Force (Join-Path $root 'logs') | Out-Null

$running = $false
if (Test-Path $pidFile) {
    $old = Get-Process -Id ([int](Get-Content $pidFile)) -ErrorAction SilentlyContinue
    if ($old) { $running = $true }
}

if (-not $running) {
    $env:PYTHONIOENCODING = 'utf-8'
    $proc = Start-Process -FilePath 'python' `
        -ArgumentList '-m', 'uvicorn', 'server.app:app', '--host', '127.0.0.1', '--port', "$port" `
        -WorkingDirectory $root -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $root 'logs\server.log') `
        -RedirectStandardError (Join-Path $root 'logs\server.err.log')
    $proc.Id | Out-File -Encoding ascii $pidFile
    for ($i = 0; $i -lt 40; $i++) {
        try { Invoke-WebRequest "$url/api/health" -UseBasicParsing -TimeoutSec 1 | Out-Null; break }
        catch { Start-Sleep -Milliseconds 500 }
    }
}
if ($NoWindow) { exit }
# Lưu ý: PowerShell không phân biệt hoa/thường -> không đặt tên trùng tham số $Browser.
$appExe = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($Browser -or -not $appExe) { Start-Process $url; exit }

# Hồ sơ riêng: cửa sổ không lẫn với trình duyệt thường, và tiến trình sống đến khi đóng cửa sổ.
$profileDir = Join-Path $env:LOCALAPPDATA 'AIMusicVideo\window'
$app = Start-Process -FilePath $appExe -PassThru -ArgumentList @(
    "--app=$url", "--user-data-dir=`"$profileDir`"", '--no-first-run',
    '--no-default-browser-check', '--window-size=1500,920',
    '--force-dark-mode'  # thanh tiêu đề tối, khớp màu giao diện
)
if (-not $running) {
    $t0 = Get-Date
    $app.WaitForExit()
    # Thoát ngay = Edge chuyển cửa sổ cho tiến trình đang mở sẵn -> không phải người dùng đóng app.
    if (((Get-Date) - $t0).TotalSeconds -gt 5) { & (Join-Path $PSScriptRoot 'stop.ps1') | Out-Null }
}
