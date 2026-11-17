# 全台電影場次：每天由「工作排程器」執行
# 抓取各影城場次 -> 推上 GitHub -> GitHub 自動發布網站
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$log = Join-Path $PSScriptRoot 'update.log'
if ((Test-Path $log) -and (Get-Item $log).Length -gt 2MB) { Remove-Item $log }
Start-Transcript -Path $log -Append | Out-Null
Write-Host "==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===="

# 更新期間不讓電腦睡著（被排程喚醒時 Windows 預設約 2 分鐘就會再睡）
Add-Type -Namespace TwCinema -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
[TwCinema.Power]::SetThreadExecutionState([uint32]'0x80000001') | Out-Null

try {
  # 剛喚醒時網路可能還沒連上，最多等 3 分鐘
  for ($i = 0; $i -lt 36; $i++) {
    try { Invoke-WebRequest 'https://github.com' -Method Head -UseBasicParsing -TimeoutSec 5 | Out-Null; break } catch { Start-Sleep 5 }
  }

  git pull --rebase --autostash
  $lock = Join-Path $repo 'package-lock.json'
  $stamp = Join-Path $repo 'node_modules\.package-lock.json'
  if (-not (Test-Path $stamp) -or (Get-Item $lock).LastWriteTime -gt (Get-Item $stamp).LastWriteTime) { npm ci --no-audit --no-fund }

  node scrape/index.mjs
  if ($LASTEXITCODE -ne 0) { Write-Host '!! 所有影城都抓取失敗，這次不上傳' ; exit 1 }

  git add -f docs/data.json docs/raw
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    git commit -m ("update showtimes " + (Get-Date -Format 'yyyy-MM-dd HH:mm'))
    git push
  } else { Write-Host '資料沒有變化' }
}
finally {
  [TwCinema.Power]::SetThreadExecutionState([uint32]'0x80000000') | Out-Null
  Stop-Transcript | Out-Null
}
