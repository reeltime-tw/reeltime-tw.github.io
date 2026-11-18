"""用 r5py 算「某間影城方圓 radius_km 內，每個 500m 網格中心 → 影城」的
大眾運輸＋走路時間。

輸出：CSV，欄位 row,col,transit_min（未校正的原始 r5py 分鐘數；255/不可達
用空字串表示，跟 compute_osrm_grid.py 的格式一致，方便 pack_bin.py 統一處理）。

用法：
  python3 compute_transit_grid.py <osm_pbf> <cinema_lat> <cinema_lon> <radius_km> \
      <out_csv> <gtfs1.zip> [<gtfs2.zip> ...]
"""
from __future__ import annotations

import csv
import datetime
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from compute_osrm_grid import cells_in_radius  # noqa: E402


def main():
    osm_pbf = sys.argv[1]
    lat = float(sys.argv[2])
    lon = float(sys.argv[3])
    radius_km = float(sys.argv[4])
    out_csv = sys.argv[5]
    gtfs_paths = sys.argv[6:]

    import r5py
    import geopandas as gpd
    import pandas as pd
    from shapely.geometry import Point

    cells = cells_in_radius(lat, lon, radius_km)
    print(f"[transit-grid] 影城 ({lat},{lon})，半徑 {radius_km}km，共 {len(cells)} 個格子")

    network = r5py.TransportNetwork(osm_pbf, gtfs_paths)
    origins = gpd.GeoDataFrame(
        {"id": [f"{r}_{c}" for r, c, _, _ in cells]},
        geometry=[Point(clon, clat) for _, _, clat, clon in cells],
        crs="EPSG:4326",
    )
    destinations = gpd.GeoDataFrame({"id": ["cinema"]}, geometry=[Point(lon, lat)], crs="EPSG:4326")
    # 週四早上 8:30 出發，跟試算階段驗證用的時段一致
    departure = datetime.datetime(2026, 11, 19, 8, 30)

    if hasattr(r5py, "TravelTimeMatrix"):
        matrix = r5py.TravelTimeMatrix(
            network, origins=origins, destinations=destinations, departure=departure,
            transport_modes=[r5py.TransportMode.TRANSIT, r5py.TransportMode.WALK],
        )
    else:
        computer = r5py.TravelTimeMatrixComputer(
            network, origins=origins, destinations=destinations, departure=departure,
            transport_modes=[r5py.TransportMode.TRANSIT, r5py.TransportMode.WALK],
        )
        matrix = computer.compute_travel_times()

    by_id = {}
    for _, row in matrix.iterrows():
        tt = row.get("travel_time")
        if pd.notna(tt):
            by_id[row["from_id"]] = float(tt)

    with open(out_csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["row", "col", "transit_min"])
        for r, c, _, _ in cells:
            m = by_id.get(f"{r}_{c}")
            w.writerow([r, c, "" if m is None else round(m, 2)])
    print(f"[transit-grid] 已寫入 {out_csv}")


if __name__ == "__main__":
    main()
