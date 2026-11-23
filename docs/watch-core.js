/* Reeltime 追蹤場次：頁面（index.html）與背景程式（sw.js）共用的比對規則。
 * 兩邊一定要用同一份，否則「有新場次」的判斷會不一致。純函式，不連網路、不碰畫面。
 * 一筆追蹤：{id, movie, title, area:'台北市'|'全台'|'fav', dates:[YYYY-MM-DD]（空＝不限）, from, to,
 *            seen:[場次鍵], newKeys:[場次鍵], created, checkedAt, rev}
 * 場次鍵：cinema|date|time|format */
(function(root){
'use strict';
const pad=n=>String(n).padStart(2,'0');
const WD=['日','一','二','三','四','五','六'];
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const hm=d=>pad(d.getHours())+':'+pad(d.getMinutes());
// 影城把凌晨 0–3 點的午夜場列在前一天，排序時當成 24–27 點
const tkey=t=>{const h=+t.slice(0,2);return String(h<4?h+24:h).padStart(2,'0')+t.slice(2)};
const mdShort=s=>{const [y,m,d]=s.split('-').map(Number);return m+'/'+d+'（'+WD[new Date(y,m-1,d).getDay()]+'）'};

/* ---- 縣市（舊資料沒有縣市時，從店名推斷）---- */
const COUNTY=/^(苗栗|彰化|南投|雲林|屏東|宜蘭|花蓮|台東|澎湖|金門|連江)$/; // 「花蓮市」等縣轄市一律歸到縣
function cityOf(c){
  if(c._city)return c._city;
  const t=(c.city||'')+' '+c.name+' '+(c.addr||'');
  const m=t.replace(/臺/g,'台').match(/(台北|新北|基隆|桃園|新竹|苗栗|台中|彰化|南投|雲林|嘉義|台南|高雄|屏東|宜蘭|花蓮|台東|澎湖|金門|連江)(市|縣)?/);
  if(m)return m[1]+(COUNTY.test(m[1])?'縣':(m[2]||'市'));
  const D={'新北市':/板橋|新店|中和|永和|土城|林口|三重|新莊|汐止|淡水/,'桃園市':/中壢|青埔|蘆竹/,'新竹縣':/竹北/,'苗栗縣':/頭份|竹南/,'台中市':/大里|豐原/,'高雄市':/岡山|鳳山|左營/,'宜蘭縣':/羅東/};
  for(const k in D)if(D[k].test(t))return k;
  return c.region||'其他';
}

const keyOf=s=>s.cinema+'|'+s.date+'|'+s.time+'|'+(s.format||'');
const dateOfKey=k=>k.split('|')[1]||'';
// 已開演：今天且時間已過（凌晨 0–3 點的午夜場算今晚，不算已開演）；今天以前一律算過去
function isPast(s,now){
  const today=ymd(now);
  if(s.date<today)return true;
  if(s.date>today)return false;
  return s.time<hm(now)&&+s.time.slice(0,2)>=4;
}
function inPeriod(t,from,to){const k=tkey(t);if(from&&k<tkey(from))return false;if(to&&k>tkey(to))return false;return true}

// 這筆追蹤的地區包含哪些影城（回傳 Set）
function areaSet(w,cinemas,favs){
  const f=new Set(favs||[]);const out=new Set();
  for(const c of cinemas){
    if(w.area==='全台'||(w.area==='fav'?f.has(c.id):cityOf(c)===w.area))out.add(c.id);
  }
  return out;
}
// 目前符合條件的場次（含午夜場規則；不含已開演）
// 日期條件：dateFrom／dateTo（日期範圍，2026-11-24 起的新格式，任一可留空）；舊資料用 dates（指定日期清單）
function matching(w,shows,cinemas,favs,now){
  const today=ymd(now),set=areaSet(w,cinemas,favs),ds=new Set(w.dates||[]),df=w.dateFrom||'',dt=w.dateTo||'';
  const out=[];
  for(const s of shows){
    if(s.movie!==w.movie||!set.has(s.cinema))continue;
    if(ds.size?!ds.has(s.date):s.date<today)continue;
    if((df&&s.date<df)||(dt&&s.date>dt))continue;
    if(!inPeriod(s.time,w.from,w.to))continue;
    if(isPast(s,now))continue;
    out.push(s);
  }
  return out;
}
// 指定日期全部過期＝已結束
const expired=(w,now)=>(!!(w.dates&&w.dates.length)&&w.dates.every(d=>d<ymd(now)))||(!!w.dateTo&&w.dateTo<ymd(now));

/* 重新比對：把「符合但沒看過」的場次放進 newKeys，回傳 {matches, fresh}
 * fresh 只含這一次才發現的新場次（拿來決定要不要跳通知，已經在 newKeys 裡的不會再通知一次） */
function refresh(w,data,favs,now){
  const today=ymd(now);
  if(expired(w,now)){w.checkedAt=now.getTime();return{matches:[],fresh:[]}}
  const list=matching(w,data.showtimes||[],data.cinemas||[],favs,now);
  const cur=new Set(list.map(keyOf)),seen=new Set(w.seen||[]),nk=new Set(w.newKeys||[]);
  const fresh=[];
  for(const s of list){const k=keyOf(s);if(!seen.has(k)&&!nk.has(k)){nk.add(k);fresh.push(s)}}
  w.newKeys=[...nk].filter(k=>cur.has(k));
  w.seen=[...seen].filter(k=>dateOfKey(k)>=today); // 過去的場次不用再記
  w.checkedAt=now.getTime();
  return{matches:list,fresh};
}
// 建立或看過之後：目前符合的全部算已看過
function markSeen(w,matches){
  const seen=new Set(w.seen||[]);
  for(const s of matches)seen.add(keyOf(s));
  for(const k of w.newKeys||[])seen.add(k);
  w.seen=[...seen];w.newKeys=[];
}
// 通知文字：標題「Reeltime：《片名》有 N 個新場次」，內文列前 3 場
function noteText(w,fresh,cinemasById){
  const l=fresh.slice().sort((a,b)=>a.date.localeCompare(b.date)||tkey(a.time).localeCompare(tkey(b.time)));
  const lines=l.slice(0,3).map(s=>mdShort(s.date)+s.time+' '+((cinemasById[s.cinema]||{}).name||''));
  if(l.length>3)lines.push('…還有 '+(l.length-3)+' 場');
  return{title:'Reeltime：《'+w.title+'》有 '+l.length+' 個新場次',body:lines.join('\n')};
}
// 條件摘要：「台北市・11/28、11/29・18:00 後」
function summary(w){return summaryParts(w).join('・')}
// 條件拆成三段（地區、日期、時段），畫面上分開顯示
function summaryParts(w){
  const area=w.area==='fav'?'常用影城':w.area;
  const md=d=>{const [,m,dd]=d.split('-').map(Number);return m+'/'+dd};
  const ds=(w.dates||[]).slice().sort().map(md);
  const date=ds.length?ds.join('、'):w.dateFrom&&w.dateTo?(w.dateFrom===w.dateTo?md(w.dateFrom):md(w.dateFrom)+'–'+md(w.dateTo)):w.dateFrom?md(w.dateFrom)+' 起':w.dateTo?md(w.dateTo)+' 前':'日期不限';
  const p=w.from&&w.to?w.from+'–'+w.to:w.from?w.from+' 後':w.to?w.to+' 前':'時段不限';
  return [area,date,p];
}

/* ---- IndexedDB（背景程式讀不到 localStorage，所以追蹤資料多存一份在這裡）---- */
function idbOpen(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open('twc',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('kv');
    r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
  });
}
async function idbGet(key){
  const db=await idbOpen();
  return new Promise((res,rej)=>{const q=db.transaction('kv').objectStore('kv').get(key);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});
}
async function idbSet(key,val){
  const db=await idbOpen();
  return new Promise((res,rej)=>{const t=db.transaction('kv','readwrite');t.objectStore('kv').put(val,key);t.oncomplete=()=>res();t.onerror=()=>rej(t.error)});
}

const api={ymd,hm,tkey,cityOf,keyOf,isPast,inPeriod,areaSet,matching,expired,refresh,markSeen,noteText,summary,summaryParts,mdShort,idbGet,idbSet};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.WatchCore=api;
})(typeof self!=='undefined'?self:globalThis);
