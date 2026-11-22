# Khởi động server ẩn rồi mở giao diện trong cửa sổ ứng dụng riêng (Edge/Chrome --app).
# Đóng cửa sổ -> dừng server (nếu chính lần chạy này khởi động server).
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
$browser = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $browser) { Start-Process $url; exit }

# Hồ sơ riêng: cửa sổ không lẫn với trình duyệt thường, và tiến trình sống đến khi đóng cửa sổ.
$profileDir = Join-Path $env:LOCALAPPDATA 'AIMusicVideo\window'
$app = Start-Process -FilePath $browser -PassThru -ArgumentList @(
    "--app=$url", "--user-data-dir=`"$profileDir`"", '--no-first-run',
    '--no-default-browser-check', '--window-size=1500,920'
)
if (-not $running) {
    $app.WaitForExit()
    & (Join-Path $PSScriptRoot 'stop.ps1') | Out-Null
}
