# Dung server, Remotion Studio va moi tien trinh con (render, whisper...) cua AI Music Video Tool.
$root = Split-Path -Parent $PSScriptRoot
foreach ($f in '.server.pid', '.studio.pid') {
    $path = Join-Path $root $f
    if (Test-Path $path) {
        $id = (Get-Content $path | Select-Object -First 1).Trim()
        if ($id) { taskkill /PID $id /T /F 2>$null | Out-Null }
        Remove-Item $path -Force
    }
}
# Phong truong hop mat file pid: chi dung tien trinh cua CHINH tool nay (kiem tra dong lenh),
# khong dung ung dung khac dang dung cong.
$mine = @{ 8790 = 'server.app:app'; 3010 = 'remotion' }
foreach ($port in $mine.Keys) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)").CommandLine
        if ($cmd -and $cmd -like "*$($mine[$port])*") { taskkill /PID $_.OwningProcess /T /F 2>$null | Out-Null }
    }
}
Write-Host 'Da dung AI Music Video Tool.'
