// 喜樂時代影城：JSON API，按影城→電影→日期查詢
import { fetchJSON, pool, normRating, normTime } from '../util.mjs';

export const chain = '喜樂時代';
export const site = 'https://www.centuryasia.com.tw/';
const BASE = 'https://www.centuryasia.com.tw';

const INFO = {
  Nangang: { city: '台北市', region: '北部', addr: '台北市南港區' },
  Beyond: { city: '新北市', region: '北部', addr: '新北市永和區' },
  Kaohsiung: { city: '高雄市', region: '南部', addr: '高雄市' },
  Ximen: { city: '台北市', region: '北部', addr: '台北市萬華區（今日百貨）' },
};

export async function scrape() {
  const sites = (await fetchJSON(BASE + '/Movie/GetTheaterList')).Data.filter((x) => x.item_value);
  const cinemas = sites.map((s) => ({
    id: 'ca-' + s.item_value,
    chain,
    name: '喜樂時代影城 ' + s.item_name,
    ...(INFO[s.item_value] || { city: '', region: '北部', addr: '' }),
    site,
    ticketUrl: `${BASE}/book.html?sid=${s.item_value}`,
  }));

  const movies = new Map();
  const jobs = [];
  for (const s of sites) {
    const r = await fetchJSON(`${BASE}/Movie/GetMovieList/${s.item_value}`);
    for (const m of r.Data || []) {
      if (!movies.has(m.programid))
        movies.set(m.programid, {
          key: m.programid, title: m.cname, en: m.ename || '', poster: m.image || '',
          runtime: +m.ShowTimes || 0, rating: normRating(m.filmleveldesc), genre: (m.CodeName || '').split(',').slice(0, 2).join('/'),
          release: m.ReleaseDate || '', synopsis: (m.Introduction || '').trim(),
        });
      jobs.push({ site: s.item_value, m });
    }
  }

  const shows = [];
  await pool(jobs, 6, async ({ site: sid, m }) => {
    for (const d of m.datedata || []) {
      const r = await fetchJSON(`${BASE}/Movie/GetMovieAlltime/${sid}/${m.programid}/${d.date}`);
      if (!r.status || !Array.isArray(r.Data)) break; // 該日尚未公布 → 之後也不會有
      for (const hall of r.Data)
        for (const st of hall.subtimedata || []) {
          if (st.disable) continue;
          shows.push({
            cinema: 'ca-' + sid, movieKey: m.programid, date: st.showdate, time: normTime(st['時間']),
            format: (st.SubName2 || hall.SubName2 || '').replace('/', ' '), hall: st.hallname || hall.hallname || '',
            url: `${BASE}/book.html?sid=${sid}`,
          });
        }
    }
  });
  return { cinemas, movies: [...movies.values()], shows };
}
