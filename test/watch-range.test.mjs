// 追蹤的「日期範圍」（dateFrom／dateTo）測試：node test/watch-range.test.mjs
import assert from 'node:assert/strict';
import { loadWatchCore } from '../scrape/push.mjs';

const W = loadWatchCore();
const now = new Date('2026-11-24T10:00:00+08:00');
const cinemas = [{ id: 'c1', city: '台北市', name: '台北信義威秀影城' }];
const sh = (date, time = '19:00') => ({ cinema: 'c1', movie: 'm', date, time });
const base = { movie: 'm', area: '台北市', from: '', to: '' };
const dates = (w, list) => Array.from(W.matching(w, list.map((d) => sh(d)), cinemas, [], now), (s) => s.date); // vm 產生的陣列要轉成本地陣列才能嚴格比較
let n = 0;
const t = (name, fn) => { try { fn(); n++; console.log('✓', name); } catch (e) { console.error('✗', name, '\n  ', e.message); process.exitCode = 1; } };

t('有開始與結束：只算範圍內', () => assert.deepEqual(dates({ ...base, dateFrom: '2026-11-26', dateTo: '2026-11-28' }, ['2026-11-25', '2026-11-26', '2026-11-28', '2026-11-29']), ['2026-11-26', '2026-11-28']));
t('只有開始：開始以後都算', () => assert.deepEqual(dates({ ...base, dateFrom: '2026-11-26' }, ['2026-11-25', '2026-11-30']), ['2026-11-30']));
t('只有結束：今天到結束', () => assert.deepEqual(dates({ ...base, dateTo: '2026-11-25' }, ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']), ['2026-11-24', '2026-11-25']));
t('結束日過了＝已結束', () => { assert.equal(W.expired({ dateTo: '2026-11-23' }, now), true); assert.equal(W.expired({ dateTo: '2026-11-24' }, now), false); });
t('舊格式（指定日期清單）照樣能用', () => assert.deepEqual(dates({ ...base, dates: ['2026-11-28'] }, ['2026-11-27', '2026-11-28']), ['2026-11-28']));
t('條件摘要', () => {
  assert.equal(W.summary({ ...base, dateFrom: '2026-11-26', dateTo: '2026-11-28' }), '台北市・11/26–11/28・時段不限');
  assert.equal(W.summary({ area: '全台', dateFrom: '2026-11-26', from: '18:00' }), '全台・11/26 起・18:00 後');
  assert.deepEqual(Array.from(W.summaryParts({ area: "fav", to: "12:00" })), ['常用影城', '日期不限', '12:00 前']);
});
console.log(`\n${n} 項通過`);
