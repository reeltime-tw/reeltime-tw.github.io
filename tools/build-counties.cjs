// 產生 docs/tw-counties.json：App 在手機上判斷「座標在哪個縣市」用的邊界資料
// 來源：npm 套件 taiwan-atlas（MIT 授權，資料來自內政部國土測繪中心縣市界線）
// 用法（在暫存資料夾）：npm i taiwan-atlas topojson-client topojson-simplify
//   node tools/build-counties.cjs <node_modules 路徑> docs/tw-counties.json
const path = require('path'), fs = require('fs');
const nm = process.argv[2], out = process.argv[3];
const topo = require(path.join(nm, 'taiwan-atlas/counties-10t.json'));
const { feature } = require(path.join(nm, 'topojson-client'));
const { presimplify, simplify } = require(path.join(nm, 'topojson-simplify'));
const t = simplify(presimplify(topo), 2e-5); // 簡化到約 68KB；已用 30 個縣市交界地點驗證仍全部正確
const objName = Object.keys(t.objects)[0];
const fc = feature(t, t.objects[objName]);
const r = (n) => Math.round(n * 1e4) / 1e4; // 座標取到小數 4 位（約 10 公尺）
const counties = fc.features.map((f) => {
  const name = String(f.properties.COUNTYNAME || f.properties.name).replace(/臺/g, '台');
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  return { name, polys: polys.map((p) => p.map((ring) => ring.map(([x, y]) => [r(x), r(y)]))) };
});
fs.writeFileSync(out, JSON.stringify({ source: 'taiwan-atlas counties-10t (MIT)，內政部縣市界線', counties }));
console.log(counties.length, '個縣市', (fs.statSync(out).size / 1024).toFixed(1) + ' KB', counties.map((c) => c.name).join('、'));
