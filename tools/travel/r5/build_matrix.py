"""用 r5py 算「大眾運輸＋步行」從一批取樣起點到 3 間試算影城的時間矩陣。

開發探索用（在 .github/workflows/r5py-explore.yml 跑），先驗證整條流程可行：
  OSM pbf（裁切後的小範圍）＋ GTFS（捷運、公車）→ r5py.TransportNetwork
  → r5py.TravelTimeMatrixComputer → 印出結果。

之後擴大到全台 102 間影城時，這支程式會被改成讀 docs/cinema-geo.json
逐一算（而不是這裡寫死的 3 間試算影城），並把結果存成給 App 查表用的格式。
"""

from __future__ import annotations

import datetime
import sys

import r5py


PILOT_CINEMAS = [
    ("信義威秀", 25.0353, 121.5666),
    ("西門威秀", 25.0438, 121.5055),
    ("新店裕隆城威秀", 24.9784, 121.5468),
]

# 幾個分散在台北／新北的取樣起點，用來看矩陣算出來的時間是否合理
SAMPLE_ORIGINS = [
    ("台北車站", 25.0478, 121.5171),
    ("西門站", 25.0421, 121.5076),
    ("市政府站", 25.0406, 121.5677),
    ("新店站", 24.9674, 121.5386),
    ("公館站", 25.0147, 121.5345),
]


def main():
    osm_pbf = sys.argv[1] if len(sys.argv) > 1 else "taipei-small.osm.pbf"
    gtfs_paths = sys.argv[2:] if len(sys.argv) > 2 else ["gtfs_out/metro.zip", "gtfs_out/bus.zip"]

    print(f"[r5py] 建立 TransportNetwork：osm={osm_pbf}, gtfs={gtfs_paths}")
    network = r5py.TransportNetwork(osm_pbf, gtfs_paths)

    import geopandas as gpd
    import pandas as pd
    from shapely.geometry import Point

    origins = gpd.GeoDataFrame(
        {"id": [n for n, _, _ in SAMPLE_ORIGINS]},
        geometry=[Point(lon, lat) for _, lat, lon in SAMPLE_ORIGINS],
        crs="EPSG:4326",
    )
    destinations = gpd.GeoDataFrame(
        {"id": [n for n, _, _ in PILOT_CINEMAS]},
        geometry=[Point(lon, lat) for _, lat, lon in PILOT_CINEMAS],
        crs="EPSG:4326",
    )

    # 平日早上出發，上班通勤時段比較有代表性
    departure = datetime.datetime(2026, 11, 19, 8, 30)  # 2026-11-19 是週四

    # r5py 1.x 的 API：TravelTimeMatrix 本身就是 pandas.DataFrame 的子類別，
    # 建構時直接算好結果，不像舊版（r5py-fork／早期教學常見的寫法）要另外
    # 呼叫 TravelTimeMatrixComputer(...).compute_travel_times()。
    # 這裡先試新版 API，找不到才退回舊版寫法，兩種安裝環境都能跑。
    if hasattr(r5py, "TravelTimeMatrix"):
        matrix = r5py.TravelTimeMatrix(
            network,
            origins=origins,
            destinations=destinations,
            departure=departure,
            transport_modes=[r5py.TransportMode.TRANSIT, r5py.TransportMode.WALK],
        )
    else:
        computer = r5py.TravelTimeMatrixComputer(
            network,
            origins=origins,
            destinations=destinations,
            departure=departure,
            transport_modes=[r5py.TransportMode.TRANSIT, r5py.TransportMode.WALK],
        )
        matrix = computer.compute_travel_times()

    pd.set_option("display.max_rows", None)
    pd.set_option("display.width", 200)
    print("[r5py] 結果（travel_time 單位：分鐘）：")
    print(matrix)


if __name__ == "__main__":
    main()
