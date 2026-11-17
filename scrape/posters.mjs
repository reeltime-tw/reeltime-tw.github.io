// 下載海報、縮成手機用大小（寬 300px、WebP），存到 docs/posters/ 和網站一起發布
// 目的：避免影城官網防盜連讓海報顯示不出來，也讓手機載入更快。
// 已下載過的不重抓；不再使用的海報檔會被刪除。下載失敗就沿用原本的官網網址。
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool } from './util.mjs';

const WIDTH = 300;
const MAX_SRC = 15 * 1024 * 1024;

async function download(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', Referer: new URL(url).origin + '/' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (!type.startsWith('image/')) throw new Error('不是圖片 ' + type);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000 || buf.length > MAX_SRC) throw new Error('檔案大小不合理 ' + buf.length);
    return buf;
  } finally { clearTimeout(timer); }
}

/** movies: 輸出用的電影清單；成功的會加上 posterLocal（相對於 docs/ 的路徑） */
export async function savePosters(movies, outDir) {
  const { default: sharp } = await import('sharp');
  const dir = path.join(outDir, 'posters');
  await fs.mkdir(dir, { recursive: true });
  const existing = new Set(await fs.readdir(dir));

  // 同一個海報網址只處理一次
  const byUrl = new Map();
  for (const m of movies) {
    if (!/^https?:\/\//.test(m.poster || '')) continue;
    if (!byUrl.has(m.poster)) byUrl.set(m.poster, []);
    byUrl.get(m.poster).push(m);
  }

  const keep = new Set();
  let added = 0, failed = 0;
  await pool([...byUrl], 4, async ([url, ms]) => {
    const file = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + '.webp';
    if (!existing.has(file)) {
      try {
        const img = await sharp(await download(url)).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
        await fs.writeFile(path.join(dir, file), img);
        added++;
      } catch { failed++; return; }
    }
    keep.add(file);
    for (const m of ms) m.posterLocal = 'posters/' + file;
  });

  let removed = 0;
  for (const f of existing) if (!keep.has(f)) { await fs.rm(path.join(dir, f), { force: true }); removed++; }
  console.log(`海報：${keep.size} 張（新下載 ${added}、移除 ${removed}${failed ? `、${failed} 張下載失敗，沿用官網網址` : ''}）`);
}
