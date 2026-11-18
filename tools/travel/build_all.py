"""全台 111 間影城的路程時間正式產出（取代 pilot 版，一次處理所有影城）。

跟 pilot 階段（3 間影城）的差異：
- r5py 的 TransportNetwork 只建一次（OSM 全台 + 全部 GTFS），重複用在每一間
  影城上，而不是像 compute_transit_grid.py 原本那樣每次重新建網路（111 次
  重建會慢到不可行）。
- 單一影城失敗（OSRM 或 r5py 算到一半出錯、某個格子資料怪異等）不會讓整個
  流程中斷，記錄下來、跳過，繼續下一間。
- 每處理完 COMMIT_EVERY 間就呼叫一次 git commit + push，避免 workflow 中途
  失敗（timeout、runner 掛掉）時，已經算好的影城白算一場。

用法：
  python3 build_all.py <osm_pbf> <metro_zip> <bus_zip> <targets_json> <out_dir> \
      --radius 20 --car-port 5000 --scooter-port 5001 --foot-port 5002 \
      --commit-every 15 [--force]

targets_json 格式：[{"id": "...", "lat": 25.0, "lon": 121.5}, ...]
"""
from __future__ import annotations

import argparse
import csv
import datetime
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from compute_osrm_grid import cells_in_radius, compute_mode  # noqa: E402
from pack_bin import read_osrm_csv, read_transit_csv, pack  # noqa: E402

GIT_MSG = (
    "路程時間：全台影城正式產出（第 {n} 批，共 {done}/{total} 間完成）\n\n"
    "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>\n"
    "Claude-Session: https://claude.ai/code/session_01Xk3ci6XGRZUEafyUGjrBrm"
)


def git_commit_push(repo_root: Path, batch_no: int, done: int, total: int) -> bool:
    subprocess.run(["git", "add", "docs/travel/"], cwd=repo_root, check=True)
    diff = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo_root)
    if diff.returncode == 0:
        print("[build_all] 沒有新變更，跳過這次 commit")
        return True
    subprocess.run(
        ["git", "commit", "-m", GIT_MSG.format(n=batch_no, done=done, total=total)],
        cwd=repo_root, check=True,
    )
    for i in range(3):
        pull = subprocess.run(["git", "pull", "--rebase"], cwd=repo_root)
        if pull.returncode == 0:
            push = subprocess.run(["git", "push"], cwd=repo_root)
            if push.returncode == 0:
                return True
        print(f"[build_all] 推送失敗，重試 ({i + 1}/3)", file=sys.stderr)
        time.sleep(5)
    return False


def write_index(out_dir: Path, done_ids: list[str], radius_km: float, failed_ids: list[str]):
    out = {
        "computedAt": datetime.date.today().isoformat(),
        "radiusKm": radius_km,
        "cinemas": sorted(done_ids),
        "note": "已算出精確路程時間表的影城清單；不在清單裡的影城，App 會退回直線距離粗估。",
    }
    if failed_ids:
        out["failed"] = sorted(failed_ids)
    (out_dir / "index.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def process_one(cinema_id, lat, lon, radius_km, ports, network, out_dir, tmp_dir):
    import geopandas as gpd
    import pandas as pd
    from shapely.geometry import Point
    import r5py

    car_port, scooter_port, foot_port = ports
    cells = cells_in_radius(lat, lon, radius_km)

    car = compute_mode(car_port, cells, lat, lon)
    scooter = compute_mode(scooter_port, cells, lat, lon)
    foot = compute_mode(foot_port, cells, lat, lon)

    osrm_csv = tmp_dir / f"osrm_{abs(hash(cinema_id))}.csv"
    with open(osrm_csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["row", "col", "car_min", "scooter_min", "foot_min"])
        for r, c, _, _ in cells:
            cm, sm, fm = car.get((r, c)), scooter.get((r, c)), foot.get((r, c))
            w.writerow([r, c, "" if cm is None else round(cm, 2),
                        "" if sm is None else round(sm, 2),
                        "" if fm is None else round(fm, 2)])

    origins = gpd.GeoDataFrame(
        {"id": [f"{r}_{c}" for r, c, _, _ in cells]},
        geometry=[Point(clon, clat) for _, _, clat, clon in cells],
        crs="EPSG:4326",
    )
    destinations = gpd.GeoDataFrame({"id": ["cinema"]}, geometry=[Point(lon, lat)], crs="EPSG:4326")
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

    transit_csv = tmp_dir / f"transit_{abs(hash(cinema_id))}.csv"
    with open(transit_csv, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["row", "col", "transit_min"])
        for r, c, _, _ in cells:
            m = by_id.get(f"{r}_{c}")
            w.writerow([r, c, "" if m is None else round(m, 2)])

    osrm_rows = read_osrm_csv(osrm_csv)
    transit_rows = read_transit_csv(transit_csv)
    out_bin = out_dir / f"{cinema_id}.bin"
    pack(cinema_id, osrm_rows, transit_rows, out_bin)
    osrm_csv.unlink(missing_ok=True)
    transit_csv.unlink(missing_ok=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("osm_pbf")
    ap.add_argument("metro_zip")
    ap.add_argument("bus_zip")
    ap.add_argument("targets_json")
    ap.add_argument("out_dir")
    ap.add_argument("--radius", type=float, default=20)
    ap.add_argument("--car-port", type=int, default=5000)
    ap.add_argument("--scooter-port", type=int, default=5001)
    ap.add_argument("--foot-port", type=int, default=5002)
    ap.add_argument("--commit-every", type=int, default=15)
    ap.add_argument("--repo-root", default=".")
    ap.add_argument("--force", action="store_true", help="就算已經有 .bin 也重算")
    args = ap.parse_args()

    import r5py

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir = Path("tmp")
    tmp_dir.mkdir(exist_ok=True)
    repo_root = Path(args.repo_root)

    targets = json.loads(Path(args.targets_json).read_text(encoding="utf-8"))
    total = len(targets)

    existing_index = out_dir / "index.json"
    done_ids: set[str] = set()
    if existing_index.exists():
        try:
            done_ids = set(json.loads(existing_index.read_text(encoding="utf-8")).get("cinemas", []))
        except Exception:
            pass

    if not args.force:
        targets = [t for t in targets if t["id"] not in done_ids]

    # 同一棟樓不同廳（例如 GOLD CLASS 版）座標完全相同，只算一次、其他用複製，
    # 省下重複算 OSRM/r5py 的時間。
    groups: dict[tuple, list] = {}
    for t in targets:
        key = (round(t["lat"], 4), round(t["lon"], 4))
        groups.setdefault(key, []).append(t)
    representatives = [g[0] for g in groups.values()]
    dup_count = len(targets) - len(representatives)
    if dup_count:
        print(f"[build_all] {dup_count} 間跟別的影城座標完全相同（同棟不同廳），算完直接複製，不重算")

    print(f"[build_all] 共 {total} 間，已完成 {len(done_ids)} 間，這次要處理 {len(targets)} 間（實際要算 {len(representatives)} 間）")

    print("[build_all] 建立 r5py TransportNetwork（全台 OSM + GTFS，只建一次）...")
    t0 = time.time()
    network = r5py.TransportNetwork(args.osm_pbf, [args.metro_zip, args.bus_zip])
    print(f"[build_all] 網路建好，花了 {time.time() - t0:.1f} 秒")

    ports = (args.car_port, args.scooter_port, args.foot_port)
    failed_ids: list[str] = []
    batch_no = 0
    since_commit = 0

    groups_by_key = groups  # key -> [targets sharing that coordinate]
    for i, t in enumerate(representatives, 1):
        cid, lat, lon = t["id"], t["lat"], t["lon"]
        key = (round(lat, 4), round(lon, 4))
        siblings = [s["id"] for s in groups_by_key[key] if s["id"] != cid]
        print(f"[build_all] ({i}/{len(representatives)}) {cid} ({lat},{lon})"
              + (f"，同座標還有：{siblings}" if siblings else ""))
        t0 = time.time()
        try:
            process_one(cid, lat, lon, args.radius, ports, network, out_dir, tmp_dir)
            done_ids.add(cid)
            for sib in siblings:
                shutil.copyfile(out_dir / f"{cid}.bin", out_dir / f"{sib}.bin")
                done_ids.add(sib)
            print(f"[build_all]   完成，花了 {time.time() - t0:.1f} 秒"
                  + (f"（含複製給 {len(siblings)} 間同座標影城）" if siblings else ""))
        except Exception as e:
            print(f"[build_all]   失敗，跳過：{e}", file=sys.stderr)
            failed_ids.append(cid)
            failed_ids.extend(siblings)
        since_commit += 1 + len(siblings)

        if since_commit >= args.commit_every or i == len(representatives):
            batch_no += 1
            write_index(out_dir, sorted(done_ids), args.radius, failed_ids)
            ok = git_commit_push(repo_root, batch_no, len(done_ids), total)
            if not ok:
                print("::error::推送失敗 3 次，放棄", file=sys.stderr)
                sys.exit(1)
            since_commit = 0

    print(f"[build_all] 全部處理完畢：完成 {len(done_ids)}/{total}，失敗 {len(failed_ids)}")
    if failed_ids:
        print("[build_all] 失敗清單：", failed_ids)


if __name__ == "__main__":
    main()
