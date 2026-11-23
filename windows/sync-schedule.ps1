# 依 data/schedule.json，在 Windows「工作排程器」建立／更新／刪除「公布時段」自動更新排程
# 並確保「補跑」排程存在（電腦醒來或登入時，若超過 18 小時沒完整更新就補跑一次）
# 由 update.ps1 在每次更新後自動呼叫；也可以手動執行：
#   powershell -ExecutionPolicy Bypass -File windows\sync-schedule.ps1 [-DryRun]
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$prefix = 'tw-cinema 公布 '
$catchup = 'tw-cinema 補跑（醒來或登入時）'
$ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$update = Join-Path $PSScriptRoot 'update.ps1'
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew

function Get-Sig([string]$s) {
  $sha = [System.Security.Cryptography.SHA1]::Create()
  'tw-sig:' + ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($s))) -replace '-', '').Substring(0, 16)
}
function Say($m) { Write-Host $m }

# 排程內容沒變就不重建（也避免重建到正在執行的任務）
function Set-TwTask($name, $triggers, $argument, $sig) {
  $old = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($old -and $old.Description -eq $sig) { return 'same' }
  if ($old -and $old.State -eq 'Running') { return 'busy' }
  if ($DryRun) { return 'would-register' }
  $action = New-ScheduledTaskAction -Execute $ps -Argument $argument -WorkingDirectory $repo
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description $sig -Force | Out-Null
  return $(if ($old) { 'updated' } else { 'created' })
}

# ---------- 1) 公布時段排程 ----------
$file = Join-Path $repo 'data\schedule.json'
$plan = if (Test-Path $file) { Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{ tasks = @() } }
$now = Get-Date
$wanted = @{}
foreach ($t in $plan.tasks) {
  $name = $t.name -replace '^公布 ', $prefix
  $triggers = @(); $parts = @()
  foreach ($tr in $t.triggers) {
    foreach ($o in $tr.offsets) {
      if ($tr.kind -eq 'once') {
        $at = [datetime]::ParseExact($tr.at, 'yyyy-MM-ddTHH:mm', $null).AddMinutes($o)
        if ($at -le $now.AddMinutes(1)) { continue }
        $triggers += New-ScheduledTaskTrigger -Once -At $at
        $parts += "once$($at.ToString('s'))"
      } else {
        $base = [datetime]::ParseExact($tr.time, 'HH:mm', $null)
        $at = $base.AddMinutes($o)
        if ($at.Date -ne $base.Date) { $at = $base.Date.AddHours(23).AddMinutes(59) }  # 跨午夜就卡在 23:59
        if ($tr.kind -eq 'weekly') {
          $triggers += New-ScheduledTaskTrigger -Weekly -DaysOfWeek ([System.DayOfWeek][int]$tr.dow) -At $at
          $parts += "w$($tr.dow)$($at.ToString('HHmm'))"
        } else {
          $triggers += New-ScheduledTaskTrigger -Daily -At $at
          $parts += "d$($at.ToString('HHmm'))"
        }
      }
    }
  }
  if (-not $triggers.Count) { continue }
  $only = @($t.chains) -join ','
  $arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$update`"" + $(if ($only) { " -Only `"$only`"" } else { '' })
  $wanted[$name] = $true
  $r = Set-TwTask $name $triggers $arg (Get-Sig ("$only|" + ($parts -join ',')))
  Say "  [$r] $name（$($triggers.Count) 個觸發時間：$($parts -join ' ')）"
}
# 刪掉已經不需要的（例如過期的單次公告）
foreach ($old in Get-ScheduledTask -TaskName "$prefix*" -ErrorAction SilentlyContinue) {
  if (-not $wanted.ContainsKey($old.TaskName) -and $old.State -ne 'Running') {
    if (-not $DryRun) { Unregister-ScheduledTask -TaskName $old.TaskName -Confirm:$false }
    Say "  [removed] $($old.TaskName)"
  }
}

# ---------- 2) 補跑排程：登入時、從睡眠醒來時 ----------
$logon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$logon.Delay = 'PT2M'
$cls = Get-CimClass -Namespace 'Root/Microsoft/Windows/TaskScheduler' -ClassName 'MSFT_TaskEventTrigger'
$wake = New-CimInstance -CimClass $cls -ClientOnly
$wake.Enabled = $true
$wake.Delay = 'PT2M'
$wake.Subscription = "<QueryList><Query Id=`"0`" Path=`"System`"><Select Path=`"System`">*[System[Provider[@Name='Microsoft-Windows-Power-Troubleshooter'] and EventID=1]]</Select></Query></QueryList>"
$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$update`" -IfStale 18"
$r = Set-TwTask $catchup @($logon, $wake) $arg (Get-Sig 'catchup|logon+resume|18')
Say "  [$r] $catchup"
