// 執行所有影城爬蟲 → 合併 → 輸出 docs/data.json
// 單一影城失敗時沿用上次成功的資料，不會讓整份資料消失。
import fs from 'node:fs/promises';
import path from 'node:path';
import { taipei, addDays, normTitle, sleep } from './util.mjs';
import * as showtimes from './chains/showtimes.mjs';
import * as vieshow from './chains/vieshow.mjs';
import * as ambassador from './chains/ambassador.mjs';
import * as miramar from './chains/miramar.mjs';
import * as century from './chains/century.mjs';
import * as skcinemas from './chains/skcinemas.mjs';
import * as in89 from './chains/in89.mjs';
import * as lux from './chains/lux.mjs';
import * as miranew from './chains/miranew.mjs';

// 順序 = 合併電影資訊時的優先順序（海報、簡介等取第一個有值的）
const CHAINS = [showtimes, vieshow, ambassador, miramar, miranew, century, skcinemas, in89, lux];
const OUT = path.resolve('docs');
const RAW = path.join(OUT, 'raw');

const only = process.argv.slice(2);
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619); return (h >>> 0).toString(36); };

async function readJSON(p) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; } }

async function main() {
  await fs.mkdir(RAW, { recursive: true });
  const nowISO = new Date().toISOString();
  const status = [];
  const raws = [];

  // 抓一家影城；成功就存檔並回傳 true，失敗回傳錯誤訊息
  async function attempt(c, file) {
    const t0 = Date.now();
    try {
      const r = await c.scrape();
      if (!r.shows.length) throw new Error('沒有抓到任何場次（官網可能改版或擋連線）');
      const rec = { chain: c.chain, fetchedAt: nowISO, data: r };
      await fs.writeFile(file, JSON.stringify(rec));
      raws.push({ c, ...rec });
      status.push({ chain: c.chain, ok: true, fetchedAt: nowISO, cinemas: r.cinemas.length, shows: r.shows.length });
      console.log(`  ✓ ${r.cinemas.length} 影城 / ${r.movies.length} 電影 / ${r.shows.length} 場次（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
      return true;
    } catch (e) {
      console.error(`  ✗ ${e.message}`);
      return String(e.message);
    }
  }

  async function giveUp(c, file, msg) {
    const prev = await readJSON(file);
    if (prev) raws.push({ c, ...prev });
    status.push({ chain: c.chain, ok: false, error: msg.slice(0, 200), fetchedAt: prev?.fetchedAt || null });
  }

  // 第一輪：依序抓每一家；失敗的先記下來，等其他家跑完再重試一次
  const failed = [];
  for (const c of CHAINS) {
    const file = path.join(RAW, `${hash(c.chain)}.json`);
    if (only.length && !only.includes(c.chain)) { const prev = await readJSON(file); if (prev) raws.push({ c, ...prev }); continue; }
    console.log(`▶ ${c.chain}`);
    const res = await attempt(c, file);
    if (res !== true) failed.push({ c, file, at: Date.now() });
  }

  // 第二輪：失敗的影城等一段時間後再試一次（威秀被暫時拒絕時通常幾分鐘後就恢復）
  // 等待時間由各影城檔的 retryDelayMs 決定，預設 1 分鐘；測試時可用環境變數 RETRY_WAIT_MS 縮短
  for (const f of failed) {
    const delay = process.env.RETRY_WAIT_MS !== undefined ? +process.env.RETRY_WAIT_MS : (f.c.retryDelayMs ?? 60_000);
    const wait = Math.max(0, f.at + delay - Date.now());
    console.log(`▶ ${f.c.chain}（重試${wait ? `，先等 ${Math.round(wait / 1000)} 秒` : ''}）`);
    if (wait) await sleep(wait);
    const res = await attempt(f.c, f.file);
    if (res !== true) await giveUp(f.c, f.file, res);
  }

  // 狀態維持原本影城順序（重試過的不會跑到最後）
  const order = (ch) => CHAINS.findIndex((c) => c.chain === ch);
  status.sort((a, b) => order(a.chain) - order(b.chain));

  const today = taipei().date;
  const movies = new Map(); // norm → movie
  const cinemas = [];
  const shows = [];

  for (const { c, data, fetchedAt } of raws) {
    const keyToId = {};
    for (const m of data.movies) {
      const n = normTitle(m.title);
      if (!n) continue;
      const id = 'm' + hash(n);
      keyToId[m.key] = id;
      const cur = movies.get(n) || { id, title: m.title, en: '', poster: '', runtime: 0, rating: '', genre: '', release: '', synopsis: '', chains: [] };
      for (const k of ['en', 'poster', 'runtime', 'rating', 'genre', 'release', 'synopsis']) if (!cur[k] && m[k]) cur[k] = m[k];
      if (!cur.chains.includes(c.chain)) cur.chains.push(c.chain);
      movies.set(n, cur);
    }
    for (const ci of data.cinemas) cinemas.push({ ...ci, chain: c.chain, fetchedAt });
    for (const s of data.shows) {
      if (s.date < today || !keyToId[s.movieKey] || !s.time) continue;
      const o = { cinema: s.cinema, movie: keyToId[s.movieKey], date: s.date, time: s.time };
      if (s.format) o.format = s.format;
      if (s.hall) o.hall = s.hall;
      if (s.url) o.url = s.url;
      if (s.seatsLeft !== undefined) o.seats = s.seatsLeft <= 0 ? 'out' : s.seatsLeft < 20 ? 'low' : 'open';
      shows.push(o);
    }
  }

  // 去除重複場次（同影城、同片、同時間、同版本）
  const seen = new Set();
  const uniq = shows.filter((s) => { const k = [s.cinema, s.movie, s.date, s.time, s.format].join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
  uniq.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  // 每間影城的公布狀況：已連續公布到哪天；有官方公告用官方，沒有則推估（每日滾動）
  const byCinema = new Map();
  for (const s of uniq) { if (!byCinema.has(s.cinema)) byCinema.set(s.cinema, new Set()); byCinema.get(s.cinema).add(s.date); }
  for (const ci of cinemas) {
    const ds = byCinema.get(ci.id) || new Set();
    let d = today; while (ds.has(d)) d = addDays(d, 1);
    const until = ds.size ? addDays(d, -1) : null;
    const presale = [...ds].filter((x) => until && x > until).length > 0;
    if (ci.publish?.official) ci.publish = { ...ci.publish, publishedUntil: until };
    else if (ci.publishRule === 'prevDay2000') {
      // 官方規則：每天的場次最晚在前一天 20:00 公布
      const next = until ? addDays(until, 1) : addDays(today, 1);
      ci.publish = { publishedUntil: until, nextAt: `${addDays(next, -1)}T20:00`, rangeFrom: next, rangeTo: next, official: true };
    } else ci.publish = { publishedUntil: until, nextAt: addDays(today, 1), rangeFrom: until ? addDays(until, 1) : today, rangeTo: until ? addDays(until, 1) : today, estimated: true };
    delete ci.publishRule;
    ci.publish.presale = presale;
  }

  // 電影狀態：上映日在今天之後 → 即將上映；否則有場次才列為上映中
  const used = new Set(uniq.map((s) => s.movie));
  const outMovies = [];
  for (const m of movies.values()) {
    const soon = m.release && m.release > today;
    if (!soon && !used.has(m.id)) continue;
    outMovies.push({ ...m, status: soon ? 'soon' : 'now', presale: soon && used.has(m.id) });
  }

  const out = { updatedAt: nowISO, today, status: [...status, ...raws.filter((r) => !status.find((s) => s.chain === r.chain)).map((r) => ({ chain: r.chain, ok: true, fetchedAt: r.fetchedAt, cached: true }))], movies: outMovies, cinemas, showtimes: uniq };
  await fs.writeFile(path.join(OUT, 'data.json'), JSON.stringify(out));
  console.log(`\n完成：${outMovies.length} 部電影、${cinemas.length} 間影城、${uniq.length} 個場次`);
  if (!status.some((s) => s.ok) && !only.length) process.exitCode = 1;
}

main();
