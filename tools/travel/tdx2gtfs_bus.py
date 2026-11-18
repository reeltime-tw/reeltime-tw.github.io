"""把 TDX 公車資料轉成 GTFS（給 r5py 算大眾運輸時間用）。

資料來源：
  - Bus/Route/City/{city}         路線與子路線(SubRoute)、去返程(Direction)
  - Bus/StopOfRoute/City/{city}   每個 SubRouteID+Direction 的站序與座標
  - Bus/Schedule/City/{city}      班距（Frequencys），但**每筆只代表單一天**
                                   （ServiceDay 是 7 個 0/1 鍵，不是一次给整組）

實測發現（2026-11-18）：
  - 這三個端點都是「整個城市一次回傳全部」，不用每條路線各打一次 API
    （台北市約 1243 筆 subroute+direction，新北市約 1390 筆，各打一次即可）。
  - **沒有站間運行時間 API**（Bus/S2STravelTime 回 404）。改用站點座標算直線距離，
    乘上繞路係數、除以假設平均速度（市區公車含停靠開太快不切實際，用 18 km/h）
    估算站間時間。這比純粹对整条路线用直线距离準，因为至少路径是沿着站牌走的。
  - Schedule 的 ServiceDay 跟 Metro 不同，不能共用 tdx2gtfs_metro.py 的
    service_id_of()：這裡逐天展開（每個 Frequencys 項目只對應它自己 ServiceDay
    裡值為 1 的那些天，可能不只一天）。

為了不要抓整個城市的公車（之後要繳費/额度有限、算起来也慢)，可傳入
cinemas（[(lat, lon), ...]）與 radius_km，只保留行經範圍內的 subroute。
"""

from __future__ import annotations

import csv
import math
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from tdx_client import get_json  # noqa: E402

ROUTE_TYPE_BUS = 3
AGENCY_ID = "TDX_BUS"
AGENCY_TZ = "Asia/Taipei"
AVG_SPEED_KMH = 23.0  # 市區公車含停靠的平均速度；原本 18 經 Google 地圖驗證後
# 發現整體大眾運輸時間偏慢約 17-37%（2026-11-18，4 個樣本），懷疑是這個估計值
# 偏保守，調高到 23 做第二輪驗證（見 plans/travel-time.md「驗證進度」）
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def near_any(lat, lon, cinemas, radius_km):
    return any(haversine_km(lat, lon, c[0], c[1]) <= radius_km for c in cinemas)


def fetch_city(city: str) -> dict:
    print(f"[bus] 抓取 {city} 的公車路線、站序、班表...")
    stop_of_route = get_json(f"/v2/Bus/StopOfRoute/City/{city}", max_retries=8)
    schedule = get_json(f"/v2/Bus/Schedule/City/{city}", max_retries=8)
    return {"stop_of_route": stop_of_route, "schedule": schedule}


def build_gtfs(cities: list[str], out_dir: Path, cinemas: list[tuple[float, float]] | None, radius_km: float = 2.0):
    out_dir.mkdir(parents=True, exist_ok=True)

    stops_rows = []
    seen_stops = set()
    routes_rows = []
    seen_routes = set()
    trips_rows = []
    stop_times_rows = []
    frequencies_rows = []
    calendar_rows = []
    seen_calendar = set()

    kept = 0
    skipped = 0

    for city in cities:
        data = fetch_city(city)

        schedule_by_subroute = {}
        for s in data["schedule"]:
            key = (s["SubRouteID"], s["Direction"])
            for freq in s.get("Frequencys") or []:
                schedule_by_subroute.setdefault(key, []).append(freq)

        for sor in data["stop_of_route"]:
            stops_list = sor.get("Stops") or []
            if not stops_list:
                continue

            if cinemas is not None:
                in_range = any(
                    near_any(st["StopPosition"]["PositionLat"], st["StopPosition"]["PositionLon"], cinemas, radius_km)
                    for st in stops_list
                    if st.get("StopPosition")
                )
                if not in_range:
                    skipped += 1
                    continue
            kept += 1

            sub_id = sor["SubRouteID"]
            direction = sor["Direction"]
            route_id = f"BUS-{sub_id}"
            trip_id = f"{route_id}_dir{direction}"

            if route_id not in seen_routes:
                seen_routes.add(route_id)
                routes_rows.append(
                    {
                        "route_id": route_id,
                        "agency_id": AGENCY_ID,
                        "route_short_name": sor["SubRouteName"]["Zh_tw"],
                        "route_long_name": "",
                        "route_type": ROUTE_TYPE_BUS,
                    }
                )

            trips_rows.append({"trip_id": trip_id, "route_id": route_id, "direction_id": direction})

            cum = 0.0
            prev = None
            for i, st in enumerate(sorted(stops_list, key=lambda s: s["StopSequence"])):
                pos = st.get("StopPosition")
                if not pos:
                    continue
                sid = f"BUS-{st['StopID']}"
                if sid not in seen_stops:
                    seen_stops.add(sid)
                    stops_rows.append(
                        {
                            "stop_id": sid,
                            "stop_name": st["StopName"]["Zh_tw"],
                            "stop_lat": pos["PositionLat"],
                            "stop_lon": pos["PositionLon"],
                        }
                    )
                if prev is not None:
                    dist_km = haversine_km(prev[0], prev[1], pos["PositionLat"], pos["PositionLon"])
                    # 公車站牌間走的是路網不是直線，加 1.3 倍繞路係數
                    seg_min = (dist_km * 1.3) / AVG_SPEED_KMH * 60
                    cum += seg_min * 60  # 轉成秒
                prev = (pos["PositionLat"], pos["PositionLon"])
                stop_times_rows.append({"trip_id": trip_id, "stop_id": sid, "stop_sequence": i, "t": round(cum)})

            # 班距：逐天展開（Schedule 的 ServiceDay 每個鍵各自 0/1，可能同時好幾天是 1）
            for sched in schedule_by_subroute.get((sub_id, direction), []):
                service_day = sched.get("ServiceDay") or {}
                active_days = tuple(d for d in DAYS if service_day.get(d))
                if not active_days:
                    continue
                svc_id = "svc_" + "".join("1" if d in active_days else "0" for d in DAYS)
                if svc_id not in seen_calendar:
                    seen_calendar.add(svc_id)
                    row = {"service_id": svc_id, "start_date": "20260101", "end_date": "20271231"}
                    for d in DAYS:
                        row[d.lower()] = 1 if d in active_days else 0
                    calendar_rows.append(row)
                headway = round(((sched.get("MinHeadwayMins", 0) + sched.get("MaxHeadwayMins", 0)) / 2) * 60)
                start_time = sched.get("StartTime")
                end_time = sched.get("EndTime")
                if headway <= 0 or not start_time or not end_time:
                    continue
                frequencies_rows.append(
                    {
                        "trip_id": trip_id,
                        "service_id": svc_id,
                        "start_time": _hhmm(start_time),
                        "end_time": _hhmm(end_time if end_time != "00:00" else "24:00"),
                        "headway_secs": headway,
                    }
                )

    print(f"[bus] 篩選結果：保留 {kept} 條、略過 {skipped} 條（不在範圍內）")

    # 展開 (trip, service_id) 成獨立 trip（GTFS 規定一個 trip 只能對應一個 service_id）
    stop_times_by_trip: dict[str, list] = {}
    for st in stop_times_rows:
        stop_times_by_trip.setdefault(st["trip_id"], []).append(st)
    trips_by_id = {t["trip_id"]: t for t in trips_rows}

    # 同一個 (trip_id, service_id) 可能有多筆 schedule（不同時段各自的班距），
    # 這些都共用同一個 new_trip_id——trips.txt／stop_times.txt 每個 trip_id 只能
    # 出現一次，只有 frequencies.txt 可以對同一個 trip_id 有多筆。用 set 去重，
    # 避免重複的 trip/stop_times 列（之前曾因此在 r5py 讀取時報
    # DuplicateKeyError，跟 tdx2gtfs_metro.py 是同一類問題）。
    final_trips, final_stop_times, final_freq = [], [], []
    seen_trip_ids = set()
    for fr in frequencies_rows:
        base = trips_by_id[fr["trip_id"]]
        new_trip_id = f"{fr['trip_id']}__{fr['service_id']}"
        if new_trip_id not in seen_trip_ids:
            seen_trip_ids.add(new_trip_id)
            final_trips.append(
                {"trip_id": new_trip_id, "route_id": base["route_id"], "service_id": fr["service_id"], "direction_id": base["direction_id"]}
            )
            for st in stop_times_by_trip.get(fr["trip_id"], []):
                hh, rem = divmod(st["t"], 3600)
                mm, ss = divmod(rem, 60)
                time_str = f"{hh:02d}:{mm:02d}:{ss:02d}"
                final_stop_times.append(
                    {"trip_id": new_trip_id, "arrival_time": time_str, "departure_time": time_str, "stop_id": st["stop_id"], "stop_sequence": st["stop_sequence"]}
                )
        final_freq.append({"trip_id": new_trip_id, "start_time": fr["start_time"], "end_time": fr["end_time"], "headway_secs": fr["headway_secs"]})

    _write_csv(out_dir / "agency.txt", [{"agency_id": AGENCY_ID, "agency_name": "台灣公車(TDX彙整)", "agency_url": "https://tdx.transportdata.tw/", "agency_timezone": AGENCY_TZ}])
    _write_csv(out_dir / "stops.txt", stops_rows)
    _write_csv(out_dir / "routes.txt", routes_rows)
    _write_csv(out_dir / "trips.txt", final_trips)
    _write_csv(out_dir / "stop_times.txt", final_stop_times)
    _write_csv(out_dir / "frequencies.txt", final_freq)
    _write_csv(out_dir / "calendar.txt", calendar_rows)

    print(f"[bus] 完成：{len(stops_rows)} 站、{len(routes_rows)} 條路線、{len(final_trips)} 個 pattern trip、{len(final_freq)} 筆班距")


def _hhmm(hhmm: str) -> str:
    h, m = hhmm.split(":")
    total = int(h) * 60 + int(m)
    return f"{total // 60:02d}:{total % 60:02d}:00"


def _write_csv(path: Path, rows: list[dict]):
    if not rows:
        path.write_text("")
        return
    fieldnames = list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    # 預設：3 間試算影城（信義威秀、西門威秀、新店裕隆城威秀）方圓 2 公里內的公車
    pilot_cinemas = [
        (25.0353, 121.5666),  # 台北信義威秀
        (25.0438, 121.5055),  # 台北西門威秀
        (24.9784, 121.5468),  # 新店裕隆城威秀
    ]
    build_gtfs(["Taipei", "NewTaipei"], Path("gtfs_out") / "bus", pilot_cinemas, radius_km=2.0)
