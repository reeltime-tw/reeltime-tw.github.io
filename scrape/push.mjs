// 推播：每次更新場次後執行。從推播伺服器讀取各手機的追蹤條件，用 docs/watch-core.js（與手機同一套規則）
// 比對最新場次，有新場次就透過 Apple／Google 推播服務送通知。
//
// 用法：node scrape/push.mjs          正常執行
//       node scrape/push.mjs --dry    只印出會送什麼，不送、不改狀態
//       node scrape/push.mjs --test   對所有已開啟推播的手機送一則測試通知
//
// 需要 windows/push-secrets.json（推播金鑰與伺服器管理金鑰，只存在這台電腦，不上傳）。
// 每支手機每筆追蹤「已通知過哪些場次」記在 windows/push-state.json（不上傳）。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRETS = path.join(ROOT, 'windows', 'push-secrets.json');
const STATE = path.join(ROOT, 'windows', 'push-state.json');
const args = process.argv.slice(2);
const DRY = args.includes('--dry'), TEST = args.includes('--test');

/** 載入手機也在用的比對規則（一般 script，用 vm 執行後取出 WatchCore） */
export function loadWatchCore() {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'docs', 'watch-core.js'), 'utf8'), ctx);
  return ctx.WatchCore;
}

/** 純函式：算出每支手機要送的通知，並回傳新的狀態（方便測試） */
export function plan({ WC, devices, data, state, now = new Date() }) {
  const byC = Object.fromEntries((data.cinemas || []).map((c) => [c.id, c]));
  const out = [], next = {};
  for (const d of devices) {
    const prev = state[d.device] || {};
    next[d.device] = {};
    for (const w of d.watches || []) {
      const rec = { ...w, seen: prev[w.id]?.seen, newKeys: [] };
      if (!prev[w.id]) {
        // 第一次看到這筆追蹤：目前符合的都算已通知（手機建立追蹤時也是這樣），之後新增的才通知
        WC.markSeen(rec, WC.matching(rec, data.showtimes || [], data.cinemas || [], w.favs || [], now));
      } else {
        const r = WC.refresh(rec, data, w.favs || [], now);
        if (r.fresh.length) {
          const t = WC.noteText(w, r.fresh, byC);
          out.push({ device: d.device, subscription: d.subscription, watch: w.id, n: r.fresh.length, payload: { title: t.title, body: t.body, tag: 'twc-' + w.id, url: './#/watch' } });
        }
        WC.markSeen(rec, r.matches); // 通知過（或目前符合）的都算已通知，不重複送
      }
      next[d.device][w.id] = { seen: rec.seen };
    }
  }
  return { sends: out, state: next };
}

async function main() {
  if (!fs.existsSync(SECRETS)) return console.log('推播：沒有 push-secrets.json，略過');
  const sec = JSON.parse(fs.readFileSync(SECRETS, 'utf8'));
  if (!sec.workerUrl) return console.log('推播：還沒設定推播伺服器網址，略過');
  webpush.setVapidDetails(sec.subject, sec.vapidPublic, sec.vapidPrivate);

  const r = await fetch(sec.workerUrl + '/all', { headers: { Authorization: 'Bearer ' + sec.adminToken } });
  if (!r.ok) throw new Error('讀取推播伺服器失敗 HTTP ' + r.status);
  const { devices } = await r.json();
  if (!devices.length) return console.log('推播：目前沒有手機開啟推播');

  const removeDevice = async (id) => { if (!DRY) await fetch(sec.workerUrl + '/all/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + sec.adminToken } }); };
  const send = async (sub, payload) => {
    try { await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 12 * 3600, urgency: 'normal' }); return 'ok'; }
    catch (e) { return e.statusCode === 404 || e.statusCode === 410 ? 'gone' : 'error ' + (e.statusCode || e.message); }
  };

  if (TEST) {
    for (const d of devices) {
      const res = DRY ? 'dry' : await send(d.subscription, { title: 'Reeltime 測試通知', body: '推播設定成功！之後追蹤的電影有新場次時，會像這樣通知你。', tag: 'twc-test', url: './#/watch' });
      console.log(`推播測試：裝置 ${d.device.slice(0, 6)}… → ${res}`);
      if (res === 'gone') await removeDevice(d.device);
    }
    return;
  }

  const WC = loadWatchCore();
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'data.json'), 'utf8'));
  let state = {};
  try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { /* 第一次執行 */ }
  const { sends, state: next } = plan({ WC, devices, data, state });

  let ok = 0, gone = 0, err = 0;
  for (const s of sends) {
    const res = DRY ? 'dry' : await send(s.subscription, s.payload);
    console.log(`推播：裝置 ${s.device.slice(0, 6)}… 《${s.payload.title.replace(/^.*《|》.*$/g, '')}》${s.n} 場 → ${res}`);
    if (res === 'ok' || res === 'dry') ok++;
    else if (res === 'gone') { gone++; await removeDevice(s.device); delete next[s.device]; }
    else { err++; if (state[s.device]?.[s.watch]) next[s.device][s.watch] = state[s.device][s.watch]; } // 送失敗：保留舊狀態，下次再送
  }
  if (!DRY) fs.writeFileSync(STATE, JSON.stringify(next));
  console.log(`推播：${devices.length} 支手機、${sends.length} 則通知（成功 ${ok}${gone ? `、失效移除 ${gone}` : ''}${err ? `、失敗 ${err}` : ''}）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.log('推播失敗：' + e.message); process.exitCode = 0; }); // 推播失敗不影響更新流程
}
