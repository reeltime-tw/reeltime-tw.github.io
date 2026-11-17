# 全台電影場次：Windows 一次性設定
# 用法：開啟 PowerShell，貼上下面這行後按 Enter（會先下載再執行）
#   irm https://raw.githubusercontent.com/xinyolee827-tech/tw-cinema/main/windows/setup.ps1 -OutFile $env:TEMP\tw-setup.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\tw-setup.ps1
$ErrorActionPreference = 'Stop'
$RepoUrl = 'https://github.com/xinyolee827-tech/tw-cinema'
$Dir     = Join-Path $HOME 'tw-cinema'
$Task    = 'tw-cinema 每日更新場次'
$At      = '08:00'

function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }
function Need($cmd, $id, $name) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "→ 安裝 $name ..." -ForegroundColor Cyan
    winget install --id $id -e --accept-source-agreements --accept-package-agreements
    Refresh-Path
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$name 安裝後仍找不到，請關掉 PowerShell 重開後再執行一次這個設定。" }
  } else { Write-Host "✓ 已有 $name" -ForegroundColor Green }
}

Write-Host "`n=== 全台電影場次：電腦端設定 ===`n" -ForegroundColor Yellow
Need git  'Git.Git'           'Git'
Need node 'OpenJS.NodeJS.LTS' 'Node.js'

if (-not (Test-Path (Join-Path $Dir '.git'))) {
  Write-Host "→ 下載專案到 $Dir" -ForegroundColor Cyan
  git clone $RepoUrl $Dir
} else { Write-Host "✓ 專案已在 $Dir" -ForegroundColor Green; git -C $Dir pull --rebase --autostash }
git -C $Dir config user.name  'tw-cinema-bot'
git -C $Dir config user.email 'tw-cinema-bot@users.noreply.github.com'
Push-Location $Dir; npm ci --no-audit --no-fund; Pop-Location

Write-Host "→ 建立排程：每天 $At 自動喚醒電腦並更新" -ForegroundColor Cyan
$ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action   = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Dir\windows\update.ps1`"" -WorkingDirectory $Dir
$trigger  = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "→ 開啟電源計畫的「允許喚醒計時器」" -ForegroundColor Cyan
powercfg /SETACVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1
powercfg /SETDCVALUEINDEX SCHEME_CURRENT SUB_SLEEP RTCWAKE 1
powercfg /SETACTIVE SCHEME_CURRENT

Write-Host "`n→ 現在先跑一次。如果跳出 GitHub 登入視窗，請登入並授權（只需要這一次）。`n" -ForegroundColor Cyan
& $ps -NoProfile -ExecutionPolicy Bypass -File "$Dir\windows\update.ps1"
Get-Content "$Dir\windows\update.log" -Tail 25

Write-Host "`n=== 完成 ===" -ForegroundColor Yellow
Write-Host "每天 $At 電腦會自動醒來更新場次（電腦要「睡眠」，不能「關機」）。"
Write-Host "執行紀錄：$Dir\windows\update.log"
Write-Host "想改時間：打開「工作排程器」，找「$Task」。"
