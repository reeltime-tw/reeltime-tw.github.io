"""把 compute_osrm_grid.py／compute_transit_grid.py 算出的原始分鐘數 CSV，
套上校正倍率，打包成 docs/travel/{cinemaId}.bin（見 plans/travel-time.md
「檔案格式」一節）。

格式：
  [4 bytes] header 長度 N（little-endian uint32）
  [N bytes] UTF-8 JSON header
  [之後] 每個 layer 依序接著一份 uint8 陣列，大小 = width*height，
         row-major（row 由小到大，每個 row 內 col 由小到大）。
         255 = 到不了或超過 254 分。

header JSON 內容：
  version, cinemaId, computedAt（ISO 日期）,
  lat0, lon0, cellM（跟 grid.py 的常數一致，供 App 端核對）,
  row0, col0（bbox 起始），width, height,
  layers（陣列，依序對應二進位資料的順序）,
  calibration（本次套用的校正倍率，記錄下來方便之後除錯／調整）

v1 的 layers：walk、scooter、car、transit（大眾運輸只算了平日早上 8:30
一個時段，還沒做尖峰/離峰百分位數，先用這一個時段當代表值；之後若要分
時段，再擴充 layers 清單，例如 transit_wd_am、transit_wd_pm）。
"""
from __future__ import annotations

import argparse
import csv
import datetime
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from grid import LAT0, LON0, CELL_M  # noqa: E402

# v1 校正倍率，來自 plans/travel-time.md「驗證進度」的結論（2026-11-18，
# 8-11 組 Google 地圖樣本的中位數倍率）。car/scooter 用 OSRM 原始分鐘數乘這個
# 倍率；walk 同理；transit 的校正已經做在 tdx2gtfs_bus.py 的 AVG_SPEED_KMH
# 裡（公車 25km/h）跟 tdx2gtfs_metro.py 的方向修正裡，這裡不用再乘倍率。
CALIBRATION = {
    "car": 2.32,
    "scooter": 1.99,
    "walk": 1.18,
    "transit": 1.0,
}


def read_osrm_csv(path: str) -> dict[tuple[int, int], dict[str, float | None]]:
    out = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            r, c = int(row["row"]), int(row["col"])
            out[(r, c)] = {
                "car": float(row["car_min"]) if row["car_min"] else None,
                "scooter": float(row["scooter_min"]) if row["scooter_min"] else None,
                "walk": float(row["foot_min"]) if row["foot_min"] else None,
            }
    return out


def read_transit_csv(path: str) -> dict[tuple[int, int], float | None]:
    out = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            r, c = int(row["row"]), int(row["col"])
            out[(r, c)] = float(row["transit_min"]) if row["transit_min"] else None
    return out


def minutes_to_byte(m: float | None, multiplier: float) -> int:
    if m is None:
        return 255
    v = round(m * multiplier)
    if v < 0:
        v = 0
    if v > 254:
        return 255
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cinema_id")
    ap.add_argument("osrm_csv")
    ap.add_argument("transit_csv")
    ap.add_argument("out_bin")
    args = ap.parse_args()

    osrm = read_osrm_csv(args.osrm_csv)
    transit = read_transit_csv(args.transit_csv)

    all_cells = set(osrm) | set(transit)
    if not all_cells:
        raise SystemExit("沒有任何格子資料，無法打包")
    rows = [r for r, _ in all_cells]
    cols = [c for _, c in all_cells]
    row0, row1 = min(rows), max(rows)
    col0, col1 = min(cols), max(cols)
    height = row1 - row0 + 1
    width = col1 - col0 + 1

    layers = ["walk", "scooter", "car", "transit"]
    layer_bytes = {name: bytearray(b"\xff" * (width * height)) for name in layers}

    for (r, c) in all_cells:
        idx = (r - row0) * width + (c - col0)
        o = osrm.get((r, c), {})
        layer_bytes["car"][idx] = minutes_to_byte(o.get("car"), CALIBRATION["car"])
        layer_bytes["scooter"][idx] = minutes_to_byte(o.get("scooter"), CALIBRATION["scooter"])
        layer_bytes["walk"][idx] = minutes_to_byte(o.get("walk"), CALIBRATION["walk"])
        layer_bytes["transit"][idx] = minutes_to_byte(transit.get((r, c)), CALIBRATION["transit"])

    header = {
        "version": 1,
        "cinemaId": args.cinema_id,
        "computedAt": datetime.date.today().isoformat(),
        "lat0": LAT0,
        "lon0": LON0,
        "cellM": CELL_M,
        "row0": row0,
        "col0": col0,
        "width": width,
        "height": height,
        "layers": layers,
        "calibration": CALIBRATION,
    }
    header_bytes = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    out_path = Path(args.out_bin)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(len(header_bytes).to_bytes(4, "little"))
        f.write(header_bytes)
        for name in layers:
            f.write(bytes(layer_bytes[name]))

    size_kb = out_path.stat().st_size / 1024
    print(f"[pack-bin] {out_path}：{width}x{height} 格，{len(layers)} 層，共 {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
