# Khởi động server ẩn (không cửa sổ) rồi mở trình duyệt.
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
Start-Process $url
