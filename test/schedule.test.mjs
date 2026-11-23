// 排程計算測試：node test/schedule.test.mjs
import assert from 'node:assert/strict';
import { buildTasks } from '../scrape/schedule.mjs';

const chains = new Set(['美麗華', '美麗新', '樂聲', '其他影城']);
const now = new Date('2026-11-24T04:00:00Z'); // 台北 2026-11-24 12:00
let n = 0;
const t = (name, fn) => { try { fn(); n++; console.log('✓', name); } catch (e) { console.error('✗', name, '\n  ', e.message); process.exitCode = 1; } };

t('過去的單次公告不排，未來的才排', () => {
  const { tasks } = buildTasks({ chains, now, announcements: [
    { chain: '美麗華', kind: 'once', at: '2026-11-24T10:00', text: 'a' },
    { chain: '美麗華', kind: 'once', at: '2026-11-24T18:00', text: 'b' },
  ] });
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].triggers.map((x) => x.at), ['2026-11-24T18:00']);
});

t('同連鎖多條規則合併成一個任務、相同的不重複', () => {
  const w = (dow) => ({ chain: '美麗新', kind: 'weekly', dow, time: '18:00', text: 'x' });
  const { tasks } = buildTasks({ chains, now, announcements: [w(3), w(1), w(2), w(3)] });
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].triggers.map((x) => x.dow), [1, 2, 3]);
  assert.deepEqual(tasks[0].triggers[0].offsets, [10, 45]);
});

t('* 代表全部連鎖（不指定 -Only），可自訂 offsets', () => {
  const { tasks } = buildTasks({ chains, now, rules: [{ chain: '*', kind: 'daily', time: '14:00', offsets: [0] }] });
  assert.deepEqual(tasks[0].chains, []);
  assert.deepEqual(tasks[0].triggers[0].offsets, [0]);
});

t('不認識的連鎖、格式錯誤的規則會被略過', () => {
  const r = buildTasks({ chains, now, announcements: [{ chain: '不存在影城', kind: 'daily', time: '10:00' }], rules: [{ chain: '樂聲', kind: 'daily', time: '8點' }] });
  assert.equal(r.tasks.length, 0);
  assert.equal(r.skipped.length, 2);
});

console.log(`\n${n} 項通過`);
