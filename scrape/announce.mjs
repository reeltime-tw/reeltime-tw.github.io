// 公告爬蟲：讀各影城「官方網站」的公開頁面，找出「何時公布／開放場次」的說明
// 找到的時間會寫進 data/announcements.json，再由 scrape/schedule.mjs 轉成自動排程。
//
// 用法：node scrape/announce.mjs            全部來源
//       node scrape/announce.mjs 美麗新      只檢查指定連鎖（對應 scrape/chains 的 chain 名稱）
//       node scrape/announce.mjs --dry       只印結果，不寫檔
//
// 不處理 Facebook／Instagram／LINE：這些需要登入，自動抓取違反平台使用條款，也會被擋。
// 在粉絲專頁看到公告時，請手動寫進 data/publish-rules.json。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText, parseHTML, pool, sleep, text, abs, taipei, ymdFromMD, pad } from './util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'announcements.json');

/* ---------------- 從文字找出公布時間 ---------------- */

const CTX = /場次|時刻|訂票|購票|預售|售票|開賣/; // 附近要有這些字，才算跟場次有關
const ACT = '(?:開放|公布|公佈|開賣|上架|釋出|出爐|更新)';
const TIME = '((?:上午|早上|中午|下午|晚上|晚間)?\\s*\\d{1,2}\\s*(?:[:]\\s*\\d{2}|點\\s*(?:\\d{1,2}\\s*分?|半)?))';
const DOW = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

/** 「下午6點半」「18:00」→ "18:30" */
export function parseTime(s) {
  const m = String(s).match(/(上午|早上|中午|下午|晚上|晚間)?\s*(\d{1,2})\s*(?::\s*(\d{2})|點\s*(?:(\d{1,2})\s*分?|(半))?)/);
  if (!m) return '';
  let h = +m[2];
  const min = m[3] ? +m[3] : m[4] ? +m[4] : m[5] ? 30 : 0;
  if (/下午|晚上|晚間/.test(m[1] || '') && h < 12) h += 12;
  if (h > 24 || min > 59) return '';
  return `${pad(h % 24)}:${pad(min)}`;
}

/**
 * 從一段文字找出公布時間規則。回傳陣列，每筆是下列其中一種：
 *   { kind:'once',   at:'YYYY-MM-DDTHH:mm', rangeFrom?, rangeTo?, text }   某月某日幾點開放
 *   { kind:'weekly', dow:0-6, time:'HH:mm', text }                          每週幾幾點
 *   { kind:'daily',  time:'HH:mm', text }                                   每天（或前一天）幾點
 */
export function extractRules(raw, now = taipei()) {
  const t = String(raw).normalize('NFKC').replace(/[ \t ]+/g, ' ');
  const out = [];
  const near = (i, len) => t.slice(Math.max(0, i - 80), i + len + 120);
  const snip = (i, len) => t.slice(Math.max(0, i - 10), i + len + 30).replace(/\s+/g, ' ').trim();

  // 1) 11/24(二)18:00後開放　11月24日 下午6點 開放
  for (const m of t.matchAll(new RegExp(`(\\d{1,2})\\s*[/月]\\s*(\\d{1,2})\\s*日?\\s*(?:[(\\[][^)\\]]{0,6}[)\\]])?\\s*${TIME}\\s*(?:之?後|起|整|開始)?\\s*(?:正式\\s*)?${ACT}`, 'g'))) {
    if (!CTX.test(near(m.index, m[0].length))) continue;
    const time = parseTime(m[3]);
    if (!time || +m[1] < 1 || +m[1] > 12 || +m[2] < 1 || +m[2] > 31) continue;
    const r = { kind: 'once', at: `${ymdFromMD(+m[1], +m[2], now)}T${time}`, text: snip(m.index, m[0].length) };
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 60);
    const rg = after.match(/(\d{1,2})\s*[/月]\s*(\d{1,2})\s*日?\s*(?:[(\[][^)\]]{0,6}[)\]])?\s*[-~至到]\s*(?:(\d{1,2})\s*[/月]\s*)?(\d{1,2})/);
    if (rg) {
      r.rangeFrom = ymdFromMD(+rg[1], +rg[2], now);
      r.rangeTo = ymdFromMD(rg[3] ? +rg[3] : +rg[1], +rg[4], now);
    }
    out.push(r);
  }
  // 2) 每週三 18:00 公布場次
  for (const m of t.matchAll(new RegExp(`每\\s*(?:週|周|星期)\\s*([一二三四五六日天])[^。\\n]{0,14}?${TIME}[^。\\n]{0,10}?${ACT}`, 'g'))) {
    if (!CTX.test(near(m.index, m[0].length))) continue;
    const time = parseTime(m[2]);
    if (time) out.push({ kind: 'weekly', dow: DOW[m[1]], time, text: snip(m.index, m[0].length) });
  }
  // 3) 於當週三下午18:00後公布場次（美麗新的寫法）
  for (const m of t.matchAll(new RegExp(`(?:於|在)?\\s*(?:當|每|下)?\\s*(?:週|周|星期)\\s*([一二三四五六日天])\\s*${TIME}\\s*後?\\s*${ACT}\\s*場次`, 'g'))) {
    const time = parseTime(m[2]);
    if (time) out.push({ kind: 'weekly', dow: DOW[m[1]], time, text: snip(m.index, m[0].length) });
  }
  // 4) 每天 20:00 公布　前一天 20:00 前公布
  for (const m of t.matchAll(new RegExp(`每\\s*(?:日|天)[^。\\n]{0,14}?${TIME}[^。\\n]{0,10}?${ACT}`, 'g'))) {
    if (!CTX.test(near(m.index, m[0].length))) continue;
    const time = parseTime(m[1]);
    if (time) out.push({ kind: 'daily', time, text: snip(m.index, m[0].length) });
  }
  for (const m of t.matchAll(new RegExp(`前一\\s*(?:天|日)\\s*${TIME}\\s*前\\s*${ACT}`, 'g'))) {
    if (!CTX.test(near(m.index, m[0].length))) continue;
    const time = parseTime(m[1]);
    if (time) out.push({ kind: 'daily', time, text: snip(m.index, m[0].length) });
  }
  // 去重
  const seen = new Set();
  return out.filter((r) => { const k = [r.kind, r.at, r.dow, r.time].join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
}

/* ---------------- 要檢查哪些網頁 ---------------- */

const FIXED = [
  { chain: '美麗華', label: '美麗華', urls: ['https://www.miramarcinemas.tw/Home/startordertime'] },
  { chain: '美麗新', label: '美麗新', urls: ['https://www.miranewcinemas.com/Booking/StartOrderTime'] },
];
const CHAIN_SITES = {
  威秀: 'https://www.vscinemas.com.tw/vsweb/', 秀泰: 'https://www.showtimes.com.tw/', 國賓: 'https://www.ambassador.com.tw/',
  新光: 'https://www.skcinemas.com/', 喜樂時代: 'https://www.centuryasia.com.tw/', in89: 'https://www.in89cinemax.com/',
  樂聲: 'https://www.luxcinema.com.tw/web/2020',
};
const SOCIAL = /(^|\.)(facebook|instagram|line|youtube|threads|twitter|x)\.(com|me)$|(^|\.)lin\.ee$|^reurl\.cc$|(^|\.)atmovies\.com\.tw$/i; // 社群、短網址（多半導向社群）、開眼不處理
const NEWS_LINK = /最新消息|公告|消息|news|notice|bulletin|訂票須知|購票須知|訂票說明|常見問題|faq|場次公布|票務/i;

async function sources(only) {
  const list = [...FIXED.map((s) => ({ ...s, key: s.chain }))];
  for (const [chain, url] of Object.entries(CHAIN_SITES)) list.push({ chain, label: chain, key: chain, urls: [url] });
  try {
    const d = JSON.parse(await fs.readFile(path.join(ROOT, 'docs', 'data.json'), 'utf8'));
    for (const c of d.cinemas.filter((x) => x.chain === '其他影城')) list.push({ chain: '其他影城', label: c.name, key: '其他影城:' + c.name, urls: c.site ? [c.site] : [] });
  } catch { /* 沒有資料檔就只檢查連鎖 */ }
  return only.length ? list.filter((s) => only.includes(s.chain)) : list;
}

async function crawl(src) {
  const res = { ...src, status: 'ok', pages: [], items: [] };
  const host = (u) => { try { return new URL(u).host; } catch { return ''; } };
  const urls = src.urls.filter(Boolean);
  if (!urls.length) return { ...res, status: 'no-site' };
  if (urls.every((u) => SOCIAL.test(host(u)))) return { ...res, status: 'skipped-social' };
  const seen = new Set();
  const queue = [...urls.filter((u) => !SOCIAL.test(host(u)))];
  let fetched = 0;
  while (queue.length && seen.size < 5) {
    const u = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    let html;
    try { html = await fetchText(u, { tries: 2, timeout: 15000 }); fetched++; } catch (e) { res.pages.push({ url: u, error: String(e.message).slice(0, 60) }); continue; }
    res.pages.push({ url: u, ok: true });
    // 只有首頁需要再找「最新消息／公告」類連結
    if (seen.size === 1) {
      const doc = parseHTML(html);
      for (const a of doc.querySelectorAll('a[href]')) {
        if (queue.length >= 4) break;
        const label = text(a);
        const href = a.getAttribute('href') || '';
        if (!(NEWS_LINK.test(label) && label.length < 20) && !/\/(news|notice|faq|bulletin)/i.test(href)) continue;
        const full = abs(href, u).split('#')[0];
        if (full && host(full) === host(u) && !seen.has(full) && !queue.includes(full)) queue.push(full);
      }
    }
    const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<(br|\/p|\/li|\/div|\/h\d|\/tr)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;|&#\d+;/gi, ' ');
    for (const r of extractRules(body)) res.items.push({ ...r, source: u });
    await sleep(250);
  }
  if (!fetched) res.status = 'error';
  return res;
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const only = args.filter((a) => !a.startsWith('--'));
  const results = await pool(await sources(only), 4, crawl);

  let prev = { items: [], sources: [] };
  try { prev = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch { /* 第一次執行 */ }
  const keyOf = (x) => x.key || x.chain;
  // 這次有檢查的來源用新結果；網頁讀取失敗的、或這次沒檢查的來源，保留上次的結果
  // （避免網站暫時打不開，就把已排好的自動排程清掉）
  const processed = new Set(results.map(keyOf));
  const failed = new Set(results.filter((r) => r.status === 'error').map(keyOf));
  const items = [], sourcesOut = [];
  for (const r of results) {
    sourcesOut.push({ key: keyOf(r), chain: r.chain, label: r.label, status: r.status, pages: r.pages.length });
    for (const it of r.items || []) items.push({ chain: r.chain, label: r.label, key: keyOf(r), ...it });
  }
  for (const it of prev.items) if (!processed.has(it.key) || failed.has(it.key)) items.push(it);
  for (const s of prev.sources) if (!processed.has(s.key)) sourcesOut.push(s);

  const out = { items, sources: sourcesOut };
  for (const r of results) {
    const n = (r.items || []).length;
    if (n || r.status === 'error') console.log(`${r.label}：${r.status === 'error' ? '網頁讀取失敗（沿用上次結果）' : n + ' 則公布時間'}${(r.items || []).slice(0, 3).map((x) => `\n    ${x.kind} ${x.at || ''}${x.dow !== undefined ? ' 週' + '日一二三四五六'[x.dow] : ''} ${x.time || ''}　「${x.text.slice(0, 50)}」`).join('')}`);
  }
  const st = {}; for (const r of results) st[r.status] = (st[r.status] || 0) + 1;
  console.log(`檢查 ${results.length} 個來源：${Object.entries(st).map(([k, v]) => `${k} ${v}`).join('、')}；共 ${items.length} 則公布時間`);
  if (!dry) {
    await fs.mkdir(path.dirname(OUT), { recursive: true });
    await fs.writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
