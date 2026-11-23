/* Reeltime 背景程式：只做兩件事，不做離線快取（避免看到舊場次）
 * 1. periodicsync：背景抓本網站的 data.json，用跟頁面同一套規則比對追蹤，有新場次就跳通知
 * 2. notificationclick：點通知開啟「追蹤」頁
 * 只會讀自己網站的檔案，不連任何外部網址。 */
importScripts('watch-core.js');
const WC=self.WatchCore;

self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));

self.addEventListener('periodicsync',e=>{if(e.tag==='twc-watch')e.waitUntil(checkWatches())});

async function checkWatches(){
  // 先抓資料再讀追蹤，縮短和頁面同時寫入的空檔
  const r=await fetch(new URL('data.json',self.registration.scope),{cache:'no-cache'});
  if(!r.ok)return;
  const data=await r.json();
  if(!Array.isArray(data.showtimes)||!data.showtimes.length)return;
  const list=(await WC.idbGet('watches'))||[];
  if(!list.length)return;
  const favs=(await WC.idbGet('favs'))||[];
  const now=new Date(),byC=Object.fromEntries((data.cinemas||[]).map(c=>[c.id,c]));
  for(const w of list){
    const res=WC.refresh(w,data,favs,now);
    w.rev=Date.now();
    if(res.fresh.length){
      const t=WC.noteText(w,res.fresh,byC);
      await self.registration.showNotification(t.title,{body:t.body,icon:'icon-192.png',badge:'icon-192.png',tag:'twc-'+w.id,renotify:true,data:{url:'./#/watch'}});
    }
  }
  await WC.idbSet('watches',list);
}

self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=new URL((e.notification.data&&e.notification.data.url)||'./#/watch',self.registration.scope).href;
  e.waitUntil((async()=>{
    const cs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of cs){
      if(c.url.startsWith(self.registration.scope)){await c.focus();c.postMessage({goto:'#/watch'});return}
    }
    await self.clients.openWindow(url);
  })());
});
