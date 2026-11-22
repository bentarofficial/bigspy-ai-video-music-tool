# Goi sau khi tu cap nhat: dung server, cai lai thu vien neu can, khoi dong lai.
Start-Sleep -Seconds 2
& (Join-Path $PSScriptRoot 'stop.ps1')
Start-Sleep -Seconds 1
& (Join-Path $PSScriptRoot 'setup.ps1')
# Cua so app van mo va tu tai lai trang -> chi chay server, khong mo cua so moi.
& (Join-Path $PSScriptRoot 'start.ps1') -NoWindow
