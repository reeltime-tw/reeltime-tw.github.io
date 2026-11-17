// 其他影城：沒有可讀官網場次的獨立影城、藝文影院、二輪戲院，改由「開眼電影網」各戲院時刻表取得
// 只抓下方白名單（已由各大影城官網直接抓取的不重複抓）。名單來源：https://www.atmovies.com.tw/showtime/a02/ 等各縣市頁
// 開眼戲院頁：/showtime/{戲院代碼}/{地區代碼}/ 為今天，頁面「選擇日期」列出其他已公布日期 /showtime/{戲院}/{地區}/YYYYMMDD/
import { fetchText, parseHTML, pool, sleep, text, abs, normRating, cityOf, regionOf } from '../util.mjs';

export const chain = '其他影城';
// 開眼片名常與官網寫法略有不同（例：「同級生」與「同級生：10週年重映」），合併時允許近似比對
export const fuzzyTitles = true;
export const site = 'https://www.atmovies.com.tw/showtime/';
const BASE = 'https://www.atmovies.com.tw';

// [開眼戲院代碼, 地區代碼]（2026-11-18 對照開眼全台 107 間戲院後，挑出尚未涵蓋的）
export const THEATERS = [
  // 台北／新北
  ['t02a03', 'a02'], // 微風影城
  ['t02a08', 'a02'], // 誠品電影院
  ['t02a05', 'a02'], // 總督影城
  ['t02a06', 'a02'], // 哈拉影城
  ['t02b07', 'a02'], // 真善美戲院
  ['t02b16', 'a02'], // 光點華山電影館
  ['t02c01', 'a02'], // 百老匯影城公館店
  ['t02d20', 'a02'], // 光點台北電影院
  ['t02e03', 'a02'], // 新莊鴻金寶麻吉影城
  ['t02e04', 'a02'], // 三重天台戲院
  ['t02e08', 'a02'], // 府中15
  ['t02e22', 'a02'], // 國家電影及視聽文化中心
  ['t02f05', 'a02'], // 景美佳佳戲院（二輪）
  // 桃園
  ['t03302', 'a03'], // 星橋國際影城
  ['t03303', 'a03'], // 威尼斯影城
  ['t03311', 'a03'], // 桃園光影文化館
  ['t03312', 'a03'], // 中壢光影電影館
  // 新竹
  ['t03510', 'a35'], // 百老匯影城竹北店
  // 台中
  ['t04404', 'a04'], // 日日新影城
  ['t04405', 'a04'], // 親親戲院
  ['t04424', 'a04'], // 全球影城
  ['t04426', 'a04'], // 時代數位3D影城
  ['t04427', 'a04'], // 中山73影視藝文空間
  ['t04428', 'a04'], // 王牌映画影城
  // 彰化、雲林、南投
  ['t04703', 'a47'], // 員林影城
  ['t04501', 'a45'], // 環球中華影城
  ['t04901', 'a49'], // 南投戲院
  ['t04902', 'a49'], // 埔里山明影城
  // 嘉義
  ['t05502', 'a05'], // 嘉年華戲院
  // 台南
  ['t06602', 'a06'], // 南台電影城
  ['t06623', 'a06'], // 全美戲院
  ['t06625', 'a06'], // 麻豆戲院
  // 高雄
  ['t07704', 'a07'], // 高雄環球影城
  ['t07712', 'a07'], // 台鋁影城
  ['t07726', 'a07'], // 高雄市電影館
  ['t07731', 'a07'], // 內惟藝術中心
  // 屏東、宜蘭、花蓮
  ['t08701', 'a87'], // 中影屏東影城
  ['t03902', 'a39'], // 宜蘭日新戲院
  ['t03904', 'a39'], // 日新戲院-統一廳
  ['t03905', 'a39'], // 新月豪華影城
  ['t03804', 'a38'], // 花蓮鐵道電影院
];

const MAX_DAYS = 7;
// 開眼分級圖示代碼
const CER = { G: '普', P: '護', F2: '輔12', F5: '輔15', R: '限' };
// 片名後面的版本標記，例如「哥吉拉-0.0(數位)」
const VER_RE = /\s*[(（【]\s*((?:數位|IMAX|3D|2D|4DX|SCREENX|杜比|DOLBY|ATMOS|中文|英文|日文|韓文|國語|英語|日語|韓語|粵語|台語|泰語|原音|配音|版|\s|\/|、)+)\s*[)）】]\s*$/i;

/** 解析一天的戲院時刻表頁面 */
export function parseDay(html) {
  const doc = parseHTML(html);
  const h3 = text(doc.querySelector('h3'));
  const dm = h3.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  const date = dm ? `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}` : '';
  const films = [];
  for (const ul of doc.querySelectorAll('ul[id=theaterShowtimeTable]')) {
    const a = ul.querySelector('li.filmTitle a');
    if (!a) continue;
    // 開眼部分特殊符號（如「〜」）會變成問號
    let title = text(a).replace(/\s*\?\s*/g, ' ').trim();
    // 休館、包場等公告不是電影
    if (/^(休館|公休|暫停營業|停映|包場|維修|清場)/.test(title)) continue;
    let format = '';
    const vm = title.match(VER_RE);
    if (vm) { format = vm[1].trim(); title = title.replace(VER_RE, '').trim(); }
    const fid = (a.getAttribute('href').match(/\/movie\/(\w+)/) || [])[1] || title;
    const img = ul.querySelector('img[src*="/photo"]');
    const cer = (ul.innerHTML.match(/cer_(\w+)\.gif/) || [])[1] || '';
    const rt = (ul.textContent.match(/片長[：:]\s*(\d+)\s*分/) || [])[1];
    const times = [...ul.querySelectorAll('li')]
      .map((li) => text(li).replace(/：/g, ':'))
      .filter((t) => /^\d{1,2}:\d{2}$/.test(t))
      .map((t) => t.padStart(5, '0'));
    films.push({ fid, title, format, poster: img ? abs(img.getAttribute('src'), BASE + '/') : '', rating: normRating(CER[cer] || ''), runtime: rt ? +rt : 0, times });
  }
  // 其他已公布日期
  const dates = [...new Set([...html.matchAll(/\/showtime\/t\w+\/a\d+\/(\d{8})\//g)].map((m) => `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`))].sort();
  // 戲院基本資料
  const name = text(doc.querySelector('h2'));
  const info = doc.querySelector('h2')?.parentElement;
  const infoText = info ? info.textContent : '';
  const addr = ((infoText.match(/地址[:：]\s*([^\n(（]+)/) || [])[1] || '').trim();
  const web = info ? [...info.querySelectorAll('a[href^="http"]')].map((x) => x.getAttribute('href')).find((h) => !/atmovies/.test(h)) || '' : '';
  return { date, films, dates, name, addr, web };
}

export async function scrape() {
  const cinemas = [], movies = new Map(), shows = [];
  await pool(THEATERS, 2, async ([tid, area]) => {
    const pageUrl = `${BASE}/showtime/${tid}/${area}/`;
    try {
      const first = parseDay(await fetchText(pageUrl));
      if (!first.name) return;
      const id = 'at-' + tid;
      const city = cityOf(first.addr, first.name);
      cinemas.push({ id, chain, name: first.name, addr: first.addr, city, region: regionOf(city, first.addr, first.name), site: first.web || pageUrl, ticketUrl: first.web || pageUrl });
      const days = [first];
      for (const d of first.dates.filter((x) => x > first.date).slice(0, MAX_DAYS - 1)) {
        await sleep(300);
        try { days.push(parseDay(await fetchText(`${pageUrl}${d.replace(/-/g, '')}/`))); } catch (e) { console.warn(`  ! ${first.name} ${d}：${e.message}`); }
      }
      for (const day of days) {
        if (!day.date) continue;
        for (const f of day.films) {
          if (!movies.has(f.fid)) movies.set(f.fid, { key: f.fid, title: f.title, en: '', poster: f.poster, runtime: f.runtime, rating: f.rating, genre: '', release: '', synopsis: '' });
          for (const t of f.times) shows.push({ cinema: id, movieKey: f.fid, date: day.date, time: t, format: f.format, hall: '', url: first.web || pageUrl });
        }
      }
    } catch (e) {
      console.warn(`  ! 開眼 ${tid} 失敗：${e.message}`);
    }
    await sleep(300);
  });
  return { cinemas, movies: [...movies.values()], shows };
}
