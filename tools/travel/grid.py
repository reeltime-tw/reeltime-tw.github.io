"""共用網格公式（Python 版）。

JS 版（docs/index.html 內嵌）必須與此檔案的公式逐字一致，否則手機查表會對不到
伺服器算好的格子。任何修改都要同步改兩邊，並重新跑
test/travel_grid.mjs 驗證一致。

網格原點刻意選在台灣西南外海，確保全島座標的 row/col 都是非負整數。
"""

import math

LAT0 = 21.8
LON0 = 119.3
CELL_M = 500  # 格子邊長（公尺）
REF_LAT_DEG = 23.7  # 用來換算經度公尺數的參考緯度（約台灣中部）

M_PER_DEG_LAT = 111320.0
D_LAT = CELL_M / M_PER_DEG_LAT
D_LON = CELL_M / (M_PER_DEG_LAT * math.cos(math.radians(REF_LAT_DEG)))


def cell_of(lat: float, lon: float) -> tuple[int, int]:
    """回傳 (row, col)。lat/lon 需在合理台灣範圍內（否則可能得到負值）。"""
    row = math.floor((lat - LAT0) / D_LAT)
    col = math.floor((lon - LON0) / D_LON)
    return row, col


def cell_center(row: int, col: int) -> tuple[float, float]:
    """回傳格子中心點的 (lat, lon)，供驗證或畫圖使用。"""
    lat = LAT0 + (row + 0.5) * D_LAT
    lon = LON0 + (col + 0.5) * D_LON
    return lat, lon


if __name__ == "__main__":
    # 快速自我檢查：印出公式用的常數，方便跟 JS 版比對
    print(f"D_LAT={D_LAT!r} D_LON={D_LON!r}")
    r, c = cell_of(25.0418, 121.5654)  # 台北車站附近
    print(f"台北車站 -> row={r} col={c} -> center={cell_center(r, c)}")
