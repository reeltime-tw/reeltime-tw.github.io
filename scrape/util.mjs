import { DOMParser } from 'linkedom';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export async function fetchText(url, { tries = 3, timeout = 20000, headers = {} } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9', ...headers } });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return await r.text();
    } catch (e) {
      last = e;
      await sleep(800 * (i + 1));
    } finally {
      clearTimeout(t);
    }
  }
  throw last;
}
export const fetchJSON = async (url, o) => JSON.parse(await fetchText(url, o));
export const parseHTML = (html) => new DOMParser().parseFromString(html, 'text/html');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 依序以有限並行數處理 */
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k], k); } catch (e) { out[k] = undefined; console.warn('  ! ' + e.message); }
    }
  }));
  return out;
}

/* ---------- 台北時間 ---------- */
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export function taipei(d = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  const hh = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hh}:${p.minute}`, y: +p.year, m: +p.month };
}
export const pad = (n) => String(n).padStart(2, '0');
/** 只有月/日時推算年份（處理跨年） */
export function ymdFromMD(month, day, now = taipei()) {
  let y = now.y;
  if (month < now.m - 6) y++;
  else if (month > now.m + 6) y--;
  return `${y}-${pad(month)}-${pad(day)}`;
}
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export const normTime = (t) => { const m = String(t).match(/(\d{1,2}):(\d{2})/); return m ? `${pad(m[1])}:${m[2]}` : ''; };
export const abs = (href, base) => { try { return href ? new URL(href, base).href : ''; } catch { return ''; } };
export const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
/** 整頁文字（網頁沒有 <body> 時改用整份文件） */
export const pageText = (doc) => text(doc.body) || text(doc.documentElement);

/* ---------- 分級 ---------- */
export function normRating(s) {
  s = String(s || '');
  if (/普/.test(s) || /^g$/i.test(s)) return '普';
  if (/護/.test(s) || /^p$/i.test(s)) return '護';
  if (/12/.test(s)) return '輔12';
  if (/15/.test(s)) return '輔15';
  if (/限|18/.test(s) || /^r$/i.test(s)) return '限';
  return '';
}

/* ---------- 地區 ---------- */
const REGION = [
  ['離島', ['澎湖', '金門', '馬祖', '連江']],
  ['東部', ['花蓮', '台東', '臺東']],
  ['南部', ['嘉義', '台南', '臺南', '高雄', '屏東', '岡山', '鹽埕', '仁德', '大立', '夢時代', '鳳山', '左營']],
  ['中部', ['台中', '臺中', '苗栗', '頭份', '彰化', '南投', '雲林', '斗六', '北港', '豐原', '大里', '后里', '竹南']],
  ['北部', ['台北', '臺北', '新北', '基隆', '桃園', '新竹', '宜蘭', '板橋', '新店', '中和', '永和', '土城', '樹林', '林口', '三重', '新莊', '汐止', '淡水', '中壢', '青埔', '竹北', '羅東', '南港', '信義', '西門', '天母', '獅子林', '大直', '長春', '京站', '松仁', '大巨蛋', '欣欣']],
];
export function regionOf(...s) {
  const t = s.join(' ');
  for (const [r, ks] of REGION) if (ks.some((k) => t.includes(k))) return r;
  return '北部';
}
const CITY_RE = '台北|臺北|新北|基隆|桃園|新竹|苗栗|台中|臺中|彰化|南投|雲林|嘉義|台南|臺南|高雄|屏東|宜蘭|花蓮|台東|臺東|澎湖|金門|連江';
const COUNTY = /^(苗栗|彰化|南投|雲林|屏東|宜蘭|花蓮|台東|澎湖|金門|連江)$/;
// 店名只寫行政區時（如「板橋大遠百」）用來判斷縣市
const DISTRICT = [
  ['新北市', ['板橋', '新店', '中和', '永和', '土城', '樹林', '林口', '三重', '新莊', '汐止', '淡水', '蘆洲', '三峽']],
  ['桃園市', ['中壢', '青埔', '蘆竹', '八德', '平鎮']],
  ['新竹縣', ['竹北']],
  ['苗栗縣', ['頭份', '竹南']],
  ['台中市', ['大里', '豐原', '后里', '太平']],
  ['雲林縣', ['斗六', '北港']],
  ['高雄市', ['岡山', '鳳山', '左營', '鹽埕', '夢時代']],
  ['宜蘭縣', ['羅東']],
];
export function cityOf(...s) {
  const t = s.join(' ').replace(/臺/g, '台');
  const full = t.match(new RegExp(`(${CITY_RE})(市|縣)`));
  if (full) return full[1] + full[2];
  const m = t.match(new RegExp(`(${CITY_RE})`));
  if (m) return m[1] + (COUNTY.test(m[1]) ? '縣' : '市'); // 新竹、嘉義沒寫明時以「市」為準
  for (const [c, ks] of DISTRICT) if (ks.some((k) => t.includes(k))) return c;
  return '';
}

/* ---------- 片名比對 ---------- */
export function normTitle(t) {
  return String(t || '')
    .normalize('NFKC')
    .replace(/[《》「」『』〈〉【】]/g, '')
    .replace(/\s+/g, '')
    .replace(/[：:]/g, ':')
    .replace(/[‧・·．.]/g, '')
    .replace(/[-－—–]/g, '-')
    .toLowerCase();
}
