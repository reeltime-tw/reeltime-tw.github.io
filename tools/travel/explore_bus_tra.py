"""開發用：用 tdx_client（含限流重試）探索公車／台鐵資料格式，印出概要。

用法：python3 tools/travel/explore_bus_tra.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from tdx_client import get_json  # noqa: E402


def show(label, path, params):
    print(f"\n=== {label} ===")
    try:
        data = get_json(path, params, max_retries=8)
    except Exception as e:
        print(f"失敗: {e}")
        return
    if isinstance(data, list):
        print(f"list, len={len(data)}")
        if data:
            print(json.dumps(data[0], ensure_ascii=False, indent=1)[:2000])
    else:
        print(json.dumps(data, ensure_ascii=False, indent=1)[:2000])


if __name__ == "__main__":
    show("公車路線(台北市, top3)", "/v2/Bus/Route/City/Taipei", {"$top": 3})
    show("公車路線站序(台北市, top2)", "/v2/Bus/StopOfRoute/City/Taipei", {"$top": 2})
    show("公車班表(台北市, top2)", "/v2/Bus/Schedule/City/Taipei", {"$top": 2})
    show("公車站間時間(台北市, top2)", "/v2/Bus/S2STravelTime/City/Taipei", {"$top": 2})
    show("台鐵車站(top5)", "/v2/Rail/TRA/Station", {"$top": 5})
    show("台鐵每日時刻表(top2)", "/v3/Rail/TRA/DailyTrainTimetable/Today", {"$top": 2})
