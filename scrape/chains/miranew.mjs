// 美麗新影城（台茂、大直皇家）：場次表頁面內嵌 CinemaList JSON
// 宏匯店已於 2025-12-22 停業。官網訂票為表單送出，無法直達單一場次，連到場次表頁。
import { fetchText, normTime, normRating } from '../util.mjs';

export const chain = '美麗新';
export const site = 'https://www.miranewcinemas.com/';
const BASE = 'https://www.miranewcinemas.com';
const TICKET = BASE + '/Booking/Timetable';

const INFO = {
  '1004': { city: '桃園市', region: '北部', addr: '桃園市蘆竹區（台茂購物中心）' },
  '1005': { city: '台北市', region: '北部', addr: '台北市' },
};

/** 取出 `var CinemaList = '...';` 內的 JSON 字串 */
export function extractCinemaList(html) {
  const m = html.match(/var\s+CinemaList\s*=\s*'([\s\S]*?)'\s*;/) || html.match(/var\s+CinemaList\s*=\s*"([\s\S]*?)"\s*;/);
  if (!m) throw new Error('找不到 CinemaList（官網可能改版）');
  const s = m[1].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return JSON.parse(s);
}

export async function scrape() {
  const data = extractCinemaList(await fetchText(TICKET));
  const cinemas = [], movies = new Map(), shows = [];
  for (const c of data?.Data?.CinemaGroup || []) {
    const id = 'mn-' + c.CinemaId;
    cinemas.push({ id, chain, name: c.CinemaCName, ...(INFO[c.CinemaId] || { city: '', region: '北部', addr: '' }), site, ticketUrl: TICKET });
    for (const m of c.MovieInfo || []) {
      const ratingTxt = (m.MovieCName.match(/\(([普護輔限][^)]*)\)\s*$/) || [])[1] || '';
      const title = m.MovieCName.replace(/\s*\([普護輔限][^)]*\)\s*$/, '').trim();
      const key = title;
      if (!movies.has(key))
        movies.set(key, {
          key, title,
          en: (m.MovieEName || '').replace(/\s*\([A-Z0-9+-]+\)\s*$/, '').trim(),
          poster: m.PostUrl ? `${BASE}/MiramarApp/Resource/${m.PostUrl}_S.jpg` : '',
          runtime: +m.MovieLength || 0,
          rating: normRating(ratingTxt || m.Rate),
          genre: '', release: '', synopsis: '',
        });
      for (const d of m.ShowDateList || []) {
        const date = String(d.ShowDateISO || '').slice(0, 10);
        if (!date) continue;
        for (const st of d.ShowTimeList || []) {
          for (const s of st.SessionList || []) {
            const t = normTime(s.ShowTime);
            if (!t) continue;
            const left = parseInt(s.AvailableSeats, 10);
            shows.push({ cinema: id, movieKey: key, date, time: t, format: st.MovieHallCht || '', hall: '', seatsLeft: Number.isFinite(left) ? left : undefined, url: TICKET });
          }
        }
      }
    }
  }
  return { cinemas, movies: [...movies.values()], shows };
}
