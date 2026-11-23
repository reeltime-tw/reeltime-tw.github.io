// Reeltime 推播伺服器（Cloudflare Workers 免費方案）
// 只保存每支手機的「推播位址＋追蹤條件」，不做比對、不發推播。
// 比對新場次與發送推播由使用者的電腦負責（scrape/push.mjs），電腦用管理金鑰讀取這裡的資料。
// 不保存位置、帳號或任何個資；90 天沒更新的裝置自動刪除。

const ORIGINS = ['https://reeltime-tw.github.io', 'http://localhost:8765'];
const ID = '[A-Za-z0-9_-]{16,64}';
const str = (v, n) => String(v ?? '').slice(0, n);
const arr = (v, n, m) => (Array.isArray(v) ? v.slice(0, n).map((x) => str(x, m)) : []);

/** 只留下需要的欄位並限制長度，避免被塞入大量資料 */
function cleanWatches(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 50).map((w) => ({
    id: str(w.id, 40), movie: str(w.movie, 40), title: str(w.title, 80), area: str(w.area || '全台', 20),
    dates: arr(w.dates, 31, 10), from: str(w.from, 5), to: str(w.to, 5), favs: arr(w.favs, 60, 60),
  })).filter((w) => w.id && w.movie);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const isAdmin = () => env.ADMIN_TOKEN && req.headers.get('Authorization') === 'Bearer ' + env.ADMIN_TOKEN;

    // 手機：上傳或刪除自己的推播位址與追蹤條件（裝置 ID 是手機自己產生的隨機字串）
    let m = url.pathname.match(new RegExp(`^/device/(${ID})$`));
    if (m) {
      if (!ORIGINS.includes(origin)) return json({ error: 'origin' }, 403);
      const key = 'd:' + m[1];
      if (req.method === 'PUT') {
        const body = await req.text();
        if (body.length > 30000) return json({ error: 'too large' }, 413);
        let d; try { d = JSON.parse(body); } catch { return json({ error: 'json' }, 400); }
        const s = d.subscription;
        if (!s || typeof s.endpoint !== 'string' || !/^https:\/\/[^\s]{10,800}$/.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth)
          return json({ error: 'subscription' }, 400);
        const watches = cleanWatches(d.watches);
        if (!watches.length) { await env.WATCHES.delete(key); return json({ ok: true, watches: 0 }); }
        const rec = { subscription: { endpoint: s.endpoint, keys: { p256dh: str(s.keys.p256dh, 200), auth: str(s.keys.auth, 100) } }, watches, updated: new Date().toISOString() };
        await env.WATCHES.put(key, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 90 });
        return json({ ok: true, watches: watches.length });
      }
      if (req.method === 'DELETE') { await env.WATCHES.delete(key); return json({ ok: true }); }
      return json({ error: 'method' }, 405);
    }

    // 電腦：讀取全部裝置（需要管理金鑰）
    if (url.pathname === '/all' && req.method === 'GET') {
      if (!isAdmin()) return json({ error: 'auth' }, 401);
      const devices = [];
      let cursor;
      do {
        const l = await env.WATCHES.list({ prefix: 'd:', cursor });
        for (const k of l.keys) { const v = await env.WATCHES.get(k.name); if (v) devices.push({ device: k.name.slice(2), ...JSON.parse(v) }); }
        cursor = l.list_complete ? null : l.cursor;
      } while (cursor);
      return json({ devices });
    }
    // 電腦：推播位址失效（使用者關閉通知或刪除 App）時刪除
    m = url.pathname.match(new RegExp(`^/all/(${ID})$`));
    if (m && req.method === 'DELETE') {
      if (!isAdmin()) return json({ error: 'auth' }, 401);
      await env.WATCHES.delete('d:' + m[1]);
      return json({ ok: true });
    }
    return json({ service: 'reeltime-push', ok: true });
  },
};
