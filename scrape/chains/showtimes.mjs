// 秀泰影城：官方 capi 一次回傳全部影城、電影、場次
import { fetchJSON, taipei, normRating, regionOf, cityOf } from '../util.mjs';

export const chain = '秀泰';
export const site = 'https://www.showtimes.com.tw/';

export async function scrape() {
  const j = (await fetchJSON('https://capi.showtimes.com.tw/4/app/bootstrap')).payload;
  const genreLabel = Object.fromEntries((j.preferenceVocabularies?.genres || []).map((g) => [g.key, g.label]));

  const movies = (j.programs || []).map((p) => ({
    key: String(p.id),
    title: p.name,
    en: p.nameAlternative || '',
    poster: p.coverImagePortrait?.url || '',
    runtime: Math.round((p.duration || 0) / 60),
    rating: normRating(p.rating),
    genre: (p.genres || []).map((g) => genreLabel[g] || g).slice(0, 2).join('/'),
    release: p.availableAt ? taipei(p.availableAt).date : '',
    synopsis: (p.description || '').replace(/<[^>]+>/g, '').trim(),
  }));

  const cinemas = (j.corporations || []).map((c) => ({
    id: 'st-' + c.id,
    chain,
    name: c.name,
    addr: c.address || '',
    city: cityOf(c.address, c.name),
    region: regionOf(c.address, c.name),
    site,
  }));

  const shows = [];
  for (const [cid, v] of Object.entries(j.eventsForCorporations || {})) {
    const room = Object.fromEntries((v.venues || []).map((x) => [x.id, x.room]));
    for (const e of v.events || []) {
      if (e.status !== 'active') continue;
      const t = taipei(e.startedAt);
      shows.push({
        cinema: 'st-' + cid,
        movieKey: String(e.programId),
        date: t.date,
        time: t.time,
        format: e.meta?.format || '',
        hall: room[e.venueId] || '',
        url: `https://www.showtimes.com.tw/ticketing/cart/selectTicketTypes/${e.id}`,
      });
    }
  }
  return { cinemas, movies, shows };
}
