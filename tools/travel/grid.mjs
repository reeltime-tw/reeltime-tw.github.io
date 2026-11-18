// 共用網格公式（JS 版）。
//
// 必須與 tools/travel/grid.py 的公式逐字一致，否則手機查表會對不到伺服器算好
// 的格子。任何修改都要同步改兩邊，並重新跑 test/travel_grid.mjs 驗證一致。
// 之後會把這段複製進 docs/index.html（保持常數與函式邏輯不變，不要重新推導）。

export const LAT0 = 21.8;
export const LON0 = 119.3;
export const CELL_M = 500;
export const REF_LAT_DEG = 23.7;

const M_PER_DEG_LAT = 111320.0;
export const D_LAT = CELL_M / M_PER_DEG_LAT;
export const D_LON = CELL_M / (M_PER_DEG_LAT * Math.cos((REF_LAT_DEG * Math.PI) / 180));

export function cellOf(lat, lon) {
  const row = Math.floor((lat - LAT0) / D_LAT);
  const col = Math.floor((lon - LON0) / D_LON);
  return [row, col];
}

export function cellCenter(row, col) {
  const lat = LAT0 + (row + 0.5) * D_LAT;
  const lon = LON0 + (col + 0.5) * D_LON;
  return [lat, lon];
}
