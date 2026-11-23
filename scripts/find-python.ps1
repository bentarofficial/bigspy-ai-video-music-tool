# Tim Python that, bo qua Windows Store alias (python.exe trong WindowsApps).
$candidates = @()
if ($env:AI_MUSIC_VIDEO_PYTHON) { $candidates += $env:AI_MUSIC_VIDEO_PYTHON }
$localPython = Join-Path $env:LOCALAPPDATA 'Programs\Python'
if (Test-Path $localPython) {
    $candidates += Get-ChildItem $localPython -Directory -Filter 'Python*' |
        Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'python.exe' }
}
$candidates += Get-Command python -All -CommandType Application -ErrorAction SilentlyContinue |
    ForEach-Object Source

foreach ($candidate in $candidates) {
    if (-not $candidate -or $candidate -like '*\Microsoft\WindowsApps\*' -or
        -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    $major = & $candidate -c 'import sys; print(sys.version_info.major)' 2>$null
    if ($LASTEXITCODE -eq 0 -and $major -eq '3') { return $candidate }
}
throw 'Khong tim thay Python 3. Cai Python tai python.org hoac dat AI_MUSIC_VIDEO_PYTHON.'
