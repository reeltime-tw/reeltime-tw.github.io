// in89 豪華影城：各據點官網頁面藏有自己的場次 API 網域（D_CINEMA 系統），API 不需登入
import { fetchText, fetchJSON, parseHTML, normRating, normTime } from '../util.mjs';

export const chain = 'in89';
export const site = 'https://www.in89cinemax.com/';
const WEB = 'https://www.in89cinemax.com';

// TheaterId：官網首頁「請選擇影城」選單的值（2026-11 時台中大里尚未提供線上場次）
const THEATERS = [
  { tid: 1, city: '桃園市', region: '北部' },
  { tid: 18, city: '台中市', region: '中部' },
  { tid: 15, city: '台中市', region: '中部' },
  { tid: 17, city: '嘉義市', region: '南部' },
  { tid: 2, city: '高雄市', region: '南部' },
  { tid: 16, city: '高雄市', region: '南部' },
  { tid: 14, city: '澎湖縣', region: '離島' },
];

/** 走訪 API 回傳的巢狀物件，取出所有場次（含 stage_id 的物件） */
function collectStages(o, out = []) {
  if (Array.isArray(o)) o.forEach((x) => collectStages(x, out));
  else if (o && typeof o === 'object') {
    if ('stage_id' in o) out.push(o);
    else Object.values(o).forEach((x) => collectStages(x, out));
  }
  return out;
}

export async function scrape() {
  const cinemas = [], movies = new Map(), shows = [];
  for (const t of THEATERS) {
   try {
    const page = parseHTML(await fetchText(`${WEB}/index.aspx?TheaterId=${t.tid}`));
    const host = (page.querySelector('input[name=theater_api]')?.getAttribute('value') || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const name = (page.querySelector('input[name=TheaterName]')?.getAttribute('value') || page.querySelector('title')?.textContent || '').replace(/_/g, ' ').trim();
    if (!host) { console.log(`  · ${name || t.tid}：官網沒有提供線上場次，略過`); continue; }
    const id = 'in-' + t.tid;
    const ticketUrl = `${WEB}/index.aspx?TheaterId=${t.tid}`;
    cinemas.push({ id, chain, name, addr: '', city: t.city, region: t.region, site, ticketUrl });

    const api = `https://${host}/api/api_movie.php?method=getStagesByDate`;
    const r = await fetch(api, { method: 'POST', body: new URLSearchParams({ method: 'getStagesByDate' }), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${api}`);
    const j = await r.json();

    for (const m of Object.values(j.movies || {})) {
      const key = String(m.movie_id);
      if (!movies.has(key))
        movies.set(key, {
          key,
          title: m.movie_group_name,
          en: m.en_name || '',
          poster: m['253_img_path'] ? `https://${host}${m['253_img_path']}` : '',
          runtime: +m.play_duration || 0,
          rating: normRating(m.movie_age_desc),
          genre: (m.movie_type_desc || '').split(',').slice(0, 2).join('/'),
          release: m.start_time || '',
          synopsis: '',
          format: [m.movie_play_desc, m.movie_lang_desc].filter(Boolean).join(' '),
        });
    }
    for (const s of collectStages(j.stages)) {
      if (s.allow_sell_web === 0) continue;
      const key = String(s.movie_id);
      const [date, time] = String(s.movie_show_time || '').split(' ');
      if (!date || !movies.has(key)) continue;
      const free = parseInt(s.web_real_seat ?? s.seat_free, 10);
      shows.push({
        cinema: id, movieKey: key, date, time: normTime(time),
        format: movies.get(key).format, hall: s.theater_film_name || '',
        seatsLeft: Number.isFinite(free) ? free : undefined, url: ticketUrl,
      });
    }
   } catch (e) { console.warn(`  ! in89 TheaterId=${t.tid} 失敗：${e.message}`); }
  }
  if (!shows.length) throw new Error('in89 所有據點都抓取失敗');
  return { cinemas, movies: [...movies.values()], shows };
}
