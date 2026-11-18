// 驗證 JS 網格公式（tools/travel/grid.mjs）與 Python 版（tools/travel/grid.py）
// 在同一批隨機座標上算出完全相同的 row/col。
//
// 用法：node test/travel_grid.mjs
// 測資 test/fixtures_travel_grid.json 由 Python 產生（見 plans/travel-time.md）。

import { readFileSync } from 'node:fs';
import { cellOf, D_LAT, D_LON } from '../tools/travel/grid.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures_travel_grid.json', import.meta.url)));

let fail = 0;

const dLatDiff = Math.abs(D_LAT - fixture.D_LAT);
const dLonDiff = Math.abs(D_LON - fixture.D_LON);
if (dLatDiff > 1e-12 || dLonDiff > 1e-12) {
  console.error(`✗ 常數不一致：D_LAT diff=${dLatDiff} D_LON diff=${dLonDiff}`);
  fail++;
}

for (const p of fixture.points) {
  const [row, col] = cellOf(p.lat, p.lon);
  if (row !== p.row || col !== p.col) {
    console.error(`✗ (${p.lat}, ${p.lon}) JS=(${row},${col}) Python=(${p.row},${p.col})`);
    fail++;
  }
}

if (fail === 0) {
  console.log(`✓ ${fixture.points.length} 個點全部一致`);
  process.exit(0);
} else {
  console.error(`共 ${fail} 處不一致`);
  process.exit(1);
}
