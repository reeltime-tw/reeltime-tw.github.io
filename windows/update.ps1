# 全台電影場次：由「工作排程器」執行
# 抓取各影城場次 -> 推上 GitHub -> GitHub 自動發布網站
# 參數：
#   -Only "美麗新,樂聲"   只更新指定連鎖（公布時間到了才去抓，比完整更新快很多）
#   -IfStale 18          距離上次「完整更新」超過 18 小時才執行（電腦醒來／登入時的補跑用）
param(
  [string]$Only = '',
  [double]$IfStale = 0
)
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$log = Join-Path $PSScriptRoot 'update.log'
$stampFile = Join-Path $PSScriptRoot 'last-full-success.txt'

# 同一時間只讓一個更新在跑（公布時段的排程可能和每日更新撞在一起），後到的最多等 20 分鐘
$mutex = New-Object System.Threading.Mutex($false, 'tw-cinema-update')
$got = $false
try { $got = $mutex.WaitOne([TimeSpan]::FromMinutes(20)) } catch [System.Threading.AbandonedMutexException] { $got = $true }
if (-not $got) { exit 0 }

try {
  # 補跑判斷：最近才完整更新過就不用再跑
  if ($IfStale -gt 0 -and (Test-Path $stampFile)) {
    try {
      $last = [datetime]::Parse((Get-Content $stampFile -Raw).Trim())
      if (((Get-Date) - $last).TotalHours -lt $IfStale) { exit 0 }
    } catch { }
  }

  if ((Test-Path $log) -and (Get-Item $log).Length -gt 2MB) { Remove-Item $log }
  Start-Transcript -Path $log -Append | Out-Null
  Write-Host "==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $(if ($Only) { '只更新：' + $Only } else { '完整更新' }) $(if ($IfStale -gt 0) { '（補跑檢查）' }) ===="

  # 更新期間不讓電腦睡著（被排程喚醒時 Windows 預設約 2 分鐘就會再睡）
  Add-Type -Namespace TwCinema -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
  [TwCinema.Power]::SetThreadExecutionState([uint32]'0x80000001') | Out-Null

  # 剛喚醒時網路可能還沒連上，最多等 3 分鐘
  for ($i = 0; $i -lt 36; $i++) {
    try { Invoke-WebRequest 'https://github.com' -Method Head -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch { Start-Sleep 5 }
  }

  git pull --rebase --autostash
  $lock = Join-Path $repo 'package-lock.json'
  $stamp = Join-Path $repo 'node_modules\.package-lock.json'
  if (-not (Test-Path $stamp) -or (Get-Item $lock).LastWriteTime -gt (Get-Item $stamp).LastWriteTime) { npm ci --no-audit --no-fund }

  $chains = @()
  if ($Only) { $chains = @($Only -split '[,，]' | Where-Object { $_ }) }

  node scrape/index.mjs @chains
  if ($LASTEXITCODE -ne 0) { Write-Host '!! 所有影城都抓取失敗，這次不上傳' ; exit 1 }

  # 公告爬蟲：讀官網公告找「何時公布場次」，再算出自動排程（失敗不影響這次更新）
  try { node scrape/announce.mjs @chains; node scrape/schedule.mjs } catch { Write-Host "!! 公告爬蟲失敗：$($_.Exception.Message)" }

  git add -f -A docs/data.json docs/raw docs/posters data
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    git commit -m ("update showtimes " + (Get-Date -Format 'yyyy-MM-dd HH:mm') + $(if ($Only) { ' (partial)' } else { '' }))
    git push
  } else { Write-Host '資料沒有變化' }

  if (-not $Only) { (Get-Date).ToString('o') | Set-Content -Path $stampFile }

  # 推播：比對各手機追蹤的電影有沒有新場次，有就送通知（失敗不影響這次更新）
  try { node scrape/push.mjs } catch { Write-Host "!! 推播失敗：$($_.Exception.Message)" }

  # 依最新的 data/schedule.json 同步 Windows 排程（失敗不影響這次更新）
  try { & (Join-Path $PSScriptRoot 'sync-schedule.ps1') } catch { Write-Host "!! 同步排程失敗：$($_.Exception.Message)" }
}
finally {
  try { [TwCinema.Power]::SetThreadExecutionState([uint32]'0x80000000') | Out-Null } catch { }
  try { Stop-Transcript | Out-Null } catch { }
  $mutex.ReleaseMutex()
}
