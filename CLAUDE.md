# 全台電影場次 App — 交接說明

> 使用者：李心祐（GitHub：xinyolee827-tech）。**一律用繁體中文回覆**，包含程式註解與 commit 以外的所有說明。
> 使用者不是工程背景，說明要白話、給可直接貼上的指令。

## 這是什麼

自動抓取台灣各影城官網場次，整理成手機好用的網頁 App。

- 網站：https://xinyolee827-tech.github.io/tw-cinema/
- 專案：https://github.com/xinyolee827-tech/tw-cinema
- 功能需求（使用者原始要求）：
  - 首頁分「上映中」「即將上映」，**必須有電影海報**
  - 可依日期、地區選影城或時段
  - 每間影城註明**下次公布場次的時間**、**會公布哪段日期**
  - 選定場次後連到官網訂票

## 架構與資料流

```
使用者的 Windows 電腦（台灣網路）
  每天 08:00 工作排程器喚醒電腦 → windows/update.ps1
    → git pull → node scrape/index.mjs → docs/data.json
    → git commit + push
GitHub Actions（.github/workflows/update.yml「發布網站」）
  docs/** 有變動 → 發布 docs/ 到 GitHub Pages
```

**為什麼不用 GitHub Actions 直接抓**：第一次在 Actions 跑時，威秀回 HTTP 403、新光 fetch failed（擋國外 IP）。改由使用者電腦抓後全部正常。使用者也明確要求「一天抓一次就好」。

### 檔案

| 路徑 | 說明 |
|---|---|
| `scrape/index.mjs` | 主程式：依序跑各影城、合併、計算公布資訊、輸出 `docs/data.json`。`node scrape/index.mjs 秀泰` 可只跑一家 |
| `scrape/util.mjs` | fetch 重試、linkedom 解析、台北時區、分級/地區/片名正規化 |
| `scrape/chains/*.mjs` | 每家影城一個檔，匯出 `chain`、`site`、`scrape()` |
| `docs/index.html` | App（單檔 HTML/CSS/JS，讀 `data.json`；載入失敗時顯示示範資料） |
| `docs/data.json`、`docs/raw/*.json` | 由使用者電腦產生並提交。`raw/` 是各影城上次成功的原始資料（某家失敗時沿用） |
| `windows/setup.ps1` | 一次性設定：裝 Git/Node、clone 到 `%USERPROFILE%\tw-cinema`、建排程（WakeToRun）、開喚醒計時器、先跑一次 |
| `windows/update.ps1` | 每日執行；用 SetThreadExecutionState 防止執行中睡著；紀錄在 `windows/update.log` |
| `test/mock.mjs` | 用模擬回應跑完整流程（結構依實際官網觀察而寫） |
| `test/mock-fail.mjs` | 測試單一影城失敗時沿用舊資料 |
| `test/ui.py` | Playwright 截圖測 App |

**ps1 檔必須是 UTF-8 with BOM + CRLF**（Windows PowerShell 5.1 才讀得懂中文）。commit 訊息在 ps1 內用英文以避免編碼問題。

## 各影城資料來源（皆已在真實官網驗證過）

`chain` 順序 = 合併電影資訊時的優先順序（海報、簡介取第一個有值的）。

| 影城 | 來源 | 訂票連結 | 備註 |
|---|---|---|---|
| 秀泰 | `GET capi.showtimes.com.tw/4/app/bootstrap` 一次取得 programs / corporations / eventsForCorporations | `showtimes.com.tw/ticketing/cart/selectTicketTypes/{eventId}` 直達 | 最穩定，15 間 |
| 威秀 | `vsweb/film/index.aspx?p=N`、`coming.aspx?p=N` 列表；`detail.aspx?id=` 內含所有影城場次（`a[href^=#movieTime]` 對應 `div.movieTime > article#id`） | `vsTicketing/ticketing/booking.aspx?cinemacode&txtSessionId` 直達 | 27 間。**短時間連跑會被暫時拒絕**（02:17 成功、02:21 回 0 場），已降為並行 2 + 每頁 400ms |
| 國賓 | `home/MovieList?Type=1/2`；`home/MovieContent?MID=&DT=YYYY/MM/DD`，`.theater-box` | 只有 `booking.ambassador.com.tw` 首頁 | 每部片頁面的日期選單（`a[href*=DT=]`）列出有場次的日期，**含預售與特別場**，要照它逐日抓（之前從今天往後找、遇空就停，漏了一半） |
| 新光 | 首頁 `[data-action-url*=/Films/FP]`；`Films/FP?filmId&cinemaId&isNowShowing=True` | `.session-info[data-action-url]` → `/Booking/Booking?cinemaId&filmId&sessionId` 直達 | **首頁輪播那筆沒有 isNowShowing**，要以下方清單的標記為準（曾因此 0 場）。cinemaId 1001–1005 |
| 美麗華（大直） | `/timetable` 一頁全部 | `/Booking/TicketType?id&session` 直達 | **`/Home/startordertime` 官方公布時間公告**，解析成 publish（畫面顯示「官方公告」） |
| 美麗新（台茂 1004、大直皇家 1005） | `/Booking/Timetable` 內嵌 `var CinemaList = '{json}'` | 官網用表單 POST，無單場連結 → 連場次表頁 | 宏匯店 2025-12-22 停業。官網也有「開放場次訂票時間」選單但沒找到可讀頁面。海報路徑 `/MiramarApp/Resource/{PostUrl}_S.jpg` 為推斷 |
| 喜樂時代 | `Movie/GetTheaterList`、`Movie/GetMovieList/{site}`、**逐日** `Movie/GetMovieAlltime/{site}/{programid}/{date}`（回「查無資料」= 未公布） | 只能連 `book.html?sid=` | 4 間：Nangang/Beyond(永和)/Kaohsiung/Ximen(今日店) |
| in89 | 各據點 `in89cinemax.com/index.aspx?TheaterId=N` 有隱藏欄位 `theater_api`（如 `talee.in89.com.tw`）；`POST https://{host}/api/api_movie.php?method=getStagesByDate` 不需登入，回傳全部場次與電影 | 連據點頁 | TheaterId 1/18/15/17/2/16/14；**18 台中大里 theater_api 為空**，略過。海報 `https://{host}{253_img_path}` |
| 樂聲 | `web/2020` 首頁 `div.movie-list`；`web/2020-movie_item.php?film_id=` 的 `.movie_time_out` | `2020_sel_ticket.php?...` 直達 | 官方規則「每日場次最晚於前一天 20:00 前公布」→ `publishRule: 'prevDay2000'` |

**沒有加入**：光點、誠品電影院、南投戲院 — 找不到可讀取的線上場次（光點時刻表頁沒有文字場次；南投靠電話語音；誠品主要在臉書公告）。若使用者給了網址再評估。ez訂（ezding）可能涵蓋小影城，但在使用者 Chrome 開啟時被導走，未完成調查。

### 「下次公布」怎麼算（`scrape/index.mjs`）

- `publishedUntil`：從今天起**連續**有場次的最後一天（跳開零星預售日，否則秀泰會顯示到 12/29）
- 有官方資訊（美麗華公告、樂聲規則）→ `official: true`，畫面標「官方公告」
- 其他 → `estimated: true`，當作每日滾動（明天公布 publishedUntil+1），畫面標「推估」
- `presale: true` 表示另有預售場次

### 合併規則

同片名（`normTitle`：去《》、空白、全半形、標點）視為同一部片。上映日 > 今天 → 即將上映（有場次則 `presale`）；否則有場次才列為上映中。

## 第一次真實執行結果（2026-11-18 02:17，使用者電腦）

秀泰 3595、威秀 2269、國賓 459、美麗華 239、喜樂時代 460 場；新光 0（已修，02:21 那次 692）。
in89、樂聲、美麗新是之後才加的，**只用模擬資料測過，尚未在真實官網跑過** — 下一次執行後要檢查 `docs/data.json` 的 `status`。

## 測試方式

這個開發環境連不到影城網站（只有使用者電腦和 Chrome 連得到），所以：
- 解析邏輯先在使用者 Chrome（Claude in Chrome）對真實官網驗證，再寫成程式
- `node --import ./test/mock.mjs scrape/index.mjs` 跑模擬流程
- **在 /tmp 的副本跑 mock**，不要在 repo 內跑，否則會把模擬資料蓋掉 `docs/data.json` 被提交上去
- 推送前一定先 `git pull --rebase`（使用者電腦每天會 push 資料）

## 使用者端注意事項（已告知使用者）

- 電腦要「睡眠」不能「關機」；建議把「休眠」設為永不（有些主機板無法從休眠被排程喚醒）
- 排程是 Interactive 登入類型：**重開機後要登入一次**，否則 8 點不會跑
- 手動更新：PowerShell 執行 `Start-ScheduledTask "tw-cinema 每日更新場次"`；不要短時間連跑（威秀會擋）
- 驗證是否成功：網站標題下方「場次更新於 ...」

## 待辦 / 可改進

1. 確認 in89、樂聲、美麗新第一次真實執行結果；美麗新海報網址是否正確
2. 若威秀仍偶爾回 0 場：再放慢，或失敗時自動延遲重試一次
3. 美麗新的「開放場次訂票時間」公告頁找出網址後接上 official publish
4. 光點 / 誠品 / 南投戲院：使用者若提供可讀來源再加入
5. App 內海報若被防盜連擋住，目前會自動換成產生的替代海報；可考慮由爬蟲下載海報一起發布
