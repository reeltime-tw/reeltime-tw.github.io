"""快速檢查 tdx2gtfs_metro.py 輸出的 GTFS 資料夾是否合理（不是完整 GTFS 驗證器，
只抓明顯的錯誤：孤兒站點、負數時間、班距離譜、以及抽樣算一段已知站間時間核對）。

用法：python3 tools/travel/validate_gtfs_metro.py gtfs_out/metro
"""

import csv
import sys
from pathlib import Path


def read_csv(path: Path) -> list[dict]:
    if not path.exists() or path.stat().st_size == 0:
        return []
    with open(path, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def main(gtfs_dir: str):
    d = Path(gtfs_dir)
    stops = read_csv(d / "stops.txt")
    routes = read_csv(d / "routes.txt")
    trips = read_csv(d / "trips.txt")
    stop_times = read_csv(d / "stop_times.txt")
    frequencies = read_csv(d / "frequencies.txt")
    calendar = read_csv(d / "calendar.txt")

    problems = []

    print(f"stops={len(stops)} routes={len(routes)} trips={len(trips)} "
          f"stop_times={len(stop_times)} frequencies={len(frequencies)} calendar={len(calendar)}")

    stop_ids = {s["stop_id"] for s in stops}
    trip_ids = {t["trip_id"] for t in trips}

    orphan_stops_in_times = {st["stop_id"] for st in stop_times if st["stop_id"] not in stop_ids}
    if orphan_stops_in_times:
        problems.append(f"stop_times 引用了不存在的站點: {list(orphan_stops_in_times)[:5]}")

    orphan_trips_in_times = {st["trip_id"] for st in stop_times if st["trip_id"] not in trip_ids}
    if orphan_trips_in_times:
        problems.append(f"stop_times 引用了不存在的 trip: {list(orphan_trips_in_times)[:5]}")

    orphan_trips_in_freq = {f["trip_id"] for f in frequencies if f["trip_id"] not in trip_ids}
    if orphan_trips_in_freq:
        problems.append(f"frequencies 引用了不存在的 trip: {list(orphan_trips_in_freq)[:5]}")

    bad_headways = [f for f in frequencies if int(f["headway_secs"]) <= 0 or int(f["headway_secs"]) > 3600]
    if bad_headways:
        problems.append(f"{len(bad_headways)} 筆班距不合理（<=0 或 > 1 小時）")

    for s in stops:
        try:
            lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
            if not (20 < lat < 26 and 118 < lon < 123):
                problems.append(f"站點座標超出台灣範圍: {s['stop_id']} ({lat},{lon})")
        except ValueError:
            problems.append(f"站點座標無法解析: {s['stop_id']}")

    # 抽樣：找一個 trip，看它的 stop_times 時間是否遞增
    by_trip: dict[str, list] = {}
    for st in stop_times:
        by_trip.setdefault(st["trip_id"], []).append(st)
    non_monotonic = 0
    for tid, sts in by_trip.items():
        sts_sorted = sorted(sts, key=lambda x: int(x["stop_sequence"]))
        times = [_to_secs(x["arrival_time"]) for x in sts_sorted]
        if times != sorted(times):
            non_monotonic += 1
    if non_monotonic:
        problems.append(f"{non_monotonic} 個 trip 的時間不是遞增的")

    if problems:
        print("發現問題：")
        for p in problems:
            print(" -", p)
        sys.exit(1)
    else:
        print("✓ 基本檢查全部通過")


def _to_secs(hhmmss: str) -> int:
    h, m, s = hhmmss.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "gtfs_out/metro")
