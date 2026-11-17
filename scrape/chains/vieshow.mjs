// 威秀影城：列表頁取電影，再到每部電影介紹頁取全部影城場次（含直達訂票連結）
import { fetchText, parseHTML, pool, abs, text, pageText, regionOf, cityOf, sleep } from '../util.mjs';

export const chain = '威秀';
export const site = 'https://www.vscinemas.com.tw/';
const BASE = 'https://www.vscinemas.com.tw/vsweb/film/';

function parseList(doc) {
  return [...doc.querySelectorAll('ul.movieList > li')].map((li) => {
    const a = li.querySelector('.infoArea h2 a');
    if (!a) return null;
    const id = new URL(a.getAttribute('href'), BASE).searchParams.get('id');
    const img = li.querySelector('figure img') || li.querySelector('img');
    return {
      key: id,
      title: text(a),
      en: text(li.querySelector('.infoArea h3')),
      release: text(li.querySelector('time')).replace(/\//g, '-'),
      poster: img ? abs(img.getAttribute('src'), BASE) : '',
    };
  }).filter((x) => x && x.key);
}

async function listAll(page) {
  const out = new Map();
  for (let p = 1; p <= 15; p++) {
    const items = parseList(parseHTML(await fetchText(`${BASE}${page}?p=${p}`)));
    const before = out.size;
    for (const it of items) if (!out.has(it.key)) out.set(it.key, it);
    if (!items.length || out.size === before) break;
  }
  return [...out.values()];
}

function parseDetail(doc) {
  const tab = {};
  for (const a of doc.querySelectorAll('a[href^="#movieTime"]')) {
    const vli = a.closest('ul')?.closest('li');
    const va = vli && [...vli.children].find((c) => c.tagName === 'A');
    tab[a.getAttribute('href').slice(1)] = { cinema: text(a), version: text(va) };
  }
  const shows = [];
  for (const art of doc.querySelectorAll('div.movieTime > article')) {
    const k = tab[art.id];
    if (!k) continue;
    for (const day of art.querySelectorAll('.movieDay')) {
      const m = text(day.querySelector('h4')).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
      if (!m) continue;
      const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
      for (const a of day.querySelectorAll('ul.bookList a')) {
        const t = text(a);
        if (!/^\d{1,2}:\d{2}$/.test(t)) continue;
        shows.push({ cinema: k.cinema, format: k.version, date, time: t.padStart(5, '0'), url: abs(a.getAttribute('href'), BASE) });
      }
    }
  }
  const body = pageText(doc);
  const rt = body.match(/片長：\s*(\d+)\s*時\s*(\d+)\s*分/);
  const genre = (body.match(/類型：\s*([^\s片]+)/) || [])[1] || '';
  return { shows, runtime: rt ? +rt[1] * 60 + +rt[2] : 0, genre };
}

export async function scrape() {
  const now = await listAll('index.aspx');
  const coming = await listAll('coming.aspx');
  const movies = new Map([...coming, ...now].map((m) => [m.key, { ...m, runtime: 0, rating: '', genre: '', synopsis: '' }]));

  const shows = [];
  const cinemaNames = new Set();
  // 放慢速度：短時間大量讀取會被威秀暫時拒絕
  await pool(now, 2, async (m) => {
    await sleep(400);
    const d = parseDetail(parseHTML(await fetchText(`${BASE}detail.aspx?id=${m.key}`)));
    const mv = movies.get(m.key);
    mv.runtime = d.runtime;
    mv.genre = d.genre;
    for (const s of d.shows) {
      cinemaNames.add(s.cinema);
      shows.push({ ...s, cinema: 'vs-' + s.cinema, movieKey: m.key });
    }
  });

  const cinemas = [...cinemaNames].map((n) => ({ id: 'vs-' + n, chain, name: n, addr: '', city: cityOf(n), region: regionOf(n), site }));
  return { cinemas, movies: [...movies.values()], shows };
}
