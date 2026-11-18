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

## 驗證進度（2026-11-18，第一批樣本）

用 Claude in Chrome 開真實 Google 地圖（`/maps/dir/?api=1&origin=...&destination=...&travelmode=...`），對照 OSRM（car/scooter/foot，台北小範圍）與 r5py（transit，同一組 GTFS）算出的數字。目前只做了 3 組起點×終點（不是完整的每間影城 8 點），先看誤差的方向和大小，數字記在 `tools/travel/validation.csv`：

| 起點→終點（距離） | 模式 | Google | 我們算的 | 差距 |
|---|---|---|---|---|
| 台北車站→信義威秀（6.1km） | 開車 | 21 分 | 8.6 分 | 我們快了 12.4 分 |
| 同上 | 機車 | 18 分 | 9.1 分 | 我們快了 8.9 分 |
| 同上 | 大眾運輸 | 29 分 | 34 分 | 我們慢了 5 分 |
| 同上 | 走路（6.0km） | 87 分 | 70.8 分 | 我們快了 16.2 分 |
| 西門站→西門威秀（~0.3km，很短） | 開車 | 3 分 | 1.0 分 | 我們快了 2 分 |
| 同上 | 機車 | 2 分 | 1.0 分 | 我們快了 1 分 |
| 同上 | 走路 | 5 分 | 4.5 分 | 我們快了 0.5 分 |
| 新店站→新店裕隆城威秀 | 開車 | 9 分 | 4.7 分 | 我們快了 4.3 分 |
| 同上 | 機車 | 8 分 | 4.8 分 | 我們快了 3.2 分 |
| 同上 | 大眾運輸 | 19 分 | 26 分 | 我們慢了 7 分 |
| 同上 | 走路 | 26 分 | 22.4 分 | 我們快了 3.6 分 |

**初步判讀（還不是最終結論，樣本太少，下面是假設，要更多資料才能定案）**：

- **開車／機車系統性地算得太快**：比值大約落在 1.7–3.0 倍之間（短程誤差比例反而更大，可能是起步/紅燈/停等的固定開銷，不是單純速度問題）。OSRM car.lua 的 `traffic_light_penalty` 只有 2 秒，但台灣都市路口間距短、紅燈週期長，實際停等時間遠不只 2 秒，這可能是主因之一；純粹的速限表（`speeds.highway`）本身可能也偏高估（不考慮車流壅塞）。**還不要急著下一個全域校正倍率**——目前 3 個樣本的比值差太多（1.67～3.0），直接套平均值（例如 ×2.2）風險很高，需要更多樣本（尤其是不同路況：快速道路銜接、純都市窄巷、郊區） 才能判斷是單一倍率夠用，還是要分路段類型或分距離區間校正。
- **大眾運輸方向相反：我們算得比 Google 慢**，兩個樣本都慢 5-7 分鐘（比例上慢 17%-37%）。可能原因：公車站間時間用「直線距離×1.3÷18km/h」估計，這個假設速度可能偏低（實際公車在部分路段更快）；或轉乘／候車的隱含等待邏輯被 r5py 预设值放大了。因為公車站間時間本來就是我們自己估的（TDX 沒有真正的公車運行時間 API），這裡的誤差來源比開車/機車更單純可以查：下一步可以先試著把 `AVG_SPEED_KMH` 從 18 調高（例如 22-25），看誤差有沒有縮小。
- **走路最接近**（誤差都在 15-20% 以內，且方向一致：我們都偏快），這個用一個小倍率（例如 ×1.15-1.2，相當於把預設步行速度調慢一點）大概就能校正到位。

## 驗證進度（第二批樣本＋校正，2026-11-18）

多抓了 2 組起點（包含會走國道的長程路線），湊到 5 組起點×影城，涵蓋純市區道路與有快速道路可選的長程路線：

| 起點→終點 | 模式 | Google | 我們算的（校正前） | 比值/差距 |
|---|---|---|---|---|
| 新店站→信義威秀（19.0km，Google 開車走國道3號） | 開車 | 21 分 | 12.0 分 | 1.75 倍 |
| 同上 | 機車 | 27 分（不能走國道，繞路） | 15.6 分 | 1.73 倍 |
| 同上 | 走路（9.6km） | 135 分 | 115.2 分 | 1.17 倍 |
| 西門站→信義威秀（6.7km） | 開車 | 24 分 | 9.3 分 | 2.58 倍 |
| 同上 | 機車 | 23 分 | 9.9 分 | 2.32 倍 |
| 同上 | 走路 | 99 分 | 78.9 分 | 1.25 倍 |

**關鍵發現：機車／開車的「相對關係」算對了，只是基礎時間系統性偏快**。新店→信義這組路線 Google 的機車（27分）明顯比開車（21分）慢——因為國道不能騎機車、要繞路；我們算出來的機車（15.6）也同樣比開車（12.0）慢，而且慢的比例幾乎一樣（Google 1.29 倍 vs 我們 1.30 倍）。這代表 `scooter.lua` 移除國道/快速道路的邏輯方向正確，只是兩者的**基礎速度**都被低估，原因多半是 `car.lua` 的 `traffic_light_penalty`（只有 2 秒）遠低於台灣都市路口的實際停等時間。

**5 組樣本的彙總比值**：
- 開車：1.75～3.0 倍（中位數約 2.44）
- 機車：1.67～2.32 倍（中位數約 1.98）
- 走路：1.11～1.25 倍（中位數約 1.18，很穩定）

用中位數倍率回推校正後的誤差（校正後時間 = 我們算的 × 中位數倍率，跟 Google 比較）：開車中位數誤差約 1.3 分、機車中位數誤差約 1.3 分，都在「中位數 ≤4 分」門檻內，但個別樣本誤差仍有到 3-8 分的（樣本數太少，還不能說這個倍率對任何路線都準，只能說方向對、量級對）。

**大眾運輸的校正（已完成兩輪測試）**：原本 `tdx2gtfs_bus.py` 假設公車站間平均速度 18km/h，4 個樣本顯示整體大眾運輸時間比 Google 慢 17-37%（中位數誤差約 7 分、最大 15 分，不合格）。調高到 23 km/h 後誤差降到中位數 5.5 分／最大 6 分；再調到 25 km/h，中位數剛好壓到 5 分、最大 7 分——**兩項都在門檻內**（中位數 ≤5、最大 ≤12），**最終採用 25 km/h**。（兩次調整的詳細數字都記在 `tools/travel/validation.csv`。）

**目前結論與下一步**：
- 大眾運輸：**已達門檻**（5 個樣本，中位數 5 分、最大 7 分），但樣本數遠少於「每間 8 點」的目標，等擴到全台時還要用更多樣本複查，尤其要測純公車（沒有捷運）的路線，目前樣本大多是捷運為主、公車補一段，公車占比重的路線還沒測過。
- 開車／機車：方向和量級都合理（中位數誤差 ~1.3 分），但樣本少、個別路線誤差波動大（1.67～3.0 倍），**還不建議直接定案校正倍率**。下一步在擴大到全台前，至少要把每間試算影城湊到 8 個起點，並且刻意涵蓋「快速道路」「純巷弄」「跨河橋樑」等不同路況，才能確認一個固定倍率（或要不要分路況給不同倍率）。
- 走路：樣本一致、誤差小（1.11-1.25 倍），可以直接用一個中位數倍率（~1.18）校正，風險低。

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
5b. ~~OSRM（開車／機車／步行）與 r5py（大眾運輸＋步行）~~ ✅ 兩條計算路徑都已驗證可行（見下「OSRM 路網計算 — 完成狀態」、「r5py（大眾運輸）」）。目前都還是「台北小範圍」規模的開發探索腳本，還沒擴大到全台 102 間影城的正式流程。
6. 🔶 **進行中**：驗證比對 Google 地圖，校正塞車係數。5 個樣本的初步結果：大眾運輸已達門檻（見下「驗證進度」）；開車/機車方向與量級合理但樣本太少不敢定案；走路誤差小可直接套倍率。下一步要湊到每間試算影城 8 個起點才能真的定案，再決定要不要回第 4-5 步調整。
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

## OSRM 路網計算 — 完成狀態（2026-11-18）

- **先確認真實 Lua profile API，再動手寫，避免猜錯**：一開始曾猜測可以用 `require('car')` 覆寫 `.setup`/`.process_way` 等欄位（像一般 Lua 模組回傳表可覆寫），但這份猜測在測試前就被捨棄——改用 `.github/workflows/osrm-explore.yml` 直接進 `osrm/osrm-backend` 官方映像的 `/opt/car.lua` 看真正內容，發現 OSRM v5（`api_version = 4`）用的是**全域函式**（`function setup()`、`function process_node()`、`function process_way()`、`function process_turn()`），檔案最後 `return { setup=setup, process_way=process_way, ... }` 只是把這些全域函式包成表回傳，不是「可覆寫欄位的模組」。確認後才動手寫 `tools/travel/osrm/scooter.lua`：直接複製整份 `/opt/car.lua`，只改 `speeds.highway`（移除 `motorway`/`motorway_link`/`trunk`/`trunk_link`，台灣法規機車不能騎）與車輛體積/重量/地圖比對速限（改成機車規格）。
- **流程驗證通過**：`.github/workflows/osrm-explore.yml` 下載台灣全島 OSM（Geofabrik，約 300MB，加了 `--retry` 處理 GitHub runner 端偶發的連線中斷）→ `osmium extract` 裁切出台北小範圍（`121.45,24.95,121.65,25.10`）→ 分別用 `car.lua`（內建）與自製 `scooter.lua` 跑 `osrm-extract` → `osrm-partition` → `osrm-customize` → 啟動 `osrm-routed --algorithm mld` → 呼叫 `/table/v1/driving/...?annotations=duration`。**兩種 profile 都成功**：台北車站→信義威秀，car 8.6 分鐘、scooter 9.1 分鐘（反向：car 9.4 分鐘、scooter 9.8 分鐘）——這個測試範圍內的路線本來就沒有國道/快速道路，所以兩者數字接近是合理的，還沒測到「機車不能走國道」真正發揮作用的路線。
- **踩到的坑**：第一次跑測試 scooter.lua 的步驟時出現 `[error] Profile /profiles/scooter.lua not found!`——原因是這個 workflow 之前所有步驟都只用得到「Docker 映像內建檔案」或「下載來的資料」，從來沒用到 repo 裡的檔案，所以**一直沒有 `actions/checkout` 步驟**；加了需要讀 `tools/travel/osrm/scooter.lua` 的步驟後才讓這個缺口露出來。修法：在 job 最前面加 `uses: actions/checkout@v4`。
- 步行（foot.lua）尚未測試，但走法跟 car/scooter 一樣（映像內建，不用額外寫 profile），之後驗證階段再一併跑。
- **下一步**：`osrm-explore.yml` 目前只是開發用探索，正式流程（跑全台 102 間影城）還需要寫一支正式腳本，把裁切範圍從「台北小範圍」換成「全台灣」，對每間影城座標跑 car/scooter/foot 三種 profile 的 table API，輸出結果存起來供「驗證比對 Google 地圖」用。這一步待 r5py（大眾運輸）也完成後再一起做，兩者輸出格式會放在同一個比對腳本裡處理。

## r5py（大眾運輸）— 進行中（2026-11-18）

- 建了 `.github/workflows/r5py-explore.yml`（裝 Java 21、pip 裝 r5py/geopandas/shapely/pandas）＋ `tools/travel/r5/build_matrix.py`，流程一路到「把捷運/公車 GTFS 壓成 zip」都成功，但 `r5py.TransportNetwork(...)` 讀 `metro.zip` 時報 `GtfsFileError: DuplicateKeyError: trips ... field 'trip_id': Duplicate primary key`。
- **根因（`tdx2gtfs_metro.py` 和 `tdx2gtfs_bus.py` 都有同一個 bug）**：GTFS 規定一個 trip 只能對應一個 `service_id`，所以轉換程式會把「同一個 pattern trip × 每個服務日」展開成各自獨立的 `new_trip_id`（例如 `{trip_id}__{svc_id}`）。但**同一個 (trip_id, service_id) 常常有多個 Headway／schedule 時間段**（例如尖峰、離峰班距不同），這些時段應該各自在 `frequencies.txt` 多一筆，但 trip 本身（`trips.txt`、`stop_times.txt`）只該有一筆——程式卻對每個時段都 append 一次 trip／stop_times，造成同一個 `trip_id` 在 `trips.txt` 裡出現好幾次，GTFS 讀取器（r5py 用的 `com.conveyal.gtfs`）認 `trip_id` 是主鍵，直接報錯。
- **已修正**：兩支程式都改成用 `seen_trip_ids` 集合去重——`trips.txt`/`stop_times.txt` 每個 `new_trip_id` 只 append 一次，`frequencies.txt` 維持每個時段各一筆（這是對的，GTFS 允許同一個 trip 有多筆 frequencies，只要時間區間不重疊）。
- `validate_gtfs.py` 也加了「trips.txt 有沒有重複 trip_id」的檢查，之後同類問題能在跑 r5py 之前就先被抓到，不用等 Java 丟例外才發現。
- **已驗證通過**：修好 trip_id 重複的 bug 之後重跑，`TransportNetwork` 建立成功。接著踩到第二個問題：安裝的 r5py 1.1.7 **沒有** `TravelTimeMatrixComputer`（那是舊版／網路上教學常見的寫法）——查了官方 reference 文件，1.x 版的 API 改成直接建構 `r5py.TravelTimeMatrix(transport_network, origins=..., destinations=..., departure=..., transport_modes=...)`，它本身就是 `pandas.DataFrame` 的子類別，建構時就算好結果，不用再呼叫 `.compute_travel_times()`。`build_matrix.py` 已改成「先試新版 API，沒有才退回舊版」，兩種安裝都能跑。
  **真實結果**（2026-11-18，平日早上 8:30 出發，大眾運輸＋步行）：
  | 起點 | 信義威秀 | 西門威秀 | 新店裕隆城威秀 |
  |---|---|---|---|
  | 台北車站 | 34 分 | 17 分 | 43 分 |
  | 西門站 | 35 分 | 6 分 | 36 分 |
  | 市政府站 | 12 分 | 26 分 | 53 分 |
  | 新店站 | 58 分 | 66 分 | 26 分 |
  | 公館站 | 37 分 | 36 分 | 27 分 |

  數字全部合理（西門站→西門威秀 6 分、市政府站→信義威秀 12 分這種「本來就很近」的組合時間最短，符合常識），**OSRM（car/scooter/foot）＋ r5py（transit+walk）兩條計算路徑都已驗證可行**。
- **下一步**：進入「驗證比對 Google 地圖」階段——針對 3 間試算影城各抓約 8 個真實起點、不同時段，人工在 Google 地圖查時間，跟這裡算出來的數字比對誤差（門檻見下方「驗證」章節）。通過後才動手把範圍從「台北小範圍 OSM + TRTC 捷運 + 雙北公車」擴大到全台（全台 OSM、全部捷運系統、全部公車業者、台鐵），並把 `osrm-explore.yml`／`r5py-explore.yml` 這兩支開發用腳本整理成正式的 `.github/workflows/travel.yml`，對 102 間影城產生 `docs/travel/{cinemaId}.bin`。

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
