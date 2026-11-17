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
| 喜樂時代 | ✅ | 該分店場次頁 |
| 國賓（含國賓大戲院） | ✅ | 國賓訂票首頁 |
| in89、樂聲、光點、誠品、南投戲院、美麗新其他分店 | 規劃中 | |

## 運作方式

GitHub Actions 每小時執行 `scrape/index.mjs` → 產生 `docs/data.json` → 連同 `docs/index.html` 發布到 GitHub Pages。
某一家官網暫時連不上時，會沿用該影城上一次成功抓到的資料。

## 第一次設定

1. 把這個資料夾推到你的 GitHub 專案（建議設為 Public，免費方案的 GitHub Pages 需要公開專案）
2. 專案頁面 → **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**
3. **Actions** 分頁 → 左邊「更新場次」→ **Run workflow** 手動跑第一次
4. 跑完後網址會顯示在 Settings → Pages，格式是 `https://你的帳號.github.io/專案名稱/`

> 注意：GitHub 會在專案 60 天沒有任何更新時自動暫停排程，屆時會寄信通知，點信裡的按鈕或到 Actions 頁面重新啟用即可。

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
