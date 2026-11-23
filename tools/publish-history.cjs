// 從每日資料歷史，歸納各影城「已公布到哪天」隨時間的變化，推出實際公布規律
const { execFileSync } = require('child_process');
const repo = process.argv[2] || require('path').resolve(__dirname, '..'); // 用法：node tools/publish-history.cjs
const commits = execFileSync('git', ['log', '--since=2026-11-18', '--format=%h|%aI|%s', '--', 'docs/data.json'], { cwd: repo, encoding: 'utf8' })
  .trim().split('\n').filter((l) => l.includes('update showtimes')).map((l) => l.split('|')).reverse();
// 每天只取當天最後一次快照
const byDay = new Map();
for (const [h, t] of commits) byDay.set(t.slice(0, 10), { h, t });
const snaps = [...byDay.values()].map(({ h, t }) => {
  const d = JSON.parse(execFileSync('git', ['show', `${h}:docs/data.json`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 }));
  return { day: t.slice(0, 10), t, d };
});
const WD = '日一二三四五六';
const md = (s) => s ? s.slice(5) + '(' + WD[new Date(s + 'T00:00:00Z').getUTCDay()] + ')' : '—';
console.log('快照日:', snaps.map((s) => s.day.slice(5) + '(' + WD[new Date(s.day + 'T00:00:00Z').getUTCDay()] + ')').join(' '));
const chains = [...new Set(snaps.at(-1).d.cinemas.map((c) => c.chain))];
for (const ch of chains) {
  const ids = snaps.at(-1).d.cinemas.filter((c) => c.chain === ch).map((c) => c.id);
  const pat = new Map();
  for (const id of ids) {
    const series = snaps.map((s) => { const c = s.d.cinemas.find((x) => x.id === id); return c?.publish?.publishedUntil || ''; });
    const k = series.map(md).join(' → ');
    if (!pat.has(k)) pat.set(k, []);
    pat.get(k).push(snaps.at(-1).d.cinemas.find((x) => x.id === id).name);
  }
  console.log(`\n## ${ch}（${ids.length} 間）`);
  for (const [k, names] of [...pat].sort((a, b) => b[1].length - a[1].length).slice(0, 4))
    console.log(`  [${names.length}間] ${k}\n     例：${names.slice(0, 2).join('、')}`);
}
