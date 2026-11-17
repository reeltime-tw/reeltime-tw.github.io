// 新光影城：首頁取電影，再逐影城讀取場次頁（含剩餘座位與直達訂票連結）
import { fetchText, parseHTML, pool, abs, text, pageText, taipei, ymdFromMD, normTime, normRating } from '../util.mjs';

export const chain = '新光';
export const site = 'https://www.skcinemas.com/';
const BASE = 'https://www.skcinemas.com';

const CINEMAS = [
  { cid: '1001', name: '台北獅子林新光影城', city: '台北市', region: '北部', addr: '台北市萬華區' },
  { cid: '1005', name: '台北天母新光影城', city: '台北市', region: '北部', addr: '台北市士林區' },
  { cid: '1004', name: '桃園青埔新光影城', city: '桃園市', region: '北部', addr: '桃園市大園區' },
  { cid: '1003', name: '台中中港新光影城', city: '台中市', region: '中部', addr: '台中市西屯區' },
  { cid: '1002', name: '台南西門新光影城', city: '台南市', region: '南部', addr: '台南市中西區' },
];

function parseHome(doc) {
  const films = new Map();
  for (const el of doc.querySelectorAll('[data-action-url*="/Films/FP"]')) {
    const u = new URL(el.getAttribute('data-action-url'), BASE);
    const id = u.searchParams.get('filmId');
    if (!id || films.has(id)) continue;
    let card = el;
    for (let i = 0; i < 6 && card && !card.querySelector('img'); i++) card = card.parentElement;
    const t = text(card);
    const img = card?.querySelector('img');
    films.set(id, {
      key: id,
      now: u.searchParams.get('isNowShowing') === 'True',
      title: t.split('上映日期')[0].trim(),
      release: ((t.match(/上映日期[：:]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/) || []).slice(1).map((x, i) => (i ? x.padStart(2, '0') : x)).join('-')),
      poster: img ? abs(img.getAttribute('src'), BASE) : '',
    });
  }
  return [...films.values()];
}

function parseFP(doc) {
  const today = taipei().date;
  const body = pageText(doc);
  const shows = [];
  for (const d of doc.querySelectorAll('.sessions-view .days-info')) {
    const h = text(d.querySelector('h5'));
    const m = h.match(/(\d+)月\s*(\d+)日/);
    const date = m ? ymdFromMD(+m[1], +m[2]) : today;
    let fmt = '';
    for (const c of d.children) {
      if (c.classList?.contains('film-type')) fmt = text(c);
      for (const s of c.querySelectorAll('.session-info')) {
        const ps = [...s.querySelectorAll('p')].map(text);
        const left = (ps.find((p) => /剩/.test(p)) || '').match(/\d+/);
        shows.push({
          date,
          time: normTime(text(s.querySelector('.show-time'))),
          format: fmt,
          hall: ps.find((p) => /廳/.test(p)) || '',
          seatsLeft: left ? +left[0] : undefined,
          url: abs(s.getAttribute('data-action-url'), BASE),
        });
      }
    }
  }
  const h = doc.querySelector('h1,h2,h3');
  return {
    title: text(h),
    rating: normRating((body.match(/(普遍級|保護級|輔\d+級|限制級)/) || [''])[0]),
    runtime: +((body.match(/(\d+)\s*分鐘/) || [0, 0])[1]),
    synopsis: (body.match(/劇情介紹：\s*(.{0,300})/) || ['', ''])[1].split('線上訂票')[0].trim(),
    shows,
  };
}

export async function scrape() {
  const films = parseHome(parseHTML(await fetchText(BASE + '/')));
  const movies = new Map(films.map((f) => [f.key, { key: f.key, title: f.title, en: '', poster: f.poster, release: f.release, runtime: 0, rating: '', genre: '', synopsis: '' }]));
  const jobs = films.filter((f) => f.now).flatMap((f) => CINEMAS.map((c) => ({ f, c })));
  const shows = [];
  await pool(jobs, 4, async ({ f, c }) => {
    const r = parseFP(parseHTML(await fetchText(`${BASE}/Films/FP?filmId=${f.key}&cinemaId=${c.cid}&isNowShowing=True`)));
    const mv = movies.get(f.key);
    if (r.title && r.title !== '線上訂票') mv.title = r.title;
    mv.rating ||= r.rating; mv.runtime ||= r.runtime; mv.synopsis ||= r.synopsis;
    for (const s of r.shows) if (s.time) shows.push({ ...s, cinema: 'sk-' + c.cid, movieKey: f.key });
  });
  const cinemas = CINEMAS.map((c) => ({ id: 'sk-' + c.cid, chain, name: c.name, addr: c.addr, city: c.city, region: c.region, site }));
  return { cinemas, movies: [...movies.values()], shows };
}
