// 追蹤場次通知的測試：node test/watch.test.mjs
// 1) docs/watch-core.js 的比對規則（地區、日期、時段、午夜場、新場次判斷、已結束）
// 2) docs/sw.js 的背景檢查（在 vm 裡用假的 Service Worker 環境跑，資料用 docs/data.json，只讀不寫）
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
// watch-core.js 是給瀏覽器用的一般 script（不是 ES module），用 vm 載入，跟瀏覽器、Service Worker 的載入方式一致
const loadCore = () => { const self = {}; vm.runInNewContext(fs.readFileSync(new URL('../docs/watch-core.js', import.meta.url), 'utf8'), { self, Date, Math, Set, Map, JSON, Promise }); return self.WatchCore; };
const WC = loadCore();

const eqj = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b)); // 跨 vm 的陣列不能直接 deepEqual
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ok', name); };
const at = (s) => new Date(s); // 本地時間
const cinemas = [
  { id: 'a', name: '台北甲影城', city: '台北市' },
  { id: 'b', name: '新北乙影城', city: '新北市' },
  { id: 'c', name: '台中丙影城', city: '台中市' },
];
const sh = (cinema, date, time, format = '數位', movie = 'm1') => ({ cinema, movie, date, time, format });
const base = (o = {}) => ({ id: 'w1', movie: 'm1', title: '測試片', area: '全台', dates: [], from: '', to: '', seen: [], newKeys: [], ...o });
const now = at('2026-11-24T12:00:00');

ok('只符合指定電影、地區', () => {
  const shows = [sh('a', '2026-11-24', '15:00'), sh('b', '2026-11-24', '15:00'), sh('a', '2026-11-24', '16:00', '數位', 'm2')];
  assert.equal(WC.matching(base({ area: '台北市' }), shows, cinemas, [], now).length, 1);
  assert.equal(WC.matching(base({ area: '全台' }), shows, cinemas, [], now).length, 2);
  assert.equal(WC.matching(base({ area: 'fav' }), shows, cinemas, ['b'], now).length, 1);
  assert.equal(WC.matching(base({ area: 'fav' }), shows, cinemas, [], now).length, 0);
});
ok('已開演場次不算，明天的算；午夜場（0–3 點）算今晚', () => {
  const shows = [sh('a', '2026-11-24', '11:00'), sh('a', '2026-11-24', '13:00'), sh('a', '2026-11-25', '09:00'), sh('a', '2026-11-24', '00:30')];
  const m = WC.matching(base(), shows, cinemas, [], now).map(s => s.date + ' ' + s.time);
  eqj(m.sort(), ['2026-11-24 00:30', '2026-11-24 13:00', '2026-11-25 09:00']);
});
ok('日期：空＝今天以後都算；有指定則只算指定日', () => {
  const shows = [sh('a', '2026-11-23', '20:00'), sh('a', '2026-11-25', '10:00'), sh('a', '2026-11-26', '10:00')];
  assert.equal(WC.matching(base(), shows, cinemas, [], now).length, 2);
  assert.equal(WC.matching(base({ dates: ['2026-11-26'] }), shows, cinemas, [], now).length, 1);
});
ok('時段：從／到、午夜場排在最後', () => {
  const d = '2026-11-25';
  const shows = ['09:00', '12:00', '18:00', '21:30', '00:20'].map(t => sh('a', d, t));
  const t = w => WC.matching(base(w), shows, cinemas, [], now).map(s => s.time).sort();
  eqj(t({ from: '18:00' }), ['00:20', '18:00', '21:30']);
  eqj(t({ to: '12:00' }), ['09:00', '12:00']);
  eqj(t({ from: '12:00', to: '21:30' }), ['12:00', '18:00', '21:30']);
});
ok('建立時已符合的算已看過，之後新增的才是新場次', () => {
  const w = base({ area: '台北市' });
  const shows = [sh('a', '2026-11-25', '10:00'), sh('a', '2026-11-25', '12:00')];
  WC.markSeen(w, WC.matching(w, shows, cinemas, [], now));
  let r = WC.refresh(w, { showtimes: shows, cinemas }, [], now);
  assert.equal(r.fresh.length, 0); assert.equal(w.newKeys.length, 0);
  shows.push(sh('a', '2026-11-26', '20:00'), sh('b', '2026-11-26', '20:00')); // 後者不在地區
  r = WC.refresh(w, { showtimes: shows, cinemas }, [], now);
  assert.equal(r.fresh.length, 1); eqj(w.newKeys, ['a|2026-11-26|20:00|數位']);
  r = WC.refresh(w, { showtimes: shows, cinemas }, [], now); // 再比對一次：不重複通知
  assert.equal(r.fresh.length, 0); assert.equal(w.newKeys.length, 1);
  WC.markSeen(w, []); assert.equal(w.newKeys.length, 0); // 看過之後清空
  r = WC.refresh(w, { showtimes: shows, cinemas }, [], now);
  assert.equal(r.fresh.length, 0);
});
ok('場次暫時消失再出現不算新場次（已看過的會記住）', () => {
  const w = base();
  const shows = [sh('a', '2026-11-25', '10:00'), sh('a', '2026-11-25', '12:00')];
  WC.markSeen(w, WC.matching(w, shows, cinemas, [], now));
  WC.refresh(w, { showtimes: [shows[0]], cinemas }, [], now);
  const r = WC.refresh(w, { showtimes: shows, cinemas }, [], now);
  assert.equal(r.fresh.length, 0);
});
ok('日期全過期＝已結束，不再比對', () => {
  const w = base({ dates: ['2026-11-20', '2026-11-23'] });
  assert.equal(WC.expired(w, now), true);
  const r = WC.refresh(w, { showtimes: [sh('a', '2026-11-20', '10:00')], cinemas }, [], now);
  assert.equal(r.matches.length, 0); assert.equal(r.fresh.length, 0);
  assert.equal(WC.expired(base({ dates: ['2026-11-20', '2026-11-30'] }), now), false);
});
ok('通知文字：標題與前 3 場', () => {
  const w = base();
  const f = ['10:00', '11:00', '12:00', '13:00'].map(t => sh('a', '2026-11-28', t));
  const t = WC.noteText(w, f, { a: cinemas[0] });
  assert.equal(t.title, 'Reeltime：《測試片》有 4 個新場次');
  assert.equal(t.body.split('\n')[0], '11/28（六）10:00 台北甲影城');
  assert.equal(t.body.split('\n').length, 4);
});
ok('條件摘要', () => {
  assert.equal(WC.summary(base({ area: '台北市', dates: ['2026-11-29', '2026-11-28'], from: '18:00' })), '台北市・11/28、11/29・18:00 後');
  assert.equal(WC.summary(base({ area: 'fav' })), '常用影城・日期不限・時段不限');
});

/* ---- Service Worker：用假環境跑 periodicsync ---- */
const data = JSON.parse(fs.readFileSync(new URL('../docs/data.json', import.meta.url), 'utf8'));
const today = WC.ymd(new Date());
const mv = data.showtimes.find(s => s.date >= today);
const swSrc = fs.readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8');
const coreSrc = fs.readFileSync(new URL('../docs/watch-core.js', import.meta.url), 'utf8');
async function runSW(watches, favs, dataObj) {
  const store = { watches: JSON.parse(JSON.stringify(watches)), favs };
  const notes = [], handlers = {}, fetched = [];
  const self = {
    registration: { scope: 'https://example.test/', showNotification: async (t, o) => { notes.push({ t, o }) } },
    clients: { matchAll: async () => [], openWindow: async () => {}, claim: async () => {} },
    skipWaiting() {}, addEventListener: (k, f) => { handlers[k] = f },
  };
  const ctx = vm.createContext({
    self, URL, JSON, Date, Math, Promise, Object, Array, Set, Map, String, Number,
    fetch: async (u) => { fetched.push(String(u)); return { ok: true, json: async () => dataObj } },
    importScripts: () => { vm.runInContext(coreSrc, ctx); },
  });
  ctx.self.self = self;
  vm.runInContext(swSrc, ctx);
  // 假的 IndexedDB（背景程式用的儲存）
  self.WatchCore.idbGet = async k => store[k]; self.WatchCore.idbSet = async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)) };
  let p; await handlers.periodicsync({ tag: 'twc-watch', waitUntil: x => { p = x } }); await p;
  return { notes, store, fetched };
}
const tpl = (o) => ({ id: 'wx', movie: data.showtimes[0].movie, title: '實測片', area: '全台', dates: [], from: '', to: '', seen: [], newKeys: [], created: 0, ...o });
{
  const movie = tpl().movie;
  const base0 = tpl({});
  const matches = WC.matching(base0, data.showtimes, data.cinemas, [], new Date());
  console.log('  （實測資料：' + matches.length + ' 場符合「' + movie + '」）');
  assert.ok(matches.length >= 5, '資料裡這部片至少要有 5 場才能實測');
  const w = tpl({}); WC.markSeen(w, matches);
  const r1 = await runSW([w], [], data);
  ok('sw.js：沒有新場次就不通知，只抓自己網站的 data.json', () => {
    assert.equal(r1.notes.length, 0);
    eqj(r1.fetched, ['https://example.test/data.json']);
  });
  const w2 = tpl({}); const drop = matches.slice(0, 3); WC.markSeen(w2, matches.slice(3));
  const r2 = await runSW([w2], [], data);
  ok('sw.js：3 場沒看過 → 跳 1 則通知「有 3 個新場次」，newKeys 寫回', () => {
    assert.equal(r2.notes.length, 1);
    assert.match(r2.notes[0].t, /有 3 個新場次$/);
    assert.equal(r2.store.watches[0].newKeys.length, 3);
    assert.equal(r2.notes[0].o.data.url, './#/watch');
  });
  const r3 = await runSW(r2.store.watches, [], data);
  ok('sw.js：再檢查一次不重複通知', () => { assert.equal(r3.notes.length, 0); assert.equal(r3.store.watches[0].newKeys.length, 3); });
}
console.log('全部通過（' + n + ' 項）');
