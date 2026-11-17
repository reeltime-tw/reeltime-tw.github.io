// 國賓影城：電影列表 → 每部電影逐日讀取各影城場次（官網無單場直達連結）
import { fetchText, parseHTML, pool, abs, text, pageText, taipei, addDays, normTime, regionOf, cityOf } from '../util.mjs';

export const chain = '國賓';
export const site = 'https://www.ambassador.com.tw/';
const BASE = 'https://www.ambassador.com.tw';
const BOOK = 'https://booking.ambassador.com.tw/';

function parseList(doc) {
  const m = new Map();
  for (const a of doc.querySelectorAll('a[href*="MovieContent"]')) {
    const id = new URL(a.getAttribute('href'), BASE).searchParams.get('MID');
    if (!id) continue;
    const cell = a.closest('.cell') || a.parentElement;
    const o = m.get(id) || { key: id };
    const img = cell.querySelector('img');
    if (img && !o.poster) o.poster = abs(img.getAttribute('src'), BASE);
    const t = [...cell.querySelectorAll('a[href*="MovieContent"]')].map(text).find(Boolean);
    if (t) o.title = t;
    o.en ||= text(cell.querySelector('p'));
    m.set(id, o);
  }
  return [...m.values()].filter((o) => o.title);
}

function parseDay(doc, date) {
  const shows = [], cinemas = [];
  for (const box of doc.querySelectorAll('.theater-box')) {
    const name = text(box.querySelector('h3 a') || box.querySelector('a'));
    if (!name) continue;
    const addr = text(box.querySelector('span.show-for-medium'));
    cinemas.push({ name, addr });
    let fmt = '';
    for (const el of box.querySelectorAll('p.tag-seat, ul.seat-list > li')) {
      if (el.tagName === 'P') { fmt = (text(el).match(/^\(([^)]*)\)/) || ['', ''])[1]; continue; }
      const t = text(el.querySelector('h6'));
      if (!/^\d{1,2}:\d{2}$/.test(t)) continue;
      shows.push({ cinemaName: name, date, time: normTime(t), format: fmt, hall: text(el.querySelector('.info')).split(' ')[0] });
    }
  }
  const body = pageText(doc);
  return { shows, cinemas, rating: (body.match(/(普遍級|保護級|輔\d+級|限制級)/) || [''])[0] };
}

export async function scrape() {
  const now = parseList(parseHTML(await fetchText(BASE + '/home/MovieList?Type=1')));
  let coming = [];
  try { coming = parseList(parseHTML(await fetchText(BASE + '/home/MovieList?Type=2'))); } catch {}
  const movies = new Map([...coming, ...now].map((m) => [m.key, { ...m, en: m.en || '', release: '', runtime: 0, rating: '', genre: '', synopsis: '' }]));

  const today = taipei().date;
  const shows = [];
  const cmap = new Map();
  await pool(now, 4, async (m) => {
    for (let i = 0; i < 10; i++) {
      const date = addDays(today, i);
      const r = parseDay(parseHTML(await fetchText(`${BASE}/home/MovieContent?MID=${m.key}&DT=${date.replace(/-/g, '/')}`)), date);
      if (!r.shows.length) break; // 尚未公布
      const mv = movies.get(m.key);
      mv.rating ||= r.rating;
      for (const c of r.cinemas) cmap.set(c.name, c.addr);
      for (const s of r.shows) shows.push({ ...s, cinema: 'ab-' + s.cinemaName, movieKey: m.key, url: BOOK });
    }
  });
  const cinemas = [...cmap].map(([name, addr]) => ({ id: 'ab-' + name, chain, name, addr, city: cityOf(addr, name), region: regionOf(addr, name), site, ticketUrl: BOOK }));
  return { cinemas, movies: [...movies.values()], shows: shows.map(({ cinemaName, ...s }) => s) };
}
