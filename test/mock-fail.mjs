import './mock.mjs';
const f=globalThis.fetch; globalThis.fetch=async(u)=>String(u).includes('showtimes.com.tw')?new Response('x',{status:503}):f(u);
