# 計畫：App 內精確估算路程時間（位置不離開手機）

> 規劃：Opus（2026-11-18）。執行：交給 Sonnet。回覆使用者一律繁體中文、白話。
> 先讀 `CLAUDE.md`，尤其「定位與隱私」「出發時間」兩節。

## 目標

取代 `docs/index.html` 的 `travelMin()`（目前是直線距離 × 1.35 的粗估）。
使用者要求：**在 App 內精確估算**，同時**維持資訊安全承諾：位置不離開手機**。

## 核心做法：預先算好、手機查表

1. 全台切成固定網格（建議 500 m，試算後再決定是否改 300 m）。格子編號由公式算出，手機與伺服器一致。
2. 在 GitHub Actions 上，用真實道路（OpenStreetMap）與真實班表（交通部 TDX）算出「每個格子 → 每間影城」的時間。
3. 每間影城輸出一個檔 `docs/travel/{cinemaId}.bin`。App 只在使用者打開確認場次面板時，下載**那一間影城**的檔，在手機上把自己的位置換成格子編號查表。

**隱私**：請求網址只有影城 ID，跟打開影城頁一樣。不含座標、格子編號或縣市。CSP 維持 `connect-src 'self'`，不用改。

## 引擎選擇

| 模式 | 引擎 | 說明 |
|---|---|---|
| 大眾運輸 | **r5py**（Conveyal R5，Python） | 專門做大量起點×終點的時間矩陣，吃 OSM `.pbf` + GTFS，可設出發時間窗並取百分位數 |
| 走路 | r5py（WALK） | 同一套 |
| 開車 | **OSRM**（Docker `osrm/osrm-backend`）car profile | `table` API 一次算多對一，快 |
| 機車 | OSRM **自訂 profile** `tools/travel/scooter.lua` | 以 car.lua 為基礎：**禁走高速公路與快速道路**（`motorway`、`motorway_link`、`trunk`中標示 `motorcycle=no` 者）、速度上限約 50、市區路口延遲較高 |

OSRM 是不塞車的理想時間。開車和機車要依時段乘上**塞車係數**，係數在試算階段用 Google 地圖樣本校正（見「驗證」）。

> 如果 r5py 在 Actions 上跑不動或太慢，備案是 OpenTripPlanner 2（`arriveBy` 查詢），但會慢很多。

## 資料來源

- **OSM**：`https://download.geofabrik.de/asia/taiwan-latest.osm.pbf`（約 300 MB）。
- **TDX 班表**：`https://tdx.transportdata.tw/`。需要**使用者自己註冊免費會員**，拿 Client ID / Client Secret，存成 GitHub Secrets：`TDX_CLIENT_ID`、`TDX_CLIENT_SECRET`。不可代為註冊。
  - 先查 TDX 有沒有現成 GTFS 匯出（例如公路客運、部分縣市公車）。沒有的話，寫轉換程式 `tools/travel/tdx2gtfs.py`，把 TDX JSON 轉成 GTFS：
    - 捷運（台北、桃園、台中、高雄、新北）：`Station`、`StationOfLine`、`S2STravelTime`、`Frequency`，用 `frequencies.txt`
    - 台鐵、高鐵：`DailyTimetable` 或 `GeneralTimetable`
    - 市區公車（六都與其他有資料的縣市）、公路客運：`Route`、`StopOfRoute`、`Schedule`（有班表用班表，只有班距就用 frequencies）
  - 資料缺口要記錄在 `tools/travel/COVERAGE.md`。缺口地區的大眾運輸時間標示「粗估」。
- **影城座標**：`docs/cinema-geo.json`（102/111 間）。approx 的 17 間要先校正，誤差幾百公尺會直接變成路程誤差。沒座標的 9 間沒有時間表，App 維持顯示「請用地圖 App」。

## 重要環境限制（執行前必讀）

- **Claude 的雲端開發環境連不到** geofabrik、TDX、maven、OSRM 公共伺服器（已實測）。所以**計算一律在 GitHub Actions 上跑**。開發環境只負責寫程式、觸發 workflow（`gh workflow run`）、下載結果（`gh run download`）。`gh` 的 GraphQL 被擋，要用 REST（`gh api`）。
- 專案是 **public**，所以 Actions 免費、不限分鐘。標準機器 4 核、16 GB RAM，每個 job 上限 6 小時，可以用 matrix 拆成多個 job 平行跑。
- TDX 可能擋國外 IP（威秀、新光有前例）。**第一步先在 Actions 上測試 TDX 連不連得到**。被擋的話，改成在使用者 Windows 電腦下載 TDX 原始資料、commit 到另一個分支，或上傳成 Release asset，再讓 Actions 取用。
- 使用者電腦每天 08:00 會 push 資料。推送前一定先 `git pull --rebase`。

## 時段

影城場次多在 10:00–24:00。大眾運輸依「出發時段」各算一次，每次用 60 分鐘時間窗，取**第 50 和第 90 百分位數**（中位數、保守值）：

- 平日（週三）：10:00、14:00、18:00、21:00、23:00
- 週末（週六）：10:00、14:00、18:00、21:00

App 用「場次開演 − 提早到 − 中位數時間」推出出發時刻，找最近的時段，再用該時段的 p90 算「最晚出門」。深夜（23:00 時段）班次少，資料會反映出來。

## 檔案格式 `docs/travel/{cinemaId}.bin`

- 全域網格：WGS84，`lat0=21.8, lon0=119.3`，格子大小用度數表示：`dLat = 500/111320`，`dLon = 500/(111320·cos(23.7°))`。`row = floor((lat-lat0)/dLat)`、`col = floor((lon-lon0)/dLon)`。實作寫成一個共用函式，Python 和 JS 各一份，並加測試確保結果一致。
- 每間影城只存它的 bbox：從影城往外，取 90 分鐘內可到達的範圍，最遠 60 km。
- 格式：小的 JSON header（版本、bbox 起始 row/col、寬高、layer 名稱清單、計算日期），後面接 **uint8 分鐘陣列**，每個 layer 一份；`255` = 到不了或超過 254 分。Layer 清單：`walk`、`scooter`、`car`、`pt_wd10_p50`、`pt_wd10_p90`…依時段展開。
- 目標每間 ≤ 300 KB（GitHub Pages 會 gzip）。超過就把 bbox 縮小，或大眾運輸只存 p50 並加上一個固定的保守值差距。
- 另外輸出 `docs/travel/index.json`：列出有時間表的影城 ID、計算日期、資料涵蓋說明。

**只算有人的格子**：格子 250 m 內有 OSM 道路才算，其餘填 255，可大幅減少計算量。

## App 端修改（`docs/index.html`）

- `leaveHTML()` 改成：有 `travel/{id}.bin` 就下載（用 `fetch`、同源）並快取在記憶體，換算格子後查表。顯示「約 N 分鐘（依 TDX 班表與道路資料）」。查不到（範圍外、255、沒有檔案）就退回現有 `travelMin()`，並明確標「粗估」。
- 起點不在格子中心，誤差加減一格走路，約 3–6 分鐘。在 p90 上**加 3 分鐘**緩衝，畫面說明「已含步行到站誤差」。
- 開車、機車：OSRM 時間 × 時段塞車係數（由驗證階段決定，寫在 `index.json`，不要寫死在程式裡）。
- 「Google 地圖」按鈕保留，作為「想看即時路況」的選項。
- 隱私面板 `privacySheet()` 加一句：路程時間是事先算好的表，在手機上查，位置不會送出。
- **不准**把座標、格子編號放進任何網址或請求。

## 測試

- `test/privacy.py`：加入檢查。確認面板只會請求 `/travel/{id}.bin`，網址不含數字座標或格子編號，也沒有其他對外連線。
- 新增 `test/travel_grid.mjs`：JS 與 Python 網格公式在 1000 個隨機點上結果一致。
- 新增 `test/travel_lookup.py`：用假的 bin 檔確認查表、退回粗估、跨午夜場次（< 04:00 算隔天）都正確。

## 驗證（決定能不能上線）

1. **試算階段**只做 2 間台北影城（建議：信義威秀、西門町一帶的影城），加 1 間郊區（例如新店或三峽），涵蓋全部模式與時段。
2. 每間挑 8 個起點，近、中、遠和不同方向各有，搭配 2 個時段，與 Google 地圖比較（在使用者 Chrome 用 Claude in Chrome 查「抵達時間」模式），結果記錄到 `tools/travel/validation.csv`。
3. 合格標準：大眾運輸中位數絕對誤差 ≤ 5 分、最大 ≤ 12 分；機車和開車校正係數後中位數 ≤ 4 分。不合格就先調整（網格大小、步行速度、TDX 缺漏、機車 profile），不要直接推全台。
4. 合格後才擴到全部 102 間，並把驗證結果寫進 `CLAUDE.md`。

## Actions workflow `.github/workflows/travel.yml`

- 觸發條件：`workflow_dispatch`（可帶參數 `cinemas=id1,id2` 只算部分影城）＋每週一 03:00（台北）`schedule`。
- Job 1 `prepare`：下載 OSM、TDX，轉成 GTFS，快取（`actions/cache`，key 用日期週數），輸出格子清單。
- Job 2 `compute`（matrix，按影城分組，例如每組 10 間）：r5py 跑大眾運輸和走路，OSRM 跑開車和機車，輸出 `.bin`。
- Job 3 `publish`：合併結果，commit 到 `docs/travel/`（先 `git pull --rebase`），觸發現有「發布網站」。
- 注意：這個 workflow 會 push 到 main，與使用者電腦每日 push 可能衝突。push 失敗時要重試 rebase，最多 3 次。

## 執行進度

- ✅ **2026-11-18**：在 `.github/workflows/travel-probe.yml` 做連線測試（`gh api …/dispatches` 觸發，無法用 `gh workflow run`，因為會先查 GraphQL 預設分支，CCR 環境擋 GraphQL）。結果：Geofabrik OSM 200、TDX 入口網 200、TDX 登入端點 405（端點存在，GET 本來就該 405）、Maven Central 200、PyPI 200、Docker Hub 200、conda-forge 200。**Actions 連得到所有需要的資料來源**，不用改成使用者電腦下載。
- ✅ **2026-11-18**：使用者已設定 `TDX_CLIENT_ID`、`TDX_CLIENT_SECRET`（第一次只設了 Secret 沒設 ID，補上後成功）。TDX 登入測試 HTTP 200，`Rail/Metro/Station/TRTC`（台北捷運站點）API 回 HTTP 200。**TDX 金鑰可用，開始進入資料轉換階段**。

## 執行順序（任務清單）

1. ~~使用者註冊 TDX、建立兩個 GitHub Secrets~~ ✅ 已完成。
2. ~~在 Actions 上做連線測試~~ ✅ 已完成。
3. ~~寫網格程式（Python ＋ JS）與一致性測試~~ ✅ 已完成：`tools/travel/grid.py`、`tools/travel/grid.mjs`、`test/travel_grid.mjs`（1000 點隨機驗證全部一致）。
4. **捷運 GTFS 轉換：已完成並通過真實資料驗證**（見下「捷運 GTFS 轉換 — 完成狀態」）。
5. ~~公車 GTFS 轉換~~ ✅ 已完成（見下「公車 GTFS 轉換 — 完成狀態」）。台鐵尚未轉換（3 間試算影城都不緊鄰台鐵站，優先度較低，先跳過）。
5b. ⏳ **下一步（尚未開始）**：寫 r5py 計算程式（吃 metro+bus 的 GTFS）與 OSRM 計算程式（含 `scooter.lua`），在 Actions 上對 3 間試算影城算出時間矩陣。這一步需要在 Actions 上裝 Java（r5py 依賴 R5 引擎）與 Docker 跑 OSRM，比之前的資料抓取複雜很多，預期要花更多輪除錯。
6. 驗證比對 Google 地圖，校正塞車係數；不合格就回第 4–5 步。
7. App 端查表、退回粗估、隱私面板文字、測試。
8. 校正 17 間 approx 座標。
9. 擴到全台，補其他縣市 TDX 資料，寫 `COVERAGE.md`。
10. 更新 `CLAUDE.md`，交接說明。

## 捷運 GTFS 轉換 — 完成狀態（2026-11-18）

- `tools/travel/tdx_client.py`：TDX 登入＋**帶重試的 GET**。**重要發現**：TDX 對連續呼叫過快會回 **HTTP 200 但內容是 `{"message":"API rate limit exceeded"}`**（不是用 429 狀態碼），所以不能只檢查 HTTP code，一定要檢查回應內容。已處理：每次呼叫後固定等待、遇到限流訊息指數退避重試。
- `tools/travel/tdx2gtfs_metro.py`：把 `Rail/Metro/Station`、`S2STravelTime`、`Frequency` 轉成標準 GTFS（stops/routes/trips/stop_times/frequencies/calendar.txt）。**已知簡化**：TDX 的 `S2STravelTime` 每個 RouteID 只給一個方向的站間時間，反方向用「路徑反過來、時間不變」近似（捷運雙向時間本來就幾乎對稱）。同一 LineNo 可能有多個 RouteID＝不同行駛範圍（例如板南線有全程車與只到亞東醫院的區間車），不是方向。
- `tools/travel/validate_gtfs_metro.py`：基本完整性檢查（孤兒站點／trip、時間遞增、座標範圍、班距合理性）。
- `.github/workflows/travel-pilot.yml`：在 Actions 上跑 `tdx2gtfs_metro.py TRTC`，**真實資料測試通過**：122 站、11 條路線、75 個 pattern trip、75 筆班距，驗證全部通過。
- `.github/workflows/tdx-explore.yml`：開發輔助用，探索 TDX API 格式，之後可刪除。

## 公車 GTFS 轉換 — 完成狀態（2026-11-18）

- `tools/travel/tdx2gtfs_bus.py`：**已完成並通過真實資料測試**。限制在 3 間試算影城（信義威秀、西門威秀、新店裕隆城威秀）方圓 2 公里內：保留 937 條 subroute、略過 1696 條，最終 569 條路線、3833 筆班距，驗證通過。
- **已知效率問題（之後可優化，不影響正確性）**：目前「保留」一條路線後會把它**整條**（不管多遠）的站點都收進 `stops.txt`，不是只收範圍附近的站，所以 `stops.txt` 膨脹到 26527 筆。之後若要擴大到全台，應該改成只保留範圍內＋前後各 1-2 站（避免在範圍邊界就斷頭），不是整條路線全收。
- 站間時間用「相鄰站點座標直線距離 × 1.3 繞路係數 ÷ 18 km/h」估算（因為 TDX 沒有公車站間運行時間 API）。這是近似值，之後驗證階段要特別注意公車路段的誤差可能比捷運大。
- `tools/travel/validate_gtfs.py`：取代原本 `validate_gtfs_metro.py`（該檔案現在只是轉呼叫，保留相容性）。

## 公車／台鐵資料格式探索結果（2026-11-18）

- **公車 `Bus/Route/City/{city}`**：每條路線下有 `SubRoutes`（去程/返程用 `Direction` 0/1 區分），含首末班時間。
- **公車 `Bus/StopOfRoute/City/{city}`**：依 `SubRouteID`+`Direction` 給完整站序與座標，但**沒有站間時間**。
- **公車 `Bus/S2STravelTime/City/{city}` 回 404（Resource Not Found）**：這個端點對公車不適用（可能只有部分特殊路線或需要不同參數）。**對策**：用 `StopOfRoute` 的站點座標算站間直線距離，乘上繞路係數，除以假設平均速度（市區公車含停靠約 18–20 km/h）來估算站間時間，取代直接拿到的運行時間。沒有真正運行時間準，但比純直線距離估全程準，因為至少路徑是真的（沿站牌走，不是直線穿越建築物）。
- **公車 `Bus/Schedule/City/{city}`**：`Frequencys` 陣列，**每筆只代表單一天**（`ServiceDay` 是 0/1 整數、每個鍵一天，不像捷運是一次給整組 7 天），轉換程式要注意這個差異，不能直接套用 `tdx2gtfs_metro.py` 的 `service_id_of()`。
- **台鐵 `Rail/TRA/Station`**：站點座標，正常。
- **台鐵 `Rail/TRA/DailyTrainTimetable/Today`**：**當天完整時刻表**，每班車有明確到站/離站時間，資料品質最好，但只能拿「今天」或指定日期，不是一份固定時刻表樣板——换算 GTFS 時要注意：平日/假日班次不同，要抓多個代表日期（例如一個平日＋一個週末）才能覆蓋完整服務模式，不能只抓一天當全部。
- **台北市公車路線數量大**（光是前 3 筆就看到數千條路線的量級），全部抓取會消耗大量 TDX 呼叫額度與時間。**試算階段建議**：只抓經過 3 間試算影城 2 公里內的路線（用站點座標過濾，而不是一次抓全部台北市公車）。

## Actions 的侷限（已驗證）

- `gh workflow run` 在這個 Claude Code 環境會先查 GraphQL 找預設分支，而 CCR proxy 擋 GraphQL（HTTP 403）。**改用** `gh api repos/{owner}/{repo}/actions/workflows/{file}/dispatches -X POST -f ref=main` 觸發。
- `gh secret list/set` 一樣被 CCR proxy 擋（HTTP 403），**金鑰只能請使用者自己到網頁設定**。
- Actions 產生的 **artifact 下載不了**：`gh run download` 會去抓 `productionresultssa17.blob.core.windows.net`，被這個環境的對外連線白名單擋下（`connect_rejected`）。**要檢查 Actions 算出來的內容，一律用 `cat`／`echo` 印到一般 log 裡**（用 `gh run view --log` 抓），不要依賴上傳 artifact 下載回來看。真的需要大檔案才用 artifact（給使用者電腦下載，不是給這個環境用）。
- 寫 workflow YAML 時，**絕對不要在 `run: |` 區塊裡內嵌多行、且縮排比 run 內容淺的 heredoc**（例如直接寫一段 0 縮排的 Python），YAML 區塊純量會把這些行當成文件結束，導致整份 YAML 解析錯誤、GitHub 還會把 workflow 名稱顯示成檔名（這是「parse 失敗」的徵兆，要留意）。改法：寫成獨立 `.py` 檔用 `python3 path/to/script.py` 呼叫。
- 每次改完 workflow，**先在本機跑 `python3 -c "import yaml; yaml.safe_load(open('xxx.yml'))"` 驗證語法再推送**，可以少跑很多次 Actions 來回除錯。

## 不要做的事

- 不要用任何會收到使用者位置的線上路線服務（Google Routes、OSRM 公共伺服器、Mapbox…）。
- 不要放寬 CSP。
- 不要在 repo 內跑 mock（會蓋掉真實資料），也不要短時間連跑威秀。
- 不要代使用者註冊帳號或輸入金鑰。
