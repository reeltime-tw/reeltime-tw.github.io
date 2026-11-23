// 排程計算：把「公告爬蟲找到的時間」和「手動規則」整理成 data/schedule.json
// windows/sync-schedule.ps1 會讀這個檔，在 Windows 工作排程器建立對應的自動更新排程。
//
// 用法：node scrape/schedule.mjs          產生 data/schedule.json
//       node scrape/schedule.mjs --print  另外印出人看得懂的清單
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { taipei } from './util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OFFSETS = [10, 45]; // 公布後第 10 分鐘抓一次，第 45 分鐘再抓一次（官網與各平台更新有時間差）
const WD = '日一二三四五六';

async function readJSON(p, fallback) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; } }

/** 目前有哪些連鎖可以單獨更新（與 index.mjs 的 CHAINS 一致） */
async function knownChains() {
  const dir = path.join(ROOT, 'scrape', 'chains');
  const out = new Set();
  for (const f of await fs.readdir(dir)) if (f.endsWith('.mjs')) out.add((await import(pathToFileURL(path.join(dir, f)).href)).chain);
  return out;
}

/** 純函式：由公告與規則算出排程（方便測試） */
export function buildTasks({ announcements = [], rules = [], chains, now = new Date() }) {
  const nowKey = (() => { const t = taipei(now); return `${t.date}T${t.time}`; })();
  const tasks = new Map();
  const skipped = [];
  const add = (chain, trig) => {
    const isAll = chain === '*';
    if (!isAll && chains && !chains.has(chain)) { skipped.push(`${chain}（不在可更新的連鎖清單）`); return; }
    if (trig.kind === 'once' && trig.at <= nowKey) return; // 已經過去的單次公告不排
    const name = isAll ? '全部補查' : chain;
    if (!tasks.has(name)) tasks.set(name, { name: '公布 ' + name, chains: isAll ? [] : [chain], triggers: new Map() });
    const k = [trig.kind, trig.at || '', trig.dow ?? '', trig.time || ''].join('|');
    const t = tasks.get(name);
    if (!t.triggers.has(k)) t.triggers.set(k, { ...trig, offsets: trig.offsets || DEFAULT_OFFSETS });
  };
  for (const a of announcements) {
    const reason = `官網公告「${String(a.text || '').slice(0, 40)}」`;
    if (a.kind === 'once') add(a.chain, { kind: 'once', at: a.at, reason, source: a.source });
    else if (a.kind === 'weekly') add(a.chain, { kind: 'weekly', dow: a.dow, time: a.time, reason, source: a.source });
    else if (a.kind === 'daily') add(a.chain, { kind: 'daily', time: a.time, reason, source: a.source });
  }
  for (const r of rules) {
    const trig = { kind: r.kind, reason: r.note || '手動規則', source: 'data/publish-rules.json' };
    if (r.kind === 'once') trig.at = r.at; else trig.time = r.time;
    if (r.kind === 'weekly') trig.dow = r.dow;
    if (r.offsets) trig.offsets = r.offsets;
    if (r.kind === 'once' ? !r.at : !/^\d{2}:\d{2}$/.test(r.time || '')) { skipped.push(`手動規則格式不對：${JSON.stringify(r).slice(0, 60)}`); continue; }
    add(r.chain, trig);
  }
  const order = { weekly: 0, daily: 1, once: 2 };
  const list = [...tasks.values()].map((t) => ({
    ...t,
    triggers: [...t.triggers.values()].sort((a, b) => order[a.kind] - order[b.kind] || (a.dow ?? 0) - (b.dow ?? 0) || String(a.time || a.at).localeCompare(String(b.time || b.at))),
  })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  return { tasks: list, skipped };
}

export const describe = (t) => t.kind === 'weekly' ? `每週${WD[t.dow]} ${t.time}` : t.kind === 'daily' ? `每天 ${t.time}` : `${t.at.replace('T', ' ')}（單次）`;

async function main() {
  const ann = await readJSON(path.join(ROOT, 'data', 'announcements.json'), { items: [] });
  const rules = (await readJSON(path.join(ROOT, 'data', 'publish-rules.json'), { rules: [] })).rules || [];
  const { tasks, skipped } = buildTasks({ announcements: ann.items, rules, chains: await knownChains() });
  // 不放產生時間，內容沒變時檔案也不會變（避免每次都多一個 commit 差異）
  await fs.writeFile(path.join(ROOT, 'data', 'schedule.json'), JSON.stringify({ tasks }, null, 1) + '\n');
  console.log(`排程：${tasks.length} 個任務、${tasks.reduce((n, t) => n + t.triggers.length, 0)} 個觸發時間`);
  for (const w of skipped) console.log('  略過：' + w);
  if (process.argv.includes('--print')) for (const t of tasks) console.log(`\n${t.name}（更新：${t.chains.join('、') || '全部'}）\n${t.triggers.map((x) => `  ${describe(x)}　公布後 ${x.offsets.join('、')} 分鐘抓取\n    ← ${x.reason}`).join('\n')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
