"""對已啟動的 osrm-routed 伺服器（car/scooter/foot 各一個 port），用 /table API
算「某間影城方圓 radius_km 內，每個 500m 網格的中心點 → 影城」的時間。

不另外檢查格子附近有沒有 OSM 道路——直接讓 OSRM 自己做最近道路的snap，
snap 不到（離道路太遠，例如海上、山裡）的格子，/table 回應裡該項會是
null，我們就直接標成「不可達」，效果等同「只算有人的格子」。

每個 server 一次最多送 BATCH_SIZE 個來源點（避免矩陣過大被伺服器拒絕或太慢），
分批呼叫、合併結果。

輸出：CSV，欄位 row,col,car_min,scooter_min,foot_min（都是「未校正」的原始
OSRM 分鐘數；校正倍率留給 pack_bin.py 處理，這裡只管算時間）。

用法：
  python3 compute_osrm_grid.py <cinema_lat> <cinema_lon> <radius_km> <out_csv> \
      --car-port 5000 --scooter-port 5001 --foot-port 5002
"""
from __future__ import annotations

import argparse
import csv
import math
import sys
import time
import urllib.request
import json as jsonlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from grid import cell_of, cell_center, D_LAT, D_LON  # noqa: E402

BATCH_SIZE = 100


def cells_in_radius(lat: float, lon: float, radius_km: float):
    """回傳覆蓋以 (lat,lon) 為中心、半徑 radius_km 的所有格子 (row,col)。"""
    r0, c0 = cell_of(lat, lon)
    # 粗估半徑對應多少格（留一點餘裕），再用實際距離過濾成圓形範圍
    rows = math.ceil(radius_km * 1000 / (D_LAT * 111320.0)) + 1
    cols = math.ceil(radius_km * 1000 / (D_LON * 111320.0 * math.cos(math.radians(lat)))) + 1
    out = []
    for dr in range(-rows, rows + 1):
        for dc in range(-cols, cols + 1):
            r, c = r0 + dr, c0 + dc
            clat, clon = cell_center(r, c)
            d = haversine_km(lat, lon, clat, clon)
            if d <= radius_km:
                out.append((r, c, clat, clon))
    return out


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def table_durations(port: int, sources_lonlat: list[tuple[float, float]], dest_lonlat: tuple[float, float]) -> list[float | None]:
    """呼叫一個 osrm-routed 的 /table，sources 為多點、destination 為單一影城點。
    回傳跟 sources 等長的秒數清單（None 表示不可達）。"""
    coords = sources_lonlat + [dest_lonlat]
    coord_str = ";".join(f"{lon:.6f},{lat:.6f}" for lon, lat in coords)
    n = len(sources_lonlat)
    url = (
        f"http://localhost:{port}/table/v1/driving/{coord_str}"
        f"?sources={';'.join(str(i) for i in range(n))}&destinations={n}&annotations=duration"
    )
    with urllib.request.urlopen(url, timeout=60) as resp:
        data = jsonlib.loads(resp.read().decode("utf-8"))
    if data.get("code") != "Ok":
        raise RuntimeError(f"OSRM table 失敗：{data}")
    return [row[0] for row in data["durations"]]


def compute_mode(port: int, cells: list[tuple[int, int, float, float]], dest_lat: float, dest_lon: float) -> dict[tuple[int, int], float | None]:
    out = {}
    for i in range(0, len(cells), BATCH_SIZE):
        batch = cells[i : i + BATCH_SIZE]
        sources = [(lon, lat) for (_, _, lat, lon) in batch]
        secs = table_durations(port, sources, (dest_lon, dest_lat))
        for (r, c, _, _), s in zip(batch, secs):
            out[(r, c)] = None if s is None else s / 60.0
        print(f"  [port {port}] {i + len(batch)}/{len(cells)} 完成")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lat", type=float)
    ap.add_argument("lon", type=float)
    ap.add_argument("radius_km", type=float)
    ap.add_argument("out_csv")
    ap.add_argument("--car-port", type=int, default=5000)
    ap.add_argument("--scooter-port", type=int, default=5001)
    ap.add_argument("--foot-port", type=int, default=5002)
    args = ap.parse_args()

    cells = cells_in_radius(args.lat, args.lon, args.radius_km)
    print(f"[osrm-grid] 影城 ({args.lat},{args.lon})，半徑 {args.radius_km}km，共 {len(cells)} 個格子")

    t0 = time.time()
    car = compute_mode(args.car_port, cells, args.lat, args.lon)
    scooter = compute_mode(args.scooter_port, cells, args.lat, args.lon)
    foot = compute_mode(args.foot_port, cells, args.lat, args.lon)
    print(f"[osrm-grid] 算完，花了 {time.time() - t0:.1f} 秒")

    with open(args.out_csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["row", "col", "car_min", "scooter_min", "foot_min"])
        for r, c, _, _ in cells:
            cm = car.get((r, c))
            sm = scooter.get((r, c))
            fm = foot.get((r, c))
            w.writerow([r, c, "" if cm is None else round(cm, 2), "" if sm is None else round(sm, 2), "" if fm is None else round(fm, 2)])
    print(f"[osrm-grid] 已寫入 {args.out_csv}")


if __name__ == "__main__":
    main()
