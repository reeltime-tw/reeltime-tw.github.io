// 電腦端推播比對測試：node test/push.test.mjs（不連網路、不送推播）
import assert from 'node:assert/strict';
import { loadWatchCore, plan } from '../scrape/push.mjs';

const WC = loadWatchCore();
const now = new Date('2026-11-24T10:00:00+08:00');
const cinemas = [{ id: 'c1', name: '台北信義威秀影城', city: '台北市' }, { id: 'c2', name: '台中大遠百威秀影城', city: '台中市' }];
const sh = (cinema, date, time) => ({ cinema, movie: 'm1', date, time, format: '數位' });
const device = { device: 'devAAAAAAAAAAAAAAAA', subscription: { endpoint: 'https://example.invalid/x', keys: { p256dh: 'a', auth: 'b' } },
  watches: [{ id: 'w1', movie: 'm1', title: '哥吉拉-0.0', area: '台北市', dates: ['2026-11-28'], from: '18:00', to: '', favs: [] }] };
let n = 0;
const t = (name, fn) => { try { fn(); n++; console.log('✓', name); } catch (e) { console.error('✗', name, '\n  ', e.message); process.exitCode = 1; } };

let state = {};
t('第一次看到追蹤：目前符合的算已通知，不送', () => {
  const data = { cinemas, showtimes: [sh('c1', '2026-11-28', '19:00')] };
  const r = plan({ WC, devices: [device], data, state, now });
  assert.equal(r.sends.length, 0);
  state = r.state;
});
t('新增符合的場次 → 送 1 則，內容正確；不符合的（台中、白天、別天）不算', () => {
  const data = { cinemas, showtimes: [sh('c1', '2026-11-28', '19:00'), sh('c1', '2026-11-28', '21:30'), sh('c2', '2026-11-28', '20:00'), sh('c1', '2026-11-28', '13:00'), sh('c1', '2026-11-29', '19:00')] };
  const r = plan({ WC, devices: [device], data, state, now });
  assert.equal(r.sends.length, 1);
  assert.equal(r.sends[0].n, 1);
  assert.match(r.sends[0].payload.title, /哥吉拉-0\.0.*1 個新場次/);
  assert.match(r.sends[0].payload.body, /21:30 台北信義威秀影城/);
  state = r.state;
});
t('同樣的資料再跑一次 → 不重複送', () => {
  const data = { cinemas, showtimes: [sh('c1', '2026-11-28', '19:00'), sh('c1', '2026-11-28', '21:30')] };
  assert.equal(plan({ WC, devices: [device], data, state, now }).sends.length, 0);
});
t('手機刪掉追蹤 → 狀態一起清掉', () => {
  const r = plan({ WC, devices: [{ ...device, watches: [] }], data: { cinemas, showtimes: [] }, state, now });
  assert.deepEqual(r.state[device.device], {});
});
console.log(`\n${n} 項通過`);
