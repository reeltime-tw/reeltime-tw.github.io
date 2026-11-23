# 全台電影場次

自動抓取台灣各影城官網的場次，整理成一個手機好用的網頁 App：

- 首頁分「上映中」「即將上映」，附電影海報
- 可依日期、地區（北／中／南／東／離島）、時段、影城品牌篩選
- 每間影城標示「已公布到哪天」「下次公布時間」「將公布哪段日期」
  - 美麗華讀取官方「開放場次訂票時間」公告；其他家依已公布日期推估，畫面上會標「推估」
- 選定場次後連到官網訂票（秀泰、威秀、新光、美麗華可直達該場次）

## 目前支援

| 影城 | 狀態 | 訂票連結 |
|---|---|---|
| 秀泰 | ✅ | 直達場次 |
| 威秀（含 IMAX、GOLD CLASS、MUCROWN、4DX 等） | ✅ | 直達場次 |
| 新光 | ✅ | 直達場次 |
| 美麗華大直 | ✅ | 直達場次 |
| 樂聲（西門町） | ✅ | 直達場次；官方規則「前一天 20:00 前公布」 |
| 喜樂時代 | ✅ | 該分店場次頁 |
| 國賓（含國賓大戲院） | ✅ | 國賓訂票首頁 |
| 美麗新（台茂、大直皇家） | ✅ | 場次表頁（官網無單場連結；宏匯店已停業） |
| in89（桃園、豐原、嘉義、駁二、大立、澎湖） | ✅ | 該據點訂票頁（台中大里官網尚無線上場次） |
| 光點、誠品、南投戲院 | 官網沒有可讀取的線上場次 | |

## 運作方式

你的 Windows 電腦每天早上 8:00 由「工作排程器」自動喚醒，執行 `windows/update.ps1`：
抓取各影城場次 → 產生 `docs/data.json` → 推上 GitHub → GitHub Actions 自動發布到 GitHub Pages。

改在自己電腦抓，是因為威秀、新光會擋國外主機（GitHub 的伺服器在美國）。
某一家官網暫時連不上時，會沿用該影城上一次成功抓到的資料。

## 電腦端設定（只需一次）

開啟 PowerShell（不用系統管理員），貼上這行後按 Enter：

```powershell
irm https://raw.githubusercontent.com/reeltime-tw/reeltime-tw.github.io/main/windows/setup.ps1 -OutFile $env:TEMP\tw-setup.ps1; powershell -ExecutionPolicy Bypass -File $env:TEMP\tw-setup.ps1
```

它會：安裝 Git 與 Node.js（如果還沒有）→ 把專案下載到 `%USERPROFILE%\tw-cinema` → 建立每天 8:00 的排程（可喚醒電腦）→ 開啟電源計畫的「允許喚醒計時器」→ 立刻跑一次（第一次會請你登入 GitHub）。

- 電腦要「睡眠」而不是「關機」，才能被叫醒
- 執行紀錄在 `%USERPROFILE%\tw-cinema\windows\update.log`
- 想改時間：開「工作排程器」找「tw-cinema 每日更新場次」

## 本機測試

```bash
npm install
npm run scrape            # 抓全部
node scrape/index.mjs 秀泰  # 只抓某一家，其餘沿用上次資料
cd docs && python3 -m http.server   # 開 http://localhost:8000
```

## 新增影城

在 `scrape/chains/` 新增一個檔案，匯出 `chain`、`site` 與 `scrape()`，回傳：

```js
{
  cinemas: [{ id, name, city, region, addr, site, ticketUrl?, publish? }],
  movies:  [{ key, title, en, poster, runtime, rating, genre, release, synopsis }],
  shows:   [{ cinema, movieKey, date: 'YYYY-MM-DD', time: 'HH:mm', format, hall, url, seatsLeft? }]
}
```

再到 `scrape/index.mjs` 的 `CHAINS` 加上它。不同影城的同一部片會依片名自動合併。
