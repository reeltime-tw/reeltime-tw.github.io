# 全台電影場次 App — 交接說明

> 使用者：李心祐（GitHub：xinyolee827-tech）。**一律用繁體中文回覆**，包含程式註解與 commit 以外的所有說明。
> 使用者不是工程背景，說明要白話、給可直接貼上的指令。

## 這是什麼

自動抓取台灣各影城官網場次，整理成手機好用的網頁 App。

- 網站：https://reeltime-tw.github.io/（2026-11-24 由 xinyolee827-tech.github.io/tw-cinema 搬到 GitHub 組織 reeltime-tw，避免網址露出個人帳號名稱；舊網址已失效）
- 專案：https://github.com/reeltime-tw/reeltime-tw.github.io
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
| `docs/index.html` | App（單檔 HTML/CSS/JS，讀 `data.json`；載入失敗時顯示示範資料）。2026-11-18 淺色系改版，見「介面設計」 |
| `scrape/posters.mjs` | 下載海報、用 sharp 縮成寬 300px WebP 存到 `docs/posters/{sha1(url)前16碼}.webp`；已有的不重抓、沒用到的刪除；電影加上 `posterLocal`。App 依序用 posterLocal → poster（官網）→ 產生的替代圖 |
| `docs/icon.svg`、`docs/icon-*.png`、`docs/apple-touch-icon.png`、`docs/manifest.webmanifest` | App 名稱「Reeltime」（2026-11-24 由「開場」改名）與圖示（紅底白票根＋播放符號）；PNG 由 `node tools/make-icons.cjs` 從 icon.svg 產生。manifest 讓手機「加入主畫面」後全螢幕開啟 |
| `docs/watch-core.js` | 追蹤場次的比對規則（純函式：符合條件、新場次判斷、通知文字、IndexedDB 存取），**頁面（`<script src>`）與 `sw.js`（`importScripts`）共用同一份**，規則只能改這裡 |
| `docs/sw.js` | Service Worker：只做背景檢查（`periodicsync`）與通知點擊，**不做離線快取**。只讀自己網站的 `data.json` |
| `tools/serve.mjs` | 本機預覽伺服器：`node tools/serve.mjs docs 8765`，開 http://localhost:8765/ 測試（Service Worker 需要 localhost 或 https）。只讀檔案 |
| `test/watch.test.mjs` | 追蹤通知測試：比對規則、新場次判斷，並用 vm 假環境跑 `sw.js` 的背景檢查。`node test/watch.test.mjs` |
| `docs/data.json`、`docs/raw/*.json`、`docs/posters/` | 由使用者電腦產生並提交。`raw/` 是各影城上次成功的原始資料（某家失敗時沿用） |
| `windows/setup.ps1` | 一次性設定：裝 Git/Node、clone 到 `%USERPROFILE%\tw-cinema`、建排程（WakeToRun）、開喚醒計時器、先跑一次 |
| `windows/update.ps1` | 更新主程式。參數 `-Only "美麗新,樂聲"`（只更新指定連鎖）、`-IfStale 18`（距上次完整更新超過 18 小時才跑，補跑用）；用具名 Mutex 避免同時跑兩份；用 SetThreadExecutionState 防止執行中睡著；紀錄在 `windows/update.log`，完整更新成功時間記在 `windows/last-full-success.txt` |
| `windows/sync-schedule.ps1` | 依 `data/schedule.json` 在 Windows 排程器建立／更新／刪除「tw-cinema 公布 …」排程，並確保「補跑」排程存在。update.ps1 每次跑完會自動呼叫；`-DryRun` 只預覽 |
| `scrape/announce.mjs` | 公告爬蟲：讀官網公開頁面，找出「何時公布場次」（單次／每週／每天），寫入 `data/announcements.json`。**不處理 Facebook／IG／LINE**（需登入、違反平台條款） |
| `scrape/schedule.mjs` | 把公告＋`data/publish-rules.json`（手動規則）算成 `data/schedule.json` |
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
| 美麗新（台茂 1004、大直皇家 1005） | `/Booking/Timetable` 內嵌 `var CinemaList = '{json}'` | 官網用表單 POST，無單場連結 → 連場次表頁 | 宏匯店 2025-12-22 停業。`/Booking/StartOrderTime` 官方規則「週五上映片於當週三 18:00 後公布週五至下週四」→ `publishRule: 'wed1800'`（每次抓取都比對公告文字，改了就退回推估）。海報路徑 `/MiramarApp/Resource/{PostUrl}_S.jpg` 已驗證 |
| 喜樂時代 | `Movie/GetTheaterList`、`Movie/GetMovieList/{site}`、**逐日** `Movie/GetMovieAlltime/{site}/{programid}/{date}`（回「查無資料」= 未公布） | 只能連 `book.html?sid=` | 4 間：Nangang/Beyond(永和)/Kaohsiung/Ximen(今日店) |
| in89 | 各據點 `in89cinemax.com/index.aspx?TheaterId=N` 有隱藏欄位 `theater_api`（如 `talee.in89.com.tw`）；`POST https://{host}/api/api_movie.php?method=getStagesByDate` 不需登入，回傳全部場次與電影 | 連據點頁 | TheaterId 1/18/15/17/2/16/14；**18 台中大里 theater_api 為空**，略過。海報 `https://{host}{253_img_path}` |
| 樂聲 | `web/2020` 首頁 `div.movie-list`；`web/2020-movie_item.php?film_id=` 的 `.movie_time_out` | `2020_sel_ticket.php?...` 直達 | 官方規則「每日場次最晚於前一天 20:00 前公布」→ `publishRule: 'prevDay2000'` |

| 其他影城（開眼電影網） | `atmovies.com.tw/showtime/{戲院代碼}/{地區}/`（今天），頁面「選擇日期」連結 `.../YYYYMMDD/` 為其他已公布日期；`ul[id=theaterShowtimeTable]` 每部片一塊，時間用全形冒號，分級圖示 `cer_G/P/F2/F5/R` | 連該戲院官網（開眼頁「網站」欄），沒有就連開眼時刻表 | `chains/atmovies.mjs` 的 `THEATERS` **白名單**：開眼全台 107 間中，扣掉各大影城官網已抓的，剩約 40 間獨立影城／藝文影院／二輪（光點、誠品、真善美、府中15、南投戲院、全美戲院…）。並行 2、每頁間隔 300ms、每間最多 7 天。cinema.chain 一律為「其他影城」 |

**曾經無法加入、現由開眼補上**：光點（官網時刻表是圖片）、誠品（只在臉書公告）、南投戲院（電話語音）。**刻意不收**：開眼的「VR體感劇院」（非一般電影放映）、「喜樂時代高雄總圖店」（即喜樂時代高雄店，已由官網抓）。新增影城時，到開眼各縣市頁比對後把代碼加進白名單。

### 「下次公布」怎麼算（`scrape/index.mjs`）

- `publishedUntil`：從今天起**連續**有場次的最後一天（跳開零星預售日，否則秀泰會顯示到 12/29）
- 有官方資訊（美麗華公告、樂聲規則）→ `official: true`，畫面標「官方公告」
- 其他 → `estimated: true`，當作每日滾動（明天公布 publishedUntil+1），畫面標「推估」
- `presale: true` 表示另有預售場次

### 合併規則

同片名（`normTitle`：去《》、空白、全半形、標點）視為同一部片。上映日 > 今天 → 即將上映（有場次則 `presale`）；否則有場次才列為上映中。

## 第一次真實執行結果（2026-11-18 02:17，使用者電腦）

秀泰 3595、威秀 2269、國賓 459、美麗華 239、喜樂時代 460 場；新光 0（已修，02:21 那次 692）。
in89、樂聲、美麗新：2026-11-18 02:34 在使用者電腦的暫存副本實測成功（美麗新 498、in89 1635（去重後）、樂聲 134 場），三家海報網址皆回 200。

## 失敗重試（`scrape/index.mjs`）

第一輪依序抓各家；失敗（含 0 場）的影城等其他家跑完後再重試一次，等待時間 = 影城檔匯出的 `retryDelayMs`（預設 1 分鐘，**威秀 5 分鐘**），從失敗時間起算。重試仍失敗才沿用 `raw/` 舊資料。`status` 依 `CHAINS` 順序排序。

## 測試方式

Claude Code 桌面版直接在使用者電腦上執行時**連得到影城網站**，可以直接實測（但在副本跑，且別短時間連跑威秀）。在其他開發環境則：
- 解析邏輯先在使用者 Chrome（Claude in Chrome）對真實官網驗證，再寫成程式
- `node --import ./test/mock.mjs scrape/index.mjs` 跑模擬流程；`mock-fail.mjs`（秀泰失敗沿用舊資料）、`mock-retry.mjs`（威秀第一輪 403、重試成功）
- 跑模擬時設 `RETRY_WAIT_MS=0`（或幾秒）跳過重試等待
- **在暫存資料夾的副本跑 mock**，不要在 repo 內跑，否則會把模擬資料蓋掉 `docs/data.json` 被提交上去
- 使用者電腦有安全防護 hook，`git clean` 等指令會被擋，屬預期行為
- 推送前一定先 `git pull --rebase`（使用者電腦每天會 push 資料）

## 使用者端注意事項（已告知使用者）

- 電腦要「睡眠」不能「關機」；建議把「休眠」設為永不（有些主機板無法從休眠被排程喚醒）
- 排程是 Interactive 登入類型：**重開機後要登入一次**，否則 8 點不會跑
- 手動更新：PowerShell 執行 `Start-ScheduledTask "tw-cinema 每日更新場次"`；不要短時間連跑（威秀會擋）
- 驗證是否成功：網站標題下方「場次更新於 ...」

## 介面設計（2026-11-18 改版）

**研究摘要**（競品：電影時刻 MovieLife、MovieGo、此刻 Right Now、ez訂、Fandango、AMC App 評論）
- 大家喜歡：常用影城置頂、依縣市篩選、可看未來幾天、特殊廳（IMAX/4DX）篩選、電影頁集中資訊並一鍵訂票
- 常見抱怨：查詢慢／跑不出來、沒涵蓋全部影城、只能看今天、字太小、日期與地點控制不明顯、改版後「太簡潔」反而難用、閃退與廣告
- 舊版自己的問題：頂部篩選列太多層（分頁＋上映中/即將上映＋日期＋地區＋時段＋品牌）、地區只有北中南東、沒有搜尋與常用影城、電影/影城是彈出面板導致**手機返回鍵直接離開網站**、已開演場次仍顯示、每張影城卡都重複公布資訊

**新架構**
- 底部 4 分頁（2026-11-24 起，原本 3 個）：現正上映 `#/`、影城 `#/cinemas`、即將上映 `#/soon`、追蹤 `#/watch`；電影頁 `#/movie/{id}`、影城頁 `#/cinema/{id}` 是獨立頁面（hash 路由，返回鍵可用、記住捲動位置）
- 頂部：縣市選擇（localStorage `twc.city`）＋搜尋；常用影城存在 `twc.favs`，排在最前面
- 篩選：時段（只在篩選面板內自填，快捷列不放時段按鈕）／特殊廳（`kindsOf()` 把各家版本文字歸成 IMAX、4DX、ScreenX、杜比、3D、豪華廳）／品牌，放在「篩選」面板，已選的以可移除標籤顯示
- 凌晨 0–3 點的午夜場排在當天最後（`tkey()`）；今天已開演的場次預設隱藏
- 面板（縣市、篩選、搜尋、訂票確認、資料來源）用 pushState，手機返回鍵先關面板；程式自己關面板時用 `ignorePop` 略過對應的 popstate
- 舊資料縣市不完整時，App 端 `cityOf()` 也會推斷；爬蟲 `util.mjs` 的 `cityOf` 已補行政區對照（新店→新北市、頭份→苗栗縣…）
- `test/ui.py` 已依新介面改寫

**視覺**：淺色、白底卡片，唯一強調色 `#b3122e`（戲院座椅紅）只用於選取狀態與訂票按鈕；時間與日期用 Google Fonts「Barlow Condensed」；場次按鈕做成兩側有半圓缺口的「票根」。分級色：普綠、護藍、輔12黃、輔15橘、限紅。

## 進行中：App 內精確路程時間

使用者要求在 App 內精確估算路程，同時位置不離開手機。完整計畫、環境限制與任務順序在 **`plans/travel-time.md`**，執行前先讀。

## Reeltime 改版 v3（2026-11-24，方針在 `plans/ui-v3.md`，已完成）

**改名**：開場 → Reeltime（副標「全台電影場次」）。品牌字用 Barlow Condensed 700、字距 .3px。圖示沒換。

**追蹤場次通知**（`#/watch`）
- 使用者在電影頁按「追蹤新場次」（即將上映的片是「開賣時通知我」；電影頁沒場次的空狀態有「有場次時通知我」會帶入目前日期與時段），設定地區（目前縣市／全台／只看常用影城）、日期（選填，未來 14 天可複選）、時段（選填，從／到）。**一部電影一筆追蹤**，已追蹤再按就是編輯。
- 資料：`localStorage` 的 `twc.watches` ＋ IndexedDB（資料庫 `twc`，key `watches`、`favs`）鏡像，因為 Service Worker 讀不到 localStorage。欄位：`id, movie, title, area, dates[], from, to, seen[], newKeys[], created, checkedAt, rev`；場次鍵 `cinema|date|time|format`。同一筆兩邊都有時以 `rev` 大的為準（背景程式寫的比較新就用它的）。
- 新場次判斷（`watch-core.js` 的 `refresh()`）：建立時目前符合的全放進 `seen`；之後每次載入資料，符合但不在 `seen`／`newKeys` 的就是新場次，放進 `newKeys` 並通知；使用者展開該追蹤卡片＝看過，`newKeys` 併入 `seen`。過去日期的 `seen` 會清掉；暫時消失又出現的已看過場次不會重複算新。`dates` 全部過期顯示「已結束」。
- 通知時機：**打開 App 時**（`boot()` → `watchStart()` → `watchCheck()`）比對，有新場次就在「追蹤」分頁顯示紅點數字、其他頁上方出現橫幅、有授權時跳系統通知（透過 `showNote()`，Android 要經 Service Worker 才能跳通知）；久未使用（隱藏超過 20 分鐘）回到 App 會重新載入並比對。**App 沒開時**：`sw.js` 的 Periodic Background Sync（tag `twc-watch`，`minInterval` 6 小時），只有 Android Chrome 把網站安裝成 App 後才支援；iPhone 不支援，只能打開 App 才檢查。畫面（追蹤頁頁首）有用白話寫明這些限制。通知權限在**第一次建立追蹤後**才用一句話說明再詢問。
- **沒有推播伺服器**，CSP 維持 `connect-src 'self'`，只補了 `worker-src 'self'`。隱私說明面板已加一段追蹤的說明。**之後任何功能不能讓追蹤條件離開手機。**
- 測試：`node test/watch.test.mjs`。瀏覽器實測時可把 `window.showNote` 換成記錄用的假函式，並改 `S.watches[0].seen`（拿掉幾筆）再呼叫 `watchCheck()` 驗證紅點與通知。內建瀏覽器（Claude 桌面版的 Browser pane）**無法註冊 Service Worker**（會顯示「An unknown error occurred when fetching the script」，程式有 try/catch 不影響使用），所以 `sw.js` 只用 Node vm 假環境測過，沒在真正的瀏覽器跑過 `periodicsync`；上線後請在 Android Chrome 安裝成 App 實測。

**UI／UX（P1 全做、P2 做了 8、9、11 與部分 10）**
- 訂票面板：摘要在上、主按鈕「到 XX 訂票」固定在底部；「出發時間」預設收合成一列（有位置：「最晚 HH:MM 出門 ›」；沒位置：「規劃出發時間 ›」），預設高度約 340px。狀態 `S.leaveOpen`。
- 電影頁：日期列與版本／語言快捷鈕放進 `#sub`（固定在頂部）；海報寬 88px、簡介 2 行。
- 首頁／即將上映電影格：≥360px 3 欄、≥600px 4 欄；卡片「下一場 10:30・12間」（間＝目前地區有場次的影城數）。定位提示改單行橫幅（`geo-bar`，可關閉，`twc.geoBarOff`）。
- `--ink3` 改 `#636a78`（白底 5.4:1、`--bg` 上 5.0:1）；原 11／11.5px 小字提高到 12px、12.5px 到 13px。
- 文案：頁尾「每天多次自動更新」、資料來源面板列出排程時間。影城列表每列一行副標「品牌・縣市」＋「下次公布 11/25（三）」，右側「今天還有」／「今天無場次」。
- P2：頂部「N 小時前更新」（超過 24 小時用警示色）、即將上映 3 欄與「預售」標籤、空狀態都有下一步按鈕、卡片極淡陰影。**沒做**：完整 type scale／圓角層級統一（只動到會影響版面的部分）。
- `cityOf()` 移到 `watch-core.js`，頁面與背景程式共用。
- 本機沒有 python，`test/privacy.py`、`test/ui.py` 無法執行；改用瀏覽器網路請求檢查（只有 localhost）與 CSP 外連測試人工確認。**有 python 的環境請補跑 `test/privacy.py`**。

## 公布時段自動排程（2026-11-24 新增）

流程：每次更新後 → `announce.mjs` 讀官網公告 → `schedule.mjs` 產生 `data/schedule.json` → `sync-schedule.ps1` 在 Windows 排程器建立排程。到了公布時間，排程會跑 `update.ps1 -Only <連鎖>`，公布後第 10 分鐘與第 45 分鐘各抓一次（官網與各平台更新有時間差）。
- 目前排程（工作排程器裡以「tw-cinema」開頭）：每日更新 08:00（完整）、「公布 全部補查」每天 14:00（完整）、「公布 美麗新」週一／二／三 18:10 與 18:45、「公布 美麗華」依官網公告的單次時間（過期自動刪、新公告自動加）、「公布 樂聲」每天 20:10 與 20:45、「補跑（醒來或登入時）」登入或從睡眠醒來 2 分鐘後，若超過 18 小時沒完整更新就補跑（對策 11/23 電腦沒醒來漏跑）。
- **社群（Facebook／IG／LINE）不自動爬**，在粉專看到公告時，手動加進 `data/publish-rules.json`（格式寫在檔案開頭「說明」），下次更新就會排程。
- 新增連鎖或影城時：官網若有公布說明，把網址加進 `announce.mjs` 的 `FIXED`／`CHAIN_SITES`；沒有就寫手動規則。
- 測試：`node test/announce.test.mjs`、`node test/schedule.test.mjs`；`node scrape/announce.mjs --dry` 實際掃描不寫檔；`node scrape/schedule.mjs --print` 看排程清單。
- 排程用 Interactive 登入類型，**重開機後要登入一次**才會執行（與每日更新相同）。

## 各影城場次公布時間與管道（2026-11-24 整理）

完整表格在 **`research/publish-schedule.md`**。重點：只有美麗華、美麗新、樂聲有官方公告（已接成 official）；威秀、秀泰、國賓、新光、喜樂時代、in89 官網沒找到說明，只能用每日快照推測；41 間「其他影城」全部找不到。`node tools/publish-history.cjs` 可用 git 歷史重新歸納各連鎖實際延長日（快照越多越準）。
**已知限制**：開眼電影網在凌晨尚未換日（01:27 時「今天」頁面仍是前一天、新的一天頁面是空的），所以 0 點到早上的手動更新會讓其他影城當天場次大量缺失（約 29 間），要等早上 8 點那次才補齊 → **手動更新請避開凌晨**。喜樂時代高雄店、今日店官網 API 回「查無資料」，原因未確認。

## 推播（App 沒打開也能通知，2026-11-24 新增）

使用者要求 iPhone 在 App 沒開時也收到推播，因此**放寬了「網頁不對外連線」的承諾**：CSP 的 connect-src 只多允許推播伺服器一個網域，且只在使用者按「開啟通知」後才連線。
- **推播伺服器** `push-server/worker.js`（Cloudflare Workers 免費方案，網址 https://reeltime-push.reeltime-tw.workers.dev，帳號是使用者的 Cloudflare，子網域 reeltime-tw）：只用 KV（binding `WATCHES`）存「推播位址＋追蹤條件」，不做比對、不發推播。手機 `PUT/DELETE /device/{隨機裝置代號}`（只接受網站來源）；電腦用管理金鑰 `GET /all`、`DELETE /all/{代號}`。90 天沒更新自動刪除。部署：`cd push-server && npx wrangler deploy`（wrangler 已登入使用者帳號）；管理金鑰是 Worker secret `ADMIN_TOKEN`。
- **電腦端** `scrape/push.mjs`：update.ps1 每次更新後執行。用 vm 載入 `docs/watch-core.js`（與手機同一套規則）比對，有新場次用 `web-push` 送出；失效位址（404/410）自動從伺服器刪除。金鑰在 `windows/push-secrets.json`、每支手機已通知狀態在 `windows/push-state.json`，**兩者都不上傳**（.gitignore）。`--dry` 預覽、`--test` 對所有手機送測試通知。測試：`node test/push.test.mjs`。
- **網頁**：`pushSync()` 在開啟通知、儲存追蹤、切換常用影城（有「只看常用影城」的追蹤時）時把條件同步到伺服器；內容沒變不重送，但每 7 天至少更新一次。推播開啟時，打開 App 找到的新場次只顯示紅點、不再跳系統通知（避免重複）。`sw.js` 新增 `push` 事件。
- **iPhone 條件**：iOS 16.4 以上，用 Safari「加入主畫面」並從主畫面打開，才能開啟推播（追蹤頁會說明）。
- **追蹤介面（2026-11-24 v3.1）**：追蹤分頁跟一般電影頁做出區隔。`#/watch` 總覽（頂部固定「＋ 追蹤一部電影」→ 追蹤專用選片畫面 `watchPickSheet()`，可搜尋、分即將上映／現正上映，選好直接開追蹤設定，不經過一般電影頁；卡片有條件標籤、新場次數、接下來 3 場預覽），`#/watch/{id}` 專屬頁只列符合條件的場次，新場次紅框標「新」排最上面，條件可直接點「更改」。追蹤條件的日期改成**日期範圍** `dateFrom`／`dateTo`（下拉選單，舊的 `dates` 清單仍相容），時段也改下拉選單（每 30 分、午夜場排最後）。訂票面板改成票根樣式、右上 × 關閉、主按鈕只留一個。測試：`node test/watch-range.test.mjs`。
- 網站 2026-11-24 搬到 GitHub 組織 `reeltime-tw`（repo `reeltime-tw.github.io`），網址 https://reeltime-tw.github.io/ 。換網址會讓手機上的常用影城、追蹤、推播都要重新設定。

## 待辦 / 可改進

1. ~~確認 in89、樂聲、美麗新真實執行結果~~（已完成）
2. ~~威秀失敗自動延遲重試~~（已完成，見「失敗重試」）；若重試後仍常失敗，再考慮拉長等待或放慢
3. ~~美麗新開放訂票時間~~（已完成，wed1800）
4. ~~光點 / 誠品 / 南投戲院~~（已由開眼「其他影城」補上，連同其他約 40 間獨立影城）
6. in89 台中大里：官網與開眼都沒有線上場次，暫缺
5. ~~爬蟲下載海報一起發布~~（已完成，posters.mjs；125 張約 2.7MB）

**注意**：在 repo 內跑 mock 會把真實海報全部刪掉（mock 的海報網址不同）→ 一律在副本跑。

## 2026-11-18 早上修改（claude.ai 對話）

- **修正：iPhone 在篩選面板點任何選項都跳出時間轉盤。** 原因是 `openSheet()` 會把焦點放到面板裡第一個 button/input，篩選面板每次點選都重畫，焦點就落到「時段」的 `<input type=time>`。現在只聚焦 `[autofocus]`（搜尋框），其他面板聚焦在 `.sheet` 本身（tabindex=-1）。**之後新增面板不要讓 input 自動取得焦點。**
- **快捷列移除「18 點後／中午前」**（使用者要求），首頁、電影頁、影城頁的快捷列只放特殊廳規格（依當天有場次的 `KINDS` 顯示）；電影頁、影城頁另外顯示語言。
- **新增語言／配音篩選**：`LANGS=['國語','英語','日語','韓語','粵語']`，`langsOf(format)` 從版本文字判斷（`國`、`中文`、`CHI` 都算國語，含中文配音版與華語片），場次多一個 `_l` 欄位、狀態 `S.langs`。版本文字沒標語言的場次（如美麗華「標準廳」）選了語言後不會出現，面板內已註明。
- **電影頁影城卡片改為可收合**（使用者：畫面太長難滑）：預設收起，標題列顯示「N 場＋前 4 個時間＋版本」，點標題展開看票根；只有一間影城或常用影城時自動展開；有「全部展開／全部收起」。狀態 `S.open`、`S.closed`、`S.openFor`（換電影就重置）。展開後底部有「看這間影城的所有電影」連到影城頁（標題列現在是展開按鈕，不再是連結）。
- **定位與隱私（取代原本的 BigDataCloud 做法）**：位置**不離開手機**。
  - `docs/tw-counties.json`（68KB，gzip 約 18KB）：內建縣市邊界，由 `tools/build-counties.cjs` 從 npm `taiwan-atlas`（MIT，內政部縣市界線）簡化產生；已用 30 個交界地點（三重/西門町/永和/新竹市縣等）驗證全對。`countyAt()` 點在多邊形內判斷，找不到時用 `CITY_CENTER` 最近縣市。
  - **先說明再詢問**：首頁卡片說明用途後，使用者按「使用目前位置」才呼叫 geolocation；開 App 時只有 `twc.geoOK=true`（同意過）且 `cityMode=auto` 才自動定位。只存縣市，不存經緯度。
  - **CSP**（`<meta http-equiv=Content-Security-Policy>`）：`connect-src 'self'`、`img-src 'self' data:`、`font-src 'self'`，瀏覽器擋下所有對外連線。因此 **Barlow Condensed 字型改放 `docs/fonts/`（SIL OFL）**、海報只用 `posterLocal`（不再退回官網原圖）。**之後任何功能都不能加對外 fetch/外部圖片/外部字型，否則會被 CSP 擋**；外部只能用使用者點擊的連結（a href）。
  - 隱私說明面板 `privacySheet()`（頁尾、定位卡片、縣市面板都有入口），可「停止自動定位」。
  - **`test/privacy.py`**：模擬 5 個地點定位，檢查開啟時不自動要位置、縣市正確、無對外連線、沒有請求帶經緯度、CSP 生效（用 `securitypolicyviolation` 事件判斷，不是看連線失敗）、localStorage 不存經緯度。已用「拿掉 CSP＋故意外送座標」的壞版本確認測試會失敗。改版後執行：`cd docs && python3 -m http.server 8770 &` 再 `python3 test/privacy.py http://localhost:8770/`。
- **出發時間（最晚幾點出門）**：使用者要求「先做出來、試用後再決定放哪」，目前放在**確認場次面板**（`ticketSheet` → `leaveHTML()`），電影頁影城卡片顯示距離並依距離排序（常用影城仍最前）。
  - 影城座標：`docs/cinema-geo.json`（102/111 間；由 `tools/cinema-geo-src.json` 產生，每筆標來源 osm/official/addr/approx，**approx 的 17 間誤差可能數百公尺，有空可校正**）。已用縣市邊界驗證全部落在正確縣市。秀泰官方 latLng 有錯（土城標到新竹、麗寶偏移），不可盲信。沒座標的 9 間小影院只顯示「請用地圖 App」。
  - 推估：`travelMin()` 直線距離 × 繞路係數 1.35（走路 1.25），大眾運輸 18km/h＋12 分、機車 22km/h＋5 分、開車 22km/h＋10 分（>15km 提高速度），顯示 0.85–1.25 倍區間，出門時間用上限算；提早分鐘 `twc.travelBuf`（預設 15）、交通方式 `twc.travelMode`。午夜場（<04:00）算隔天。
  - 地圖按鈕（只傳**影城**位置）：**Google 帶抵達時間**：`/maps/dir//{影城名+地址}/data=!4m6!4m5!2m3!6e1!7e2!8j{秒}!3e{0開車|2走路|3大眾運輸}`，起點留空＝手機目前位置，`6e1`＝抵達時間模式，`8j`＝抵達時間「當地時間當 UTC」的秒數（`Date.UTC(本地年月日時分)/1000`）。2026-11-18 在 Google 地圖網頁版實測顯示「抵達時間 11月19日 9:15」與準時抵達的捷運班次；**非官方格式，日後可能失效**；iPhone 的 Google 地圖 App 是否吃這個參數待使用者實測。官方 `?api=1` 不支援抵達時間（舊參數 `ttype=arr` 實測無效，會被當成出發時間）。Apple 地圖網址不支援抵達時間。
  - 「提早到」改為 `<select id=lvBuf>`（0–120 分每 5 分，iPhone 會跳滾輪），在 change 事件更新，不自動聚焦。
  - 使用者位置只存在記憶體 `S.here`（10 分鐘內重用），不寫入 localStorage。`getHere(prompt)`：未同意過時只在按按鈕後詢問。
  - `test/privacy.py` 已加入出發時間流程的對外連線檢查。
