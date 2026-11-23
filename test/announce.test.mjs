// 公告文字解析測試：node test/announce.test.mjs
// 句子都取自真實官網（美麗華、美麗新）或常見寫法
import assert from 'node:assert/strict';
import { extractRules, parseTime } from '../scrape/announce.mjs';

const now = { date: '2026-11-24', time: '10:00', y: 2026, m: 11 };
let n = 0;
const t = (name, fn) => { try { fn(); n++; console.log('✓', name); } catch (e) { console.error('✗', name, '\n  ', e.message); process.exitCode = 1; } };

t('parseTime 各種寫法', () => {
  assert.equal(parseTime('18:00'), '18:00');
  assert.equal(parseTime('下午6點半'), '18:30');
  assert.equal(parseTime('晚上8點'), '20:00');
  assert.equal(parseTime('下午18:00'), '18:00');
  assert.equal(parseTime('中午12點'), '12:00');
  assert.equal(parseTime('上午9點30分'), '09:30');
});

t('美麗華：某月某日（週）幾點後開放＋日期範圍', () => {
  const r = extractRules('開放場次訂票時間\n美麗華影城開放訂票重要公告\n11/24（二）18:00後開放\n11/26-12/03 數位版、Dolby Cinema、IMAX場次，官網，APP及現場購票服務', now);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].kind, r[0].at, r[0].rangeFrom, r[0].rangeTo], ['once', '2026-11-24T18:00', '2026-11-26', '2026-12-03']);
});

t('美麗新：週一／週二／週三 18:00 後公布（三條每週規則）', () => {
  const r = extractRules('♦週五上映之電影，於當週三下午18:00後公布場次，開放當週五至下週四之場次訂購票。♦週三上映之電影，於當週一下午18:00後公布場次，開放當週三及週四之場次訂購票。♦週四上映之電影，於當週二下午18:00後公布場次，開放當週四之場次訂購票。', now);
  assert.deepEqual(r.map((x) => [x.kind, x.dow, x.time]).sort(), [['weekly', 1, '18:00'], ['weekly', 2, '18:00'], ['weekly', 3, '18:00']]);
});

t('樂聲：每日場次最晚於前一天 20:00 前公布', () => {
  const r = extractRules('每日場次最晚將於前一天 20:00 前公布並開放訂票', now);
  assert.deepEqual(r.map((x) => [x.kind, x.time]), [['daily', '20:00']]);
});

t('每週三下午更新場次', () => {
  const r = extractRules('場次每週三下午3點更新', now);
  assert.deepEqual(r.map((x) => [x.kind, x.dow, x.time]), [['weekly', 3, '15:00']]);
  const r2 = extractRules('每週三 15:00 更新下週場次', now);
  assert.deepEqual(r2.map((x) => [x.kind, x.dow, x.time]), [['weekly', 3, '15:00']]);
});

t('跨年：12月底公告 1/3 開放', () => {
  const r = extractRules('1/3（五）12:00 開放購票場次', { date: '2026-12-28', time: '10:00', y: 2026, m: 12 });
  assert.equal(r[0].at, '2027-01-03T12:00');
});

t('不相關的句子不誤判', () => {
  assert.equal(extractRules('每週三 15:00 員工會議 開放參觀', now).length, 0);
  assert.equal(extractRules('11/24 營業時間 10:00 開放入場', now).length, 0);
  assert.equal(extractRules('', now).length, 0);
});

console.log(`\n${n} 項通過`);
