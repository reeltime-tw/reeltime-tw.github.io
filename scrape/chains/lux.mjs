// 樂聲影城（西門町）：首頁取電影，每部電影頁有場次與直達訂票連結
// 官方規則：「每日場次最晚將於前一天 20:00 前公布並開放訂票」
import { fetchText, parseHTML, pool, abs, text, pageText, ymdFromMD, normTime, normRating } from '../util.mjs';

export const chain = '樂聲';
export const site = 'https://www.luxcinema.com.tw/web/2020';
const BASE = 'https://www.luxcinema.com.tw/web/';
const CID = 'lux-ximen';

function parseHome(doc) {
  const m = new Map();
  for (const box of doc.querySelectorAll('div.movie-list')) {
    const a = box.querySelector('a[href*="movie_item.php"]') || box.closest('a[href*="movie_item.php"]');
    if (!a) continue;
    const id = new URL(a.getAttribute('href'), BASE).searchParams.get('film_id');
    const title = text(box.querySelector('h1'));
    if (!id || !title || m.has(id)) continue;
    const img = box.querySelector('img');
    m.set(id, { key: id, title, en: text(box.querySelector('h3')), poster: img ? abs(img.getAttribute('src'), BASE) : '' });
  }
  return [...m.values()];
}

function parseItem(doc) {
  const shows = [];
  for (const row of doc.querySelectorAll('.movie_time_out')) {
    const mo = +text(row.querySelector('.month')), d = +text(row.querySelector('.day'));
    if (!mo || !d) continue;
    const date = ymdFromMD(mo, d);
    for (const a of row.querySelectorAll('.time_list a')) {
      const t = normTime(text(a));
      if (!t) continue;
      const url = abs(a.getAttribute('href'), BASE);
      let hall = '';
      try { hall = new URL(url).searchParams.get('seat_type') || ''; } catch {}
      shows.push({ date, time: t, url, hall: hall ? hall + ' 廳' : '' });
    }
  }
  const body = pageText(doc);
  return { shows, rating: normRating((body.match(/(普遍級|保護級|輔\d+級|限制級)/) || [''])[0]), runtime: +((body.match(/片長[：:]?\s*(\d+)/) || [0, 0])[1]) };
}

export async function scrape() {
  const films = parseHome(parseHTML(await fetchText(site)));
  const movies = films.map((f) => ({ ...f, runtime: 0, rating: '', genre: '', release: '', synopsis: '' }));
  const byKey = Object.fromEntries(movies.map((m) => [m.key, m]));
  const shows = [];
  await pool(films, 3, async (f) => {
    const r = parseItem(parseHTML(await fetchText(`${BASE}2020-movie_item.php?film_id=${f.key}`)));
    byKey[f.key].rating = r.rating; byKey[f.key].runtime = r.runtime;
    for (const s of r.shows) shows.push({ ...s, cinema: CID, movieKey: f.key, format: '' });
  });
  const cinemas = [{ id: CID, chain, name: '樂聲影城', addr: '台北市萬華區武昌街二段85號', city: '台北市', region: '北部', site, publishRule: 'prevDay2000' }];
  return { cinemas, movies, shows };
}
