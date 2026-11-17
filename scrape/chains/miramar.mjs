// 美麗華大直影城：場次總表一頁取得；另有官方「開放場次訂票時間」公告
import { fetchText, parseHTML, abs, text, pageText, ymdFromMD, normTime, normRating, taipei } from '../util.mjs';

export const chain = '美麗華';
export const site = 'https://www.miramarcinemas.tw/';
const BASE = 'https://www.miramarcinemas.tw';
const CID = 'mm-dazhi';

function parseTimetable(doc) {
  const movies = [], shows = [];
  for (const L of doc.querySelectorAll('div.timetable_list')) {
    const title = text(L.querySelector('.movie_info .title'));
    if (!title) continue;
    const img = L.querySelector('img');
    movies.push({
      key: title,
      title,
      en: text(L.querySelector('.movie_info .title_en')),
      poster: img ? abs(img.getAttribute('src'), BASE + '/') : '',
      runtime: +((text(L.querySelector('.movie_info .time')).match(/\d+/) || [0])[0]),
      rating: normRating(text(L.querySelector('.badge_movie_level'))),
      genre: '',
      release: '',
      synopsis: text(L.querySelector('.description')),
    });
    for (const b of L.querySelectorAll('div.block')) {
      const m = String(b.className).match(/(\d+)月(\d+)日/);
      if (!m) continue;
      const date = ymdFromMD(+m[1], +m[2]);
      let fmt = '';
      for (const c of b.children) {
        if (c.classList.contains('room')) fmt = text(c).replace('watch_later', '').trim();
        if (c.classList.contains('time_area'))
          for (const a of c.querySelectorAll('a.booking_time'))
            shows.push({ cinema: CID, movieKey: title, date, time: normTime(text(a)), format: fmt, hall: '', url: abs(a.getAttribute('href'), BASE + '/') });
      }
    }
  }
  return { movies, shows };
}

/** 解析「11/18（三）18:00後開放 \n 11/20-11/25 ...」 */
export function parseRelease(txt, nowISO = new Date().toISOString()) {
  const now = taipei(nowISO);
  const nowKey = `${now.date}T${now.time}`;
  const re = /(\d{1,2})\/(\d{1,2})\s*[（(][^）)]*[）)]\s*(\d{1,2}:\d{2})\s*後?開放[\s\S]{0,40}?(\d{1,2})\/(\d{1,2})\s*[-~～至]\s*(\d{1,2})\/(\d{1,2})/g;
  const list = [];
  for (const m of txt.matchAll(re)) {
    list.push({
      nextAt: `${ymdFromMD(+m[1], +m[2])}T${normTime(m[3])}`,
      rangeFrom: ymdFromMD(+m[4], +m[5]),
      rangeTo: ymdFromMD(+m[6], +m[7]),
    });
  }
  return list.find((x) => x.nextAt > nowKey) || null;
}

export async function scrape() {
  const { movies, shows } = parseTimetable(parseHTML(await fetchText(BASE + '/timetable')));
  let publish = null;
  try {
    publish = parseRelease(pageText(parseHTML(await fetchText(BASE + '/Home/startordertime'))));
  } catch (e) { console.warn('  ! 美麗華公告讀取失敗 ' + e.message); }
  const cinemas = [{ id: CID, chain, name: '美麗華大直影城', addr: '台北市中山區', city: '台北市', region: '北部', site, publish: publish ? { ...publish, official: true } : undefined }];
  return { cinemas, movies, shows };
}
