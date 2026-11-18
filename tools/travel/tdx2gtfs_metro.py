"""把 TDX 捷運資料轉成 GTFS（給 r5py 算大眾運輸時間用）。

資料來源（見 tools/travel/tdx_client.py）：
  - Rail/Metro/Station/{OP}          站點座標
  - Rail/Metro/StationOfLine/{OP}    每條線的站序
  - Rail/Metro/S2STravelTime/{OP}    站間運行時間（只有一個方向，TrainType 固定）
  - Rail/Metro/Frequency/{OP}        各路線×方向×服務日的班距

實測發現（2026-11-18，TRTC）：
  - S2STravelTime 每個 RouteID 只給一個方向的站序與時間（例如 BL-1 從 BL23→BL01）。
    反方向用「原路徑反過來，時間不變」近似（捷運雙向時間本來就幾乎對稱，可接受）。
  - 同一 LineNo 可能有多個 RouteID，代表不同的行駛範圍（例如板南線 BL-1 全程、
    BL-2 只到亞東醫院的區間車），不是方向。
  - Frequency 的每個 RouteID 會有 TrainType 0 和 1 兩筆，對應去程／返程的班距
    （實測兩者數字通常相同或接近，這裡分別套用到正向／反向 pattern trip）。

輸出：GTFS 資料夾（非 zip，r5py 兩種都吃；zip 由呼叫端視需要再壓）。
"""

from __future__ import annotations

import csv
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from tdx_client import get_json  # noqa: E402

ROUTE_TYPE_SUBWAY = 1
AGENCY_ID = "TDX_METRO"
AGENCY_TZ = "Asia/Taipei"

# GTFS calendar 用的星期幾服務識別：由 ServiceDay 的 7 個布林值組成一個 service_id
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def service_id_of(service_day: dict) -> str:
    bits = "".join("1" if service_day.get(d) else "0" for d in DAYS)
    return f"svc_{bits}"


def hhmm_to_gtfs_time(hhmm: str, add_seconds: int = 0) -> str:
    """'06:00' -> '06:00:00'；'24:00' 保留（GTFS 允許跨午夜用 24+ 小時制）。"""
    h, m = hhmm.split(":")
    total = int(h) * 3600 + int(m) * 60 + add_seconds
    hh = total // 3600
    mm = (total % 3600) // 60
    ss = total % 60
    return f"{hh:02d}:{mm:02d}:{ss:02d}"


def fetch_operator(operator: str) -> dict:
    print(f"[metro] 抓取 {operator} 的站點、路線、班距...")
    stations = get_json(f"/v2/Rail/Metro/Station/{operator}")
    s2s = get_json(f"/v2/Rail/Metro/S2STravelTime/{operator}")
    freq = get_json(f"/v2/Rail/Metro/Frequency/{operator}")
    return {"stations": stations, "s2s": s2s, "freq": freq}


def build_gtfs(operators: list[str], out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)

    stops_rows = []
    seen_stops = set()
    routes_rows = []
    trips_rows = []
    stop_times_rows = []
    frequencies_rows = []
    calendar_rows = []
    seen_calendar = set()

    for operator in operators:
        data = fetch_operator(operator)

        for st in data["stations"]:
            sid = f"{operator}-{st['StationID']}"
            if sid in seen_stops:
                continue
            seen_stops.add(sid)
            pos = st.get("StationPosition") or {}
            stops_rows.append(
                {
                    "stop_id": sid,
                    "stop_name": st["StationName"]["Zh_tw"],
                    "stop_lat": pos.get("PositionLat", ""),
                    "stop_lon": pos.get("PositionLon", ""),
                }
            )

        freq_by_route = {}
        for f in data["freq"]:
            freq_by_route.setdefault(f["RouteID"], []).append(f)

        for route in data["s2s"]:
            line_no = route["LineNo"]
            route_id = f"{operator}-{route['RouteID']}"
            routes_rows.append(
                {
                    "route_id": route_id,
                    "agency_id": AGENCY_ID,
                    "route_short_name": line_no,
                    "route_long_name": "",
                    "route_type": ROUTE_TYPE_SUBWAY,
                }
            )

            segs = sorted(route["TravelTimes"], key=lambda s: s["Sequence"])
            # 正向 pattern：照 TDX 給的順序
            # 反向 pattern：站序反過來，每段時間沿用（近似雙向對稱）
            for direction, ordered_segs, train_type in (
                (0, segs, 0),
                (1, list(reversed(segs)), 1),
            ):
                trip_id = f"{route_id}_dir{direction}"
                trips_rows.append(
                    {
                        "trip_id": trip_id,
                        "route_id": route_id,
                        "service_id": "",  # 頻率式班次不綁單一 service_id，見下方 calendar 處理
                        "direction_id": direction,
                    }
                )

                if direction == 0:
                    first_stop = f"{operator}-{ordered_segs[0]['FromStationID']}"
                    cum = 0
                    stop_times_rows.append(
                        {"trip_id": trip_id, "stop_id": first_stop, "stop_sequence": 0, "t": cum}
                    )
                    for i, seg in enumerate(ordered_segs, start=1):
                        cum += seg["RunTime"]
                        to_stop = f"{operator}-{seg['ToStationID']}"
                        stop_times_rows.append(
                            {"trip_id": trip_id, "stop_id": to_stop, "stop_sequence": i, "t": cum}
                        )
                        cum += seg.get("StopTime", 0)
                else:
                    # 反向：終點變起點，RunTime 照原段落值但走反方向
                    first_stop = f"{operator}-{segs[-1]['ToStationID']}"
                    cum = 0
                    stop_times_rows.append(
                        {"trip_id": trip_id, "stop_id": first_stop, "stop_sequence": 0, "t": cum}
                    )
                    for i, seg in enumerate(ordered_segs, start=1):
                        cum += seg["RunTime"]
                        to_stop = f"{operator}-{seg['FromStationID']}"
                        stop_times_rows.append(
                            {"trip_id": trip_id, "stop_id": to_stop, "stop_sequence": i, "t": cum}
                        )
                        cum += seg.get("StopTime", 0)

                # 這個方向對應的班距（用同 RouteID、對應 TrainType 的 Frequency 項）
                for f in freq_by_route.get(route["RouteID"], []):
                    if f.get("TrainType") != train_type:
                        continue
                    svc_id = service_id_of(f["ServiceDay"])
                    if svc_id not in seen_calendar:
                        seen_calendar.add(svc_id)
                        row = {"service_id": svc_id, "start_date": "20260101", "end_date": "20271231"}
                        for d in DAYS:
                            row[d.lower()] = 1 if f["ServiceDay"].get(d) else 0
                        calendar_rows.append(row)
                    for hw in f.get("Headways", []):
                        headway = round(
                            ((hw.get("MinHeadwayMins", 0) + hw.get("MaxHeadwayMins", 0)) / 2) * 60
                        )
                        if headway <= 0:
                            continue
                        frequencies_rows.append(
                            {
                                "trip_id": f"{trip_id}__{svc_id}",
                                "base_trip_id": trip_id,
                                "service_id": svc_id,
                                "start_time": hhmm_to_gtfs_time(hw["StartTime"]),
                                "end_time": hhmm_to_gtfs_time(hw["EndTime"] if hw["EndTime"] != "00:00" else "24:00"),
                                "headway_secs": headway,
                            }
                        )

    # 展開：每個 (trip_id, service_id) 組合都要有自己的 trip 列與 stop_times
    # （GTFS 的 service_id 掛在 trips.txt，不同服務日要各自一份 trip）
    trips_by_id = {t["trip_id"]: t for t in trips_rows}
    stop_times_by_trip: dict[str, list] = {}
    for st in stop_times_rows:
        stop_times_by_trip.setdefault(st["trip_id"], []).append(st)

    # 注意：同一個 (trip_id, service_id) 可能有多個 Headway 時間段（例如尖峰／
    # 非尖峰班距不同），這些都會共用同一個 new_trip_id——trips.txt／stop_times.txt
    # 每個 trip_id 只能出現一次，只有 frequencies.txt 可以對同一個 trip_id 有多筆
    # （不同時段各自的班距）。曾經在這裡對每個 Headway 都 append 一次 trip／
    # stop_times，造成 r5py 讀取時報 DuplicateKeyError，改成用 set 去重。
    final_trips = []
    final_stop_times = []
    final_freq = []
    seen_trip_ids = set()
    for fr in frequencies_rows:
        base = trips_by_id[fr["base_trip_id"]]
        new_trip_id = fr["trip_id"]
        if new_trip_id not in seen_trip_ids:
            seen_trip_ids.add(new_trip_id)
            final_trips.append(
                {
                    "trip_id": new_trip_id,
                    "route_id": base["route_id"],
                    "service_id": fr["service_id"],
                    "direction_id": base["direction_id"],
                }
            )
            for st in stop_times_by_trip.get(fr["base_trip_id"], []):
                t = st["t"]
                hh, rem = divmod(t, 3600)
                mm, ss = divmod(rem, 60)
                time_str = f"{hh:02d}:{mm:02d}:{ss:02d}"
                final_stop_times.append(
                    {
                        "trip_id": new_trip_id,
                        "arrival_time": time_str,
                        "departure_time": time_str,
                        "stop_id": st["stop_id"],
                        "stop_sequence": st["stop_sequence"],
                    }
                )
        final_freq.append(
            {
                "trip_id": new_trip_id,
                "start_time": fr["start_time"],
                "end_time": fr["end_time"],
                "headway_secs": fr["headway_secs"],
            }
        )

    _write_csv(out_dir / "agency.txt", [
        {"agency_id": AGENCY_ID, "agency_name": "台灣捷運(TDX彙整)", "agency_url": "https://tdx.transportdata.tw/", "agency_timezone": AGENCY_TZ}
    ])
    _write_csv(out_dir / "stops.txt", stops_rows)
    _write_csv(out_dir / "routes.txt", routes_rows)
    _write_csv(out_dir / "trips.txt", final_trips)
    _write_csv(out_dir / "stop_times.txt", final_stop_times)
    _write_csv(out_dir / "frequencies.txt", final_freq)
    _write_csv(out_dir / "calendar.txt", calendar_rows)

    print(f"[metro] 完成：{len(stops_rows)} 站、{len(routes_rows)} 條路線、{len(final_trips)} 個 pattern trip、{len(final_freq)} 筆班距")


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
    ops = sys.argv[1:] or ["TRTC"]
    build_gtfs(ops, Path("gtfs_out") / "metro")
