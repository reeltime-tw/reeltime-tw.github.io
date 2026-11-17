// 威秀第一輪被拒（403），其他影城跑完後恢復 → 重試應成功
import './mock.mjs';
const f=globalThis.fetch; let blocked=true;
globalThis.fetch=async(u,o)=>{ const s=String(u); if(s.includes('luxcinema')) blocked=false; if(s.includes('vscinemas')&&blocked) return new Response('',{status:403}); return f(u,o); };
